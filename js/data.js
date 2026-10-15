/*
 * data.js — demo data + the "live" simulation.
 *
 * There is no backend in this task, so the services below are generated in the
 * browser. A tiny status machine then changes a few of them every few seconds so
 * the dashboard behaves like a real monitoring feed. To use a real API, replace
 * createServices() with a fetch() and tick() with a WebSocket / polling call —
 * nothing else in the app needs to change.
 */
(function (root) {
  'use strict';

  const NS = (root.DataDeck = root.DataDeck || {});

  const REGIONS = [
    { id: 'us-east', label: 'US East' },
    { id: 'eu-west', label: 'EU West' },
    { id: 'ap-south', label: 'AP South' },
    { id: 'me-central', label: 'ME Central' },
  ];

  const OWNERS = [
    'Ayesha Khan',
    'Bilal Raza',
    'Sara Malik',
    'Hamza Ali',
    'Noor Fatima',
    'Usman Tariq',
    'Hira Aslam',
    'Zain Ahmed',
  ];

  const GROUPS = [
    'checkout', 'billing', 'search', 'notifications', 'inventory', 'orders',
    'profiles', 'analytics', 'media', 'reports', 'messaging', 'shipping',
  ];

  const KINDS = [
    { suffix: 'api', category: 'API' },
    { suffix: 'db', category: 'Database' },
    { suffix: 'cache', category: 'Cache' },
    { suffix: 'worker', category: 'Worker' },
  ];

  /** Small seeded random generator: same seed => same demo data every time. */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const round2 = (n) => Math.round(n * 100) / 100;

  /** Pick a fresh latency that fits the status. Down / maintenance have none. */
  function freshLatency(status, rand) {
    if (status === 'operational') return Math.round(25 + rand() * 95);
    if (status === 'degraded') return Math.round(240 + rand() * 500);
    return null;
  }

  function createServices(seed = 2026, now = Date.now()) {
    const rand = mulberry32(seed);
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];
    const list = [];
    let n = 0;

    GROUPS.forEach((group) => {
      KINDS.forEach((kind) => {
        n += 1;
        const r = rand();
        const status = r < 0.78 ? 'operational' : r < 0.88 ? 'degraded' : r < 0.94 ? 'down' : 'maintenance';
        const uptime =
          status === 'operational' ? 99.5 + rand() * 0.5
          : status === 'degraded' ? 97 + rand() * 2.5
          : status === 'down' ? 92 + rand() * 5
          : 99 + rand() * 0.9;

        // 30 daily uptime values, used for the bars in the detail panel.
        const history = Array.from({ length: 30 }, () =>
          round2(100 - (rand() < 0.12 ? rand() * 6 : rand() * 0.4))
        );

        list.push({
          id: 'svc-' + String(n).padStart(3, '0'),
          name: group + '-' + kind.suffix,
          category: kind.category,
          region: pick(REGIONS).id,
          owner: pick(OWNERS),
          status,
          uptime: round2(uptime),
          latency: freshLatency(status, rand),
          checkedAt: now - Math.floor(rand() * 45000),
          history,
        });
      });
    });
    return list;
  }

  // Chance (per check) that a service moves from one status to another.
  const TRANSITIONS = {
    operational: [['degraded', 0.03], ['down', 0.006]],
    degraded: [['operational', 0.25], ['down', 0.07]],
    down: [['degraded', 0.2]],
    maintenance: [['operational', 0.08]],
  };

  /**
   * One simulated monitoring round. About 30% of services get "checked":
   * their latency moves a little and they may change status.
   * Mutates `services` and returns the list of status changes.
   */
  function tick(services, rand, now) {
    const changes = [];
    services.forEach((s) => {
      if (rand() > 0.3) return;
      s.checkedAt = now;

      let next = s.status;
      const roll = rand();
      let acc = 0;
      for (const [to, p] of TRANSITIONS[s.status]) {
        acc += p;
        if (roll < acc) { next = to; break; }
      }

      if (next !== s.status) {
        changes.push({ id: s.id, name: s.name, from: s.status, to: next, at: now });
        s.status = next;
        s.latency = freshLatency(next, rand);
      } else if (s.latency != null) {
        const [lo, hi] = s.status === 'operational' ? [18, 140] : [220, 820];
        s.latency = Math.round(clamp(s.latency * (0.85 + rand() * 0.3), lo, hi));
      }

      if (s.status === 'down') s.uptime = round2(Math.max(85, s.uptime - 0.05));
      else if (s.status === 'operational') s.uptime = round2(Math.min(100, s.uptime + 0.01));
    });
    return changes;
  }

  const api = { REGIONS, OWNERS, mulberry32, createServices, tick };

  NS.data = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
