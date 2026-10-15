const test = require('node:test');
const assert = require('node:assert/strict');

const logic = require('../js/logic.js');
const data = require('../js/data.js');

const sample = () => [
  { id: '1', name: 'alpha-api', category: 'API', region: 'us-east', owner: 'Ayesha Khan', status: 'operational', uptime: 99.9, latency: 50, checkedAt: 3000 },
  { id: '2', name: 'beta-db', category: 'Database', region: 'eu-west', owner: 'Bilal Raza', status: 'down', uptime: 93, latency: null, checkedAt: 1000 },
  { id: '3', name: 'gamma-cache', category: 'Cache', region: 'us-east', owner: 'Sara Malik', status: 'degraded', uptime: 98, latency: 400, checkedAt: 2000 },
  { id: '4', name: 'delta-worker', category: 'Worker', region: 'ap-south', owner: 'Hamza Ali', status: 'maintenance', uptime: 99.4, latency: null, checkedAt: 4000 },
];

test('filter: search matches name, owner and region (case-insensitive)', () => {
  assert.deepEqual(logic.filterServices(sample(), { q: 'BETA' }).map((s) => s.id), ['2']);
  assert.deepEqual(logic.filterServices(sample(), { q: 'sara' }).map((s) => s.id), ['3']);
  assert.deepEqual(logic.filterServices(sample(), { q: 'ap-south' }).map((s) => s.id), ['4']);
  assert.equal(logic.filterServices(sample(), { q: 'zzz' }).length, 0);
});

test('filter: status and region combine with search', () => {
  assert.equal(logic.filterServices(sample(), { status: 'down' }).length, 1);
  assert.equal(logic.filterServices(sample(), { region: 'us-east' }).length, 2);
  assert.deepEqual(logic.filterServices(sample(), { region: 'us-east', status: 'degraded' }).map((s) => s.id), ['3']);
  assert.deepEqual(logic.filterServices(sample(), { region: 'us-east', q: 'alpha' }).map((s) => s.id), ['1']);
});

test('sort: by name both directions, does not mutate the input', () => {
  const input = sample();
  const asc = logic.sortServices(input, 'name', 'asc').map((s) => s.name);
  assert.deepEqual(asc, ['alpha-api', 'beta-db', 'delta-worker', 'gamma-cache']);
  assert.deepEqual(logic.sortServices(input, 'name', 'desc').map((s) => s.name), [...asc].reverse());
  assert.equal(input[0].name, 'alpha-api');
});

test('sort: status puts the most urgent first', () => {
  assert.deepEqual(logic.sortServices(sample(), 'status', 'asc').map((s) => s.status),
    ['down', 'degraded', 'maintenance', 'operational']);
});

test('sort: empty latency always goes last, in either direction', () => {
  const asc = logic.sortServices(sample(), 'latency', 'asc').map((s) => s.id);
  const desc = logic.sortServices(sample(), 'latency', 'desc').map((s) => s.id);
  assert.deepEqual(asc.slice(0, 2), ['1', '3']);
  assert.deepEqual(desc.slice(0, 2), ['3', '1']);
  assert.deepEqual(asc.slice(2).sort(), ['2', '4']);
  assert.deepEqual(desc.slice(2).sort(), ['2', '4']);
});

test('sort: an unknown key falls back to name', () => {
  assert.equal(logic.sortServices(sample(), 'nope', 'asc')[0].name, 'alpha-api');
});

test('paginate: slices, reports ranges and clamps the page', () => {
  const items = Array.from({ length: 23 }, (_, i) => i);
  const p2 = logic.paginate(items, 2, 10);
  assert.deepEqual([p2.page, p2.pages, p2.from, p2.to, p2.total], [2, 3, 11, 20, 23]);
  assert.equal(p2.items.length, 10);
  assert.equal(logic.paginate(items, 3, 10).items.length, 3);
  assert.equal(logic.paginate(items, 99, 10).page, 3);
  assert.equal(logic.paginate(items, -4, 10).page, 1);
  const empty = logic.paginate([], 1, 10);
  assert.deepEqual([empty.from, empty.to, empty.pages], [0, 0, 1]);
});

test('pageWindow: keeps first, last and neighbours with gaps', () => {
  assert.deepEqual(logic.pageWindow(1, 3), [1, 2, 3]);
  assert.deepEqual(logic.pageWindow(6, 12), [1, '…', 5, 6, 7, '…', 12]);
  assert.deepEqual(logic.pageWindow(1, 12), [1, 2, '…', 12]);
});

test('csv: escapes quotes/commas and neutralises spreadsheet formulas', () => {
  assert.equal(logic.csvCell('plain'), 'plain');
  assert.equal(logic.csvCell('a,b'), '"a,b"');
  assert.equal(logic.csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(logic.csvCell('=SUM(A1:A9)'), "'=SUM(A1:A9)");
  const csv = logic.toCSV(sample().slice(0, 2), { 'us-east': 'US East' });
  const lines = csv.split('\r\n');
  assert.equal(lines.length, 3);
  assert.match(lines[1], /^alpha-api,API,US East,Ayesha Khan,operational,99\.90,50,/);
  assert.match(lines[2], /,down,93\.00,,/); // empty latency stays empty
});

test('relativeTime formats seconds, minutes and hours', () => {
  assert.equal(logic.relativeTime(1000, 2000), 'just now');
  assert.equal(logic.relativeTime(0, 12000), '12s ago');
  assert.equal(logic.relativeTime(0, 5 * 60000), '5m ago');
  assert.equal(logic.relativeTime(0, 3 * 3600000), '3h ago');
});

test('data: createServices is deterministic and well-formed', () => {
  const a = data.createServices(2026, 1_000_000);
  const b = data.createServices(2026, 1_000_000);
  assert.deepEqual(a, b);
  assert.equal(a.length, 48);
  assert.equal(new Set(a.map((s) => s.id)).size, 48);
  assert.equal(new Set(a.map((s) => s.name)).size, 48);
  a.forEach((s) => {
    assert.ok(logic.STATUSES.includes(s.status));
    assert.ok(s.uptime >= 90 && s.uptime <= 100);
    assert.equal(s.history.length, 30);
    const shouldHaveLatency = s.status === 'operational' || s.status === 'degraded';
    assert.equal(s.latency != null, shouldHaveLatency);
  });
});

test('data: tick keeps the data consistent and reports real changes', () => {
  const services = data.createServices(2026, 1_000_000);
  const rand = data.mulberry32(99);
  let allChanges = 0;
  for (let i = 0; i < 200; i++) {
    const before = new Map(services.map((s) => [s.id, s.status]));
    const changes = data.tick(services, rand, 1_000_000 + i * 3000);
    changes.forEach((c) => {
      assert.equal(c.from, before.get(c.id));
      assert.notEqual(c.from, c.to);
      assert.equal(services.find((s) => s.id === c.id).status, c.to);
    });
    allChanges += changes.length;
    services.forEach((s) => {
      assert.ok(logic.STATUSES.includes(s.status));
      assert.ok(s.uptime >= 85 && s.uptime <= 100);
      if (s.status === 'down' || s.status === 'maintenance') assert.equal(s.latency, null);
      else assert.ok(s.latency >= 18 && s.latency <= 820, `latency ${s.latency}`);
    });
  }
  assert.ok(allChanges > 20, 'the simulation should produce visible activity');
});
