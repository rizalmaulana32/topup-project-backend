import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  NotFoundException,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { execFile } from 'node:child_process';
import { timingSafeEqual, X509Certificate } from 'node:crypto';
import { open, readdir, readFile, stat, statfs } from 'node:fs/promises';
import { isIP } from 'node:net';
import { cpus, loadavg, uptime } from 'node:os';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';
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
  ssh: SshActivity;
  /** Only with ?history=1 (reads every auth.log rotation). */
  ssh_history?: SshHistory;
  warnings: string[];
}

export interface SshActivity {
  failed_1h: number;
  /** `first`/`last`: timestamps of the IP's first and last attempt in the window. */
  top_failed: { ip: string; count: number; first: string; last: string }[];
  banned: number | null;
  /** Grouped per user+IP+method; `first`..`at` spans them, `at` is the latest. */
  logins: {
    first: string;
    at: string;
    user: string;
    ip: string;
    method: string;
    count: number;
  }[];
  /** Whois summary ("US · SPARKED HOST LLC") per IP above; '' when unknown. */
  origins: Record<string, string>;
}

const REGISTRY_PLACEHOLDER =
  /^(?:APNIC|RIPE|ARIN|LACNIC|AFRINIC|IANA)\b|Coordination Centre|Information Centre/i;

/**
 * "COUNTRY · organisation" from raw whois output. Records start at each
 * netname; registry referral stubs (e.g. ARIN pointing at APNIC) are skipped
 * and the last real record wins.
 */
export function parseWhois(text: string): string {
  const records: Record<string, string>[] = [];
  for (const line of text.split('\n')) {
    const m = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'netname') records.push({});
    const r = records.at(-1);
    if (r && value && !(key in r)) r[key] = value;
  }
  const r = records
    .reverse()
    .find(
      (x) =>
        !REGISTRY_PLACEHOLDER.test(x.netname ?? '') &&
        !REGISTRY_PLACEHOLDER.test(x.orgname ?? ''),
    );
  if (!r) return '';
  const org = (r['org-name'] ?? r.orgname ?? r.descr ?? r.netname).slice(0, 40);
  return [r.country?.toUpperCase(), org].filter(Boolean).join(' · ');
}

// ponytail: in-process cache, lost on restart; IP owners rarely change
const whoisCache = new Map<string, string>();

async function ipOrigin(ip: string): Promise<string> {
  if (!isIP(ip)) return '';
  const hit = whoisCache.get(ip);
  if (hit !== undefined) return hit;
  let origin = '';
  try {
    const { stdout } = await run('whois', [ip], { timeout: 8000 });
    origin = parseWhois(stdout);
  } catch {
    // whois missing or timed out: show the IP without origin
  }
  if (whoisCache.size > 500) whoisCache.clear();
  whoisCache.set(ip, origin);
  return origin;
}

const SSHD_LINE = /^(\S+) \S+ sshd(?:-session)?\[(\d+)\]: (.*)$/;
const ACCEPTED = /^Accepted (\S+) for (\S+) from (\S+) port/;
// With password auth off, bots show up as "Connection closed by authenticating user ..."
// rather than "Failed password"; both forms (and invalid users) count as a failed attempt.
// Groups: 1-3 = username tried (whichever form matched), 4 = IP.
const FAILED =
  /^(?:Failed \S+ for (?:invalid user )?(\S+) from|Invalid user (\S*) ?from|(?:Connection closed by|Connection reset by|Disconnected from) (?:authenticating|invalid) user (\S+)) (\S+) port/;

export interface SshEvent {
  at: string;
  ms: number;
  ip: string;
  user: string;
}
export interface SshLoginEvent extends SshEvent {
  method: string;
}

/**
 * Every failed attempt and successful login in auth.log text, oldest first.
 * One SSH connection logs several failure lines, so a failure is counted once
 * per connection (sshd pid). Pids are reused over weeks while a connection
 * lives seconds, so the key is pid + 10-minute bucket.
 */
export function authEvents(text: string): {
  failed: SshEvent[];
  logins: SshLoginEvent[];
} {
  // ponytail: a connection straddling a 10-minute boundary is counted twice
  const failed = new Map<string, SshEvent>();
  const logins: SshLoginEvent[] = [];
  for (const line of text.split('\n')) {
    const m = SSHD_LINE.exec(line);
    if (!m) continue;
    const [, at, pid, msg] = m;
    const ms = Date.parse(at);
    if (Number.isNaN(ms)) continue;
    const ok = ACCEPTED.exec(msg);
    if (ok) {
      logins.push({ at, ms, method: ok[1], user: ok[2], ip: ok[3] });
      continue;
    }
    const bad = FAILED.exec(msg);
    const key = `${pid} ${at.slice(0, 15)}`;
    if (bad && !failed.has(key)) {
      failed.set(key, {
        at,
        ms,
        ip: bad[4],
        user: bad[1] ?? bad[2] ?? bad[3] ?? '',
      });
    }
  }
  return { failed: [...failed.values()], logins };
}

function topFailed(failed: SshEvent[], n: number) {
  const perIp = new Map<string, SshActivity['top_failed'][number]>();
  for (const { ip, at } of failed) {
    const prev = perIp.get(ip);
    perIp.set(ip, {
      ip,
      count: (prev?.count ?? 0) + 1,
      first: prev?.first ?? at,
      last: at,
    });
  }
  return [...perIp.values()].sort((a, b) => b.count - a.count).slice(0, n);
}

function loginsByIp(logins: SshLoginEvent[]): SshActivity['logins'] {
  const grouped = new Map<string, SshActivity['logins'][number]>();
  for (const { at, user, ip, method } of logins) {
    const key = `${user} ${ip} ${method}`;
    const prev = grouped.get(key);
    grouped.set(key, {
      first: prev?.first ?? at,
      at,
      user,
      ip,
      method,
      count: (prev?.count ?? 0) + 1,
    });
  }
  return [...grouped.values()].sort((a, b) => b.count - a.count);
}

/** Failed attempts and successful logins in auth.log since `sinceMs`. */
export function parseAuthLog(
  text: string,
  sinceMs: number,
): Omit<SshActivity, 'banned' | 'origins'> {
  const { failed, logins } = authEvents(text);
  const f = failed.filter((e) => e.ms >= sinceMs);
  return {
    failed_1h: f.length,
    top_failed: topFailed(f, 3),
    logins: loginsByIp(logins.filter((e) => e.ms >= sinceMs)),
  };
}

export interface SshWindow {
  failed: number;
  ips: number;
  logins: number;
  top_failed: SshActivity['top_failed'];
  logins_by_ip: SshActivity['logins'];
}

export interface SshHistory {
  /** Oldest auth.log line still on disk; windows reaching further back are partial. */
  log_since: string | null;
  windows: Record<'30d' | '7d' | '24h' | '1h', SshWindow>;
  /** Last 30 days by WIB date, newest first. */
  daily: { date: string; failed: number; logins: number }[];
  failed_1h: { at: string; ip: string; user: string }[];
  logins_24h: { at: string; ip: string; user: string; method: string }[];
  origins: Record<string, string>;
}

const HOUR = 3600000;
const WIB = 7 * HOUR;

export function sshHistory(
  ev: { failed: SshEvent[]; logins: SshLoginEvent[] },
  nowMs: number,
): Omit<SshHistory, 'origins'> {
  const spans = { '30d': 720, '7d': 168, '24h': 24, '1h': 1 } as const;
  const windows = {} as SshHistory['windows'];
  for (const [name, hours] of Object.entries(spans)) {
    const since = nowMs - hours * HOUR;
    const f = ev.failed.filter((e) => e.ms >= since);
    const l = ev.logins.filter((e) => e.ms >= since);
    windows[name as keyof typeof spans] = {
      failed: f.length,
      ips: new Set(f.map((e) => e.ip)).size,
      logins: l.length,
      top_failed: topFailed(f, 10),
      logins_by_ip: loginsByIp(l),
    };
  }
  const wibDate = (ms: number) => new Date(ms + WIB).toISOString().slice(0, 10);
  const daily = Array.from({ length: 30 }, (_, i) => ({
    date: wibDate(nowMs - i * 24 * HOUR),
    failed: 0,
    logins: 0,
  }));
  const byDate = new Map(daily.map((d) => [d.date, d]));
  for (const e of ev.failed) {
    const d = byDate.get(wibDate(e.ms));
    if (d) d.failed++;
  }
  for (const e of ev.logins) {
    const d = byDate.get(wibDate(e.ms));
    if (d) d.logins++;
  }
  const first = Math.min(
    ev.failed[0]?.ms ?? Infinity,
    ev.logins[0]?.ms ?? Infinity,
  );
  return {
    log_since: Number.isFinite(first) ? new Date(first).toISOString() : null,
    windows,
    daily,
    failed_1h: ev.failed
      .filter((e) => e.ms >= nowMs - HOUR)
      .map(({ at, ip, user }) => ({ at, ip, user })),
    logins_24h: ev.logins
      .filter((e) => e.ms >= nowMs - 24 * HOUR)
      .map(({ at, ip, user, method }) => ({ at, ip, user, method })),
  };
}

// Rotated logs never change, so their parsed events are kept until they rotate again.
const rotatedEvents = new Map<
  string,
  { key: string; ev: ReturnType<typeof authEvents> }
>();

/** auth.log plus its rotations (auth.log.1, auth.log.N.gz), oldest first. */
async function allAuthEvents() {
  const dir = '/var/log';
  const files = (await readdir(dir))
    .filter((f) => /^auth\.log(\.\d+(\.gz)?)?$/.test(f))
    .sort(
      (a, b) => (Number(b.split('.')[2]) || 0) - (Number(a.split('.')[2]) || 0),
    );
  const failed: SshEvent[] = [];
  const logins: SshLoginEvent[] = [];
  for (const f of files) {
    const path = `${dir}/${f}`;
    let ev: ReturnType<typeof authEvents>;
    try {
      const st = await stat(path);
      const key = `${st.mtimeMs}:${st.size}`;
      const hit = rotatedEvents.get(f);
      if (f !== 'auth.log' && hit?.key === key) ev = hit.ev;
      else {
        const raw = await readFile(path);
        ev = authEvents(
          (f.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8'),
        );
        if (f !== 'auth.log') rotatedEvents.set(f, { key, ev });
      }
    } catch {
      continue; // unreadable rotation: the window just covers less
    }
    failed.push(...ev.failed);
    logins.push(...ev.logins);
  }
  return { failed, logins };
}

/** Whois origins for `ips`, waiting at most `waitMs`; slower lookups land in the cache for next time. */
async function originsFor(ips: string[], waitMs = 6000) {
  const unique = [...new Set(ips)];
  await Promise.race([
    Promise.all(unique.map(ipOrigin)),
    new Promise((r) => setTimeout(r, waitMs)),
  ]);
  return Object.fromEntries(unique.map((ip) => [ip, whoisCache.get(ip) ?? '']));
}

async function sshHistoryNow(): Promise<SshHistory> {
  const h = sshHistory(await allAuthEvents(), Date.now());
  const w = Object.values(h.windows);
  const origins = await originsFor([
    ...w.flatMap((x) => x.top_failed.map((f) => f.ip)),
    ...w.flatMap((x) => x.logins_by_ip.map((l) => l.ip)),
    ...h.failed_1h.map((f) => f.ip),
  ]);
  return { ...h, origins };
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
  // Password login is disabled in sshd; one succeeding means that was undone.
  for (const l of s.ssh.logins) {
    if (l.method !== 'publickey')
      w.push(`Login SSH pakai ${l.method} berhasil: ${l.user} dari ${l.ip}`);
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
    @Query('history') history?: string,
  ): Promise<ServerStatus> {
    const expected = this.config.get<string>('STATUS_TOKEN');
    if (!expected) throw new NotFoundException();
    const a = Buffer.from(token ?? '');
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ForbiddenException();
    }

    const [
      usage,
      mem,
      disk,
      services,
      database,
      top,
      certificates,
      backup,
      ssh,
      sshHistoryData,
    ] = await Promise.all([
      cpuUsagePercent(),
      meminfo(),
      statfs('/'),
      serviceStates(['postgresql', 'nginx', 'fail2ban']),
      this.database(),
      topProcesses(),
      certificateDays(),
      lastBackupHours(),
      sshActivity(),
      history === '1' ? sshHistoryNow() : undefined,
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
      ssh,
    };
    return {
      ...status,
      ...(sshHistoryData && { ssh_history: sshHistoryData }),
      warnings: serverWarnings(status),
    };
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

/** SSH activity of the last hour from the tail of auth.log, plus fail2ban's ban count. */
async function sshActivity(): Promise<SshActivity> {
  // ponytail: reads only the last 4 MB (~hours of bot noise) and the current file; an hour
  // spanning logrotate loses the part in auth.log.1.
  let text = '';
  try {
    const fh = await open('/var/log/auth.log', 'r');
    try {
      const { size } = await fh.stat();
      const start = Math.max(0, size - 4 * MB);
      const buf = Buffer.alloc(size - start);
      await fh.read(buf, 0, buf.length, start);
      text = buf.toString('utf8');
    } finally {
      await fh.close();
    }
  } catch {
    // no auth.log: report zeros rather than fail the whole status
  }
  let banned: number | null = null;
  try {
    const { stdout } = await run('fail2ban-client', ['status', 'sshd']);
    const m = /Currently banned:\s*(\d+)/.exec(stdout);
    banned = m ? Number(m[1]) : null;
  } catch {
    // fail2ban not installed/running; its service state already shows that
  }
  const activity = parseAuthLog(text, Date.now() - 3600000);
  const origins = await originsFor([
    ...activity.top_failed.map((f) => f.ip),
    ...activity.logins.map((l) => l.ip),
  ]);
  return { ...activity, banned, origins };
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
