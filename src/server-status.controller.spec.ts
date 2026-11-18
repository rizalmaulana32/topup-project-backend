import {
  parseAuthLog,
  parseWhois,
  serverWarnings,
} from './server-status.controller';

describe('parseWhois', () => {
  it('takes country and org-name from a RIPE record', () => {
    const out = [
      'inetnum:        193.160.32.0 - 193.160.32.255',
      'netname:        US-SHOCK1-20191118',
      'country:        DE',
      'org-name:       Shock Hosting LLC',
      'country:        US',
    ].join('\n');
    expect(parseWhois(out)).toBe('DE · Shock Hosting LLC');
  });

  it('skips the ARIN referral stub and falls back to descr', () => {
    const out = [
      'NetName:        APNIC',
      'OrgName:        Asia Pacific Network Information Centre',
      'Country:        AU',
      '',
      'inetnum:        66.96.224.0 - 66.96.255.255',
      'netname:        MYREPUBLIC-ID',
      'descr:          PT. Eka Mas Republik',
      'country:        ID',
    ].join('\n');
    expect(parseWhois(out)).toBe('ID · PT. Eka Mas Republik');
  });

  it('returns empty for unparseable output', () => {
    expect(parseWhois('% no entries found')).toBe('');
  });
});

describe('parseAuthLog', () => {
  const log = [
    '2026-11-18T01:00:00.000000+00:00 yay sshd[1]: Failed password for root from 9.9.9.9 port 1 ssh2',
    '2026-11-18T02:10:00.000000+00:00 yay sshd[2]: Invalid user jj from 1.1.1.1 port 2',
    '2026-11-18T02:10:01.000000+00:00 yay sshd[2]: Failed password for invalid user jj from 1.1.1.1 port 2 ssh2',
    '2026-11-18T02:10:05.000000+00:00 yay sshd[3]: Failed password for root from 1.1.1.1 port 3 ssh2',
    '2026-11-18T02:11:00.000000+00:00 yay sshd[4]: Failed password for root from 2.2.2.2 port 4 ssh2',
    '2026-11-18T02:12:00.000000+00:00 yay sshd[5]: Accepted publickey for root from 3.3.3.3 port 5 ssh2: ED25519 SHA256:x',
    '2026-11-18T02:13:00.000000+00:00 yay sshd[6]: Accepted password for root from 4.4.4.4 port 6 ssh2',
    '2026-11-18T02:14:00.000000+00:00 yay CRON[7]: pam_unix(cron:session): session opened for user root',
    // password auth off: a bot attempt is one preauth close, not "Failed password"
    '2026-11-18T02:15:00.000000+00:00 yay sshd[8]: Connection closed by authenticating user root 2.2.2.2 port 8 [preauth]',
    '2026-11-18T02:16:00.000000+00:00 yay sshd[9]: Disconnected from invalid user admin 1.1.1.1 port 9 [preauth]',
    '2026-11-18T02:20:00.000000+00:00 yay sshd[10]: Accepted publickey for root from 3.3.3.3 port 10 ssh2: ED25519 SHA256:x',
  ].join('\n');

  it('counts failures per IP after the cutoff, once per attempt, and lists logins', () => {
    const r = parseAuthLog(log, Date.parse('2026-11-18T02:00:00Z'));
    expect(r.failed_1h).toBe(5);
    expect(r.top_failed).toEqual([
      { ip: '1.1.1.1', count: 3 },
      { ip: '2.2.2.2', count: 2 },
    ]);
    expect(r.logins).toEqual([
      {
        at: '2026-11-18T02:20:00.000000+00:00',
        method: 'publickey',
        user: 'root',
        ip: '3.3.3.3',
        count: 2,
      },
      {
        at: '2026-11-18T02:13:00.000000+00:00',
        method: 'password',
        user: 'root',
        ip: '4.4.4.4',
        count: 1,
      },
    ]);
  });
});

describe('serverWarnings', () => {
  const healthy = {
    cpu: { cores: 2, usage_percent: 10, load: [0.2, 0.3, 0.3] },
    memory: {
      total_mb: 3916,
      available_mb: 3283,
      swap_total_mb: 2047,
      swap_used_mb: 470,
      hugepages_mb: 0,
    },
    disk: { total_gb: 40, used_gb: 9.1, used_percent: 25 },
    uptime_hours: 770,
    services: { postgresql: 'active', nginx: 'active' },
    database: { ok: true, latency_ms: 3, size_mb: 12, connections: 6 },
    app: { uptime_hours: 1, rss_mb: 92 },
    top_processes: [],
    certificates: [{ domain: 'yaytopup.id', days_left: 60 }],
    last_backup_hours: 2,
    ssh: {
      origins: {},
      failed_1h: 300,
      top_failed: [],
      banned: 4,
      logins: [
        { at: '', user: 'root', ip: '3.3.3.3', method: 'publickey', count: 1 },
      ],
    },
  };

  it('is quiet on a healthy server', () => {
    expect(serverWarnings(healthy)).toEqual([]);
  });

  it('flags the 17 Nov situation: RAM squeezed by locked hugepages', () => {
    const w = serverWarnings({
      ...healthy,
      memory: { ...healthy.memory, available_mb: 287, hugepages_mb: 3050 },
    });
    expect(w).toHaveLength(2);
    expect(w[0]).toMatch(/RAM tersisa 7%/);
    expect(w[1]).toMatch(/Hugepages terkunci 3050 MB/);
  });

  it('flags a successful password login (password auth is supposed to be off)', () => {
    expect(
      serverWarnings({
        ...healthy,
        ssh: {
          ...healthy.ssh,
          logins: [
            {
              at: '',
              user: 'root',
              ip: '4.4.4.4',
              method: 'password',
              count: 1,
            },
          ],
        },
      }),
    ).toEqual(['Login SSH pakai password berhasil: root dari 4.4.4.4']);
  });

  it('flags a stopped service, a full disk, high load and an expiring cert', () => {
    const w = serverWarnings({
      ...healthy,
      services: { postgresql: 'active', nginx: 'failed' },
      disk: { ...healthy.disk, used_percent: 90 },
      cpu: { ...healthy.cpu, load: [3, 2.5, 2] },
      certificates: [{ domain: 'api.yaytopup.id', days_left: 5 }],
    });
    expect(w).toEqual([
      'Load 5 menit 2.5 > 2 core',
      'Disk 90% penuh',
      'Service nginx: failed',
      'SSL api.yaytopup.id habis 5 hari lagi',
    ]);
  });
});
