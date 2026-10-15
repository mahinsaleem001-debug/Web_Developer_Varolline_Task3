/*
 * logic.js — pure data helpers (no DOM).
 * Filtering, sorting, pagination, CSV export and small formatters.
 * Kept free of browser code so the same file can be unit-tested with Node.
 */
(function (root) {
  'use strict';

  const NS = (root.DataDeck = root.DataDeck || {});

  const STATUSES = ['operational', 'degraded', 'down', 'maintenance'];

  // Lower number = more urgent. Sorting by status ascending shows problems first.
  const SEVERITY = { down: 0, degraded: 1, maintenance: 2, operational: 3 };

  const SORT_KEYS = ['name', 'region', 'owner', 'status', 'uptime', 'latency', 'checkedAt'];

  const lower = (v) => String(v == null ? '' : v).toLowerCase();

  /** Keep only the services that match the search text, status and region. */
  function filterServices(list, { q = '', status = 'all', region = 'all' } = {}) {
    const term = lower(q).trim();
    return list.filter((s) => {
      if (status !== 'all' && s.status !== status) return false;
      if (region !== 'all' && s.region !== region) return false;
      if (!term) return true;
      return [s.name, s.category, s.owner, s.region, s.status].some((v) => lower(v).includes(term));
    });
  }

  function compareValues(a, b, key) {
    switch (key) {
      case 'name':
      case 'region':
      case 'owner':
        return String(a[key]).localeCompare(String(b[key]));
      case 'status':
        return SEVERITY[a.status] - SEVERITY[b.status];
      default:
        return a[key] - b[key];
    }
  }

  /** Returns a NEW sorted array. Empty values (latency = null) always go last. */
  function sortServices(list, key, dir) {
    const k = SORT_KEYS.includes(key) ? key : 'name';
    const sign = dir === 'desc' ? -1 : 1;
    return [...list].sort((a, b) => {
      const aEmpty = a[k] == null;
      const bEmpty = b[k] == null;
      if (aEmpty && bEmpty) return a.name.localeCompare(b.name);
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      const c = compareValues(a, b, k) * sign;
      return c !== 0 ? c : a.name.localeCompare(b.name); // stable, predictable tie-break
    });
  }

  /** Slice one page and describe it ("Showing 11–20 of 48"). */
  function paginate(items, page, size) {
    const total = items.length;
    const pageSize = Math.max(1, size | 0);
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const current = Math.min(Math.max(1, page | 0 || 1), pages);
    const start = (current - 1) * pageSize;
    return {
      items: items.slice(start, start + pageSize),
      page: current,
      pages,
      total,
      from: total === 0 ? 0 : start + 1,
      to: Math.min(total, start + pageSize),
    };
  }

  /** Page buttons to show, e.g. [1, '…', 4, 5, 6, '…', 12]. */
  function pageWindow(page, pages) {
    const keep = new Set([1, pages, page - 1, page, page + 1]);
    const nums = [...keep].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
    const out = [];
    nums.forEach((n, i) => {
      if (i > 0 && n - nums[i - 1] > 1) out.push('…');
      out.push(n);
    });
    return out;
  }

  function countBy(list, field) {
    return list.reduce((acc, item) => {
      acc[item[field]] = (acc[item[field]] || 0) + 1;
      return acc;
    }, {});
  }

  /** Cell text for CSV. Quotes are escaped, and a leading = + - @ is neutralised
   *  so a spreadsheet never treats exported text as a formula. */
  function csvCell(value) {
    let s = value == null ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(rows, regionLabels = {}) {
    const header = ['Service', 'Category', 'Region', 'Owner', 'Status', 'Uptime (%)', 'Latency (ms)', 'Last check (ISO)'];
    const lines = [header.map(csvCell).join(',')];
    rows.forEach((s) => {
      lines.push(
        [
          s.name,
          s.category,
          regionLabels[s.region] || s.region,
          s.owner,
          s.status,
          s.uptime.toFixed(2),
          s.latency == null ? '' : s.latency,
          new Date(s.checkedAt).toISOString(),
        ]
          .map(csvCell)
          .join(',')
      );
    });
    return lines.join('\r\n');
  }

  function relativeTime(ts, now) {
    const sec = Math.max(0, Math.round((now - ts) / 1000));
    if (sec < 5) return 'just now';
    if (sec < 60) return sec + 's ago';
    if (sec < 3600) return Math.floor(sec / 60) + 'm ago';
    return Math.floor(sec / 3600) + 'h ago';
  }

  function initials(name) {
    return String(name)
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0].toUpperCase())
      .join('');
  }

  const api = {
    STATUSES,
    SEVERITY,
    SORT_KEYS,
    filterServices,
    sortServices,
    paginate,
    pageWindow,
    countBy,
    csvCell,
    toCSV,
    relativeTime,
    initials,
  };

  NS.logic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
