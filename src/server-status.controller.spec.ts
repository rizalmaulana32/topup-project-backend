import { serverWarnings } from './server-status.controller';

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
