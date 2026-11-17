import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { execFile } from 'node:child_process';
import { timingSafeEqual, X509Certificate } from 'node:crypto';
import { readdir, readFile, stat, statfs } from 'node:fs/promises';
import { cpus, loadavg, uptime } from 'node:os';
import { promisify } from 'node:util';
import { DataSource } from 'typeorm';

const run = promisify(execFile);
const MB = 1024 * 1024;

export interface ServerStatus {
  cpu: { cores: number; usage_percent: number; load: number[] };
  memory: {
    total_mb: number;
    available_mb: number;
    swap_total_mb: number;
    swap_used_mb: number;
    hugepages_mb: number;
  };
  disk: { total_gb: number; used_gb: number; used_percent: number };
  uptime_hours: number;
  services: Record<string, string>;
  database: {
    ok: boolean;
    latency_ms: number;
    size_mb: number;
    connections: number;
  };
  app: { uptime_hours: number; rss_mb: number };
  top_processes: { name: string; rss_mb: number }[];
  certificates: { domain: string; days_left: number }[];
  last_backup_hours: number | null;
  warnings: string[];
}

/** What the hourly Telegram report flags with ⚠️. */
export function serverWarnings(s: Omit<ServerStatus, 'warnings'>): string[] {
  const w: string[] = [];
  const ramPct = (s.memory.available_mb / s.memory.total_mb) * 100;
  if (ramPct < 15) w.push(`RAM tersisa ${ramPct.toFixed(0)}%`);
  if (s.memory.hugepages_mb > 0) {
    w.push(
      `Hugepages terkunci ${s.memory.hugepages_mb} MB (lihat catatan 17 Nov)`,
    );
  }
  if (
    s.memory.swap_total_mb &&
    s.memory.swap_used_mb / s.memory.swap_total_mb > 0.5
  ) {
    w.push(`Swap terpakai ${s.memory.swap_used_mb} MB`);
  }
  if (s.cpu.usage_percent > 85) w.push(`CPU ${s.cpu.usage_percent}%`);
  if (s.cpu.load[1] > s.cpu.cores) {
    w.push(`Load 5 menit ${s.cpu.load[1]} > ${s.cpu.cores} core`);
  }
  if (s.disk.used_percent > 85) w.push(`Disk ${s.disk.used_percent}% penuh`);
  for (const [name, state] of Object.entries(s.services)) {
    if (state !== 'active') w.push(`Service ${name}: ${state}`);
  }
  if (!s.database.ok) w.push('Database tidak merespons');
  else if (s.database.latency_ms > 500)
    w.push(`Database lambat ${s.database.latency_ms} ms`);
  for (const c of s.certificates) {
    if (c.days_left < 14)
      w.push(`SSL ${c.domain} habis ${c.days_left} hari lagi`);
  }
  return w;
}

/**
 * Machine health for the external uptime bot (Cloudflare Worker), which adds
 * it to its hourly Telegram report. Off unless STATUS_TOKEN is set; the
 * caller sends it as x-status-token.
 */
@ApiExcludeController()
@Controller('server-status')
export class ServerStatusController {
  constructor(
    private readonly config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  @Get()
  async status(
    @Headers('x-status-token') token?: string,
  ): Promise<ServerStatus> {
    const expected = this.config.get<string>('STATUS_TOKEN');
    if (!expected) throw new NotFoundException();
    const a = Buffer.from(token ?? '');
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ForbiddenException();
    }

    const [usage, mem, disk, services, database, top, certificates, backup] =
      await Promise.all([
        cpuUsagePercent(),
        meminfo(),
        statfs('/'),
        serviceStates(['postgresql', 'nginx']),
        this.database(),
        topProcesses(),
        certificateDays(),
        lastBackupHours(),
      ]);
    const diskTotal = disk.blocks * disk.bsize;
    const diskFree = disk.bavail * disk.bsize;
    const status = {
      cpu: {
        cores: cpus().length,
        usage_percent: usage,
        load: loadavg().map((l) => Number(l.toFixed(2))),
      },
      memory: {
        total_mb: Math.round(mem.MemTotal / 1024),
        available_mb: Math.round(mem.MemAvailable / 1024),
        swap_total_mb: Math.round(mem.SwapTotal / 1024),
        swap_used_mb: Math.round((mem.SwapTotal - mem.SwapFree) / 1024),
        hugepages_mb: Math.round((mem.Hugetlb ?? 0) / 1024),
      },
      disk: {
        total_gb: Number((diskTotal / 1024 / MB).toFixed(1)),
        used_gb: Number(((diskTotal - diskFree) / 1024 / MB).toFixed(1)),
        used_percent: Math.round(((diskTotal - diskFree) / diskTotal) * 100),
      },
      uptime_hours: Math.round(uptime() / 3600),
      services,
      database,
      app: {
        uptime_hours: Number((process.uptime() / 3600).toFixed(1)),
        rss_mb: Math.round(process.memoryUsage().rss / MB),
      },
      top_processes: top,
      certificates,
      last_backup_hours: backup,
    };
    return { ...status, warnings: serverWarnings(status) };
  }

  private async database() {
    const start = Date.now();
    try {
      const rows: { size: string; connections: string }[] =
        await this.dataSource.query(
          `SELECT pg_database_size(current_database()) AS size,
                  (SELECT count(*) FROM pg_stat_activity) AS connections`,
        );
      const row = rows[0];
      return {
        ok: true,
        latency_ms: Date.now() - start,
        size_mb: Math.round(Number(row.size) / MB),
        connections: Number(row.connections),
      };
    } catch {
      return {
        ok: false,
        latency_ms: Date.now() - start,
        size_mb: 0,
        connections: 0,
      };
    }
  }
}

/** /proc/meminfo in kB. */
async function meminfo(): Promise<Record<string, number>> {
  const text = await readFile('/proc/meminfo', 'utf8');
  return Object.fromEntries(
    text.split('\n').map((l) => {
      const [key, value] = l.split(':');
      return [key, parseInt(value, 10)];
    }),
  );
}

/** Busy share of all cores over a 1 s sample of /proc/stat. */
async function cpuUsagePercent(): Promise<number> {
  const sample = async () => {
    const [, ...f] = (await readFile('/proc/stat', 'utf8'))
      .split('\n')[0]
      .split(/\s+/);
    const n = f.map(Number);
    return { idle: n[3] + n[4], total: n.reduce((a, b) => a + b, 0) };
  };
  const a = await sample();
  await new Promise((r) => setTimeout(r, 1000));
  const b = await sample();
  const total = b.total - a.total;
  return total ? Math.round(100 * (1 - (b.idle - a.idle) / total)) : 0;
}

async function serviceStates(names: string[]) {
  return Object.fromEntries(
    await Promise.all(
      names.map(async (name) => {
        try {
          const { stdout } = await run('systemctl', ['is-active', name]);
          return [name, stdout.trim()];
        } catch (error) {
          // is-active exits non-zero for inactive/failed but still prints the state.
          const out = (error as { stdout?: string }).stdout?.trim();
          return [name, out || 'unknown'];
        }
      }),
    ),
  ) as Record<string, string>;
}

async function topProcesses() {
  try {
    const { stdout } = await run('ps', ['-eo', 'rss=,comm=', '--sort=-rss']);
    return stdout
      .trim()
      .split('\n')
      .slice(0, 3)
      .map((line) => {
        const [rss, ...name] = line.trim().split(/\s+/);
        return { name: name.join(' '), rss_mb: Math.round(Number(rss) / 1024) };
      });
  } catch {
    return [];
  }
}

async function certificateDays() {
  const dir = '/etc/letsencrypt/live';
  try {
    const domains = (await readdir(dir)).filter((d) => d !== 'README');
    return await Promise.all(
      domains.map(async (domain) => {
        const cert = new X509Certificate(
          await readFile(`${dir}/${domain}/cert.pem`),
        );
        const days = (new Date(cert.validTo).getTime() - Date.now()) / 86400000;
        return { domain, days_left: Math.floor(days) };
      }),
    );
  } catch {
    return [];
  }
}

/** Hours since the newest file in /root/backups (manual pre-deploy dumps). */
async function lastBackupHours(): Promise<number | null> {
  const dir = '/root/backups';
  try {
    const times = await Promise.all(
      (await readdir(dir)).map(
        async (f) => (await stat(`${dir}/${f}`)).mtimeMs,
      ),
    );
    return times.length
      ? Math.round((Date.now() - Math.max(...times)) / 3600000)
      : null;
  } catch {
    return null;
  }
}
