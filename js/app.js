/*
 * app.js — the user interface.
 * Reads state, renders it with small DOM helpers (textContent only, never
 * innerHTML, so nothing from the data can inject markup) and reacts to events.
 */
(function () {
  'use strict';

  const { logic, data } = window.DataDeck;

  /* ---------- constants ---------- */
  const TICK_MS = 3000;
  const HISTORY_POINTS = 30;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const STATUS_LABEL = { operational: 'Operational', degraded: 'Degraded', down: 'Down', maintenance: 'Maintenance' };
  const STATUS_COLOR = { operational: 'var(--ok)', degraded: 'var(--warn)', down: 'var(--bad)', maintenance: 'var(--idle)' };
  const REGION_LABEL = Object.fromEntries(data.REGIONS.map((r) => [r.id, r.label]));
  const PAGE_SIZES = [10, 25, 50];
  const DEFAULTS = { q: '', status: 'all', region: 'all', sort: 'status', dir: 'asc', page: 1, size: 10 };
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- tiny DOM helpers ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);

  function el(tag, props, ...kids) {
    const node = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
        else node.setAttribute(k, v === true ? '' : v);
      }
    }
    kids.flat().forEach((c) => {
      if (c == null || c === false) return;
      node.append(c.nodeType ? c : document.createTextNode(String(c)));
    });
    return node;
  }

  function svgEl(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }

  function icon(name) {
    const svg = svgEl('svg', { class: 'icon', viewBox: '0 0 24 24', 'aria-hidden': 'true' });
    svg.append(svgEl('use', { href: '#i-' + name }));
    return svg;
  }

  const pill = (status, flash) =>
    el('span', { class: `pill pill--${status}${flash ? ' pill--flash' : ''}` }, STATUS_LABEL[status]);

  function avatar(name) {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
    const a = el('span', { class: 'avatar', 'aria-hidden': 'true' }, logic.initials(name));
    a.style.background = `hsl(${h} 48% 42%)`;
    return a;
  }

  const fmtLatency = (ms) => (ms == null ? null : ms + ' ms');

  /* ---------- state ---------- */
  const state = {
    services: data.createServices(),
    ...DEFAULTS,
    live: true,
    changed: new Set(),   // ids that changed in the latest tick (for the flash effect)
    events: [],           // status changes seen this session, newest first
    history: [],          // average latency over time (for the chart)
    openId: null,         // service shown in the drawer
  };

  function averageLatency() {
    const withLatency = state.services.filter((s) => s.latency != null);
    if (!withLatency.length) return 0;
    return Math.round(withLatency.reduce((sum, s) => sum + s.latency, 0) / withLatency.length);
  }

  // Warm-up so the chart is not empty on first load.
  (function seedHistory() {
    const rand = data.mulberry32(7);
    const base = averageLatency();
    for (let i = 0; i < HISTORY_POINTS - 1; i++) state.history.push(Math.round(base * (0.9 + rand() * 0.22)));
    state.history.push(base);
  })();

  /* ---------- URL <-> state (filters survive a refresh and can be shared) ---------- */
  function readUrl() {
    let p;
    try { p = new URLSearchParams(window.location.search); } catch (e) { return; }
    const status = p.get('status');
    const region = p.get('region');
    const sort = p.get('sort');
    const size = parseInt(p.get('size'), 10);
    const page = parseInt(p.get('page'), 10);
    state.q = (p.get('q') || '').slice(0, 80);
    if (status && logic.STATUSES.includes(status)) state.status = status;
    if (region && REGION_LABEL[region]) state.region = region;
    if (sort && logic.SORT_KEYS.includes(sort)) state.sort = sort;
    if (p.get('dir') === 'asc' || p.get('dir') === 'desc') state.dir = p.get('dir');
    if (PAGE_SIZES.includes(size)) state.size = size;
    if (page > 0) state.page = page;
  }

  function writeUrl() {
    const p = new URLSearchParams();
    ['q', 'status', 'region', 'sort', 'dir', 'page', 'size'].forEach((k) => {
      if (String(state[k]) !== String(DEFAULTS[k])) p.set(k, state[k]);
    });
    const qs = p.toString();
    try {
      window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash);
    } catch (e) { /* some browsers block this on file:// — the app still works */ }
  }

  /* ---------- derived data ---------- */
  function visibleRows() {
    return logic.sortServices(logic.filterServices(state.services, state), state.sort, state.dir);
  }

  const filtersActive = () => state.q.trim() !== '' || state.status !== 'all' || state.region !== 'all';

  /* ---------- KPI cards ---------- */
  function renderKpis() {
    const counts = logic.countBy(state.services, 'status');
    const total = state.services.length;
    const ok = counts.operational || 0;
    const degraded = counts.degraded || 0;
    const down = counts.down || 0;
    const avg = state.history[state.history.length - 1];
    const prev = state.history[state.history.length - 2];
    const delta = avg - prev;

    const card = (tone, iconName, label, value, unit, hint) =>
      el('article', { class: `kpi kpi--${tone}` },
        el('div', { class: 'kpi__icon' }, icon(iconName)),
        el('div', null,
          el('p', { class: 'kpi__label' }, label),
          el('p', { class: 'kpi__value' }, value, unit ? el('small', null, unit) : null),
          el('p', { class: 'kpi__hint' }, hint)));

    $('#kpis').replaceChildren(
      card('accent', 'server', 'Total services', total, '', `Across ${data.REGIONS.length} regions`),
      card('ok', 'check', 'Operational', Math.round((ok / total) * 100), '%', `${ok} of ${total} services healthy`),
      card('accent', 'clock', 'Avg response time', avg, 'ms',
        delta === 0 ? 'No change since last check' : `${delta > 0 ? '▲ +' : '▼ '}${delta} ms since last check`),
      card(down > 0 ? 'bad' : 'warn', 'alert', 'Active incidents', down + degraded, '', `${down} down · ${degraded} degraded`)
    );
  }

  /* ---------- line chart (inline SVG) ---------- */
  function renderChart() {
    const W = 640, H = 300, L = 46, R = 10, T = 12, B = 26;
    const h = state.history;
    const lo = Math.floor(Math.min(...h) - 6);
    const hi = Math.max(Math.ceil(Math.max(...h) + 6), lo + 12);
    const x = (i) => L + (i * (W - L - R)) / (h.length - 1);
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);

    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' });

    const defs = svgEl('defs', {});
    const grad = svgEl('linearGradient', { id: 'areaFill', x1: '0', y1: '0', x2: '0', y2: '1' });
    grad.append(
      svgEl('stop', { offset: '0%', style: 'stop-color: currentColor; stop-opacity: 0.28' }),
      svgEl('stop', { offset: '100%', style: 'stop-color: currentColor; stop-opacity: 0' }));
    defs.append(grad);
    svg.append(defs);

    for (let i = 0; i <= 4; i++) {
      const v = lo + ((hi - lo) * i) / 4;
      const gy = y(v);
      svg.append(svgEl('line', { class: 'grid-line', x1: L, x2: W - R, y1: gy, y2: gy }));
      const t = svgEl('text', { class: 'axis-label', x: L - 8, y: gy + 4, 'text-anchor': 'end' });
      t.textContent = Math.round(v) + ' ms';
      svg.append(t);
    }

    const pts = h.map((v, i) => [x(i), y(v)]);
    const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
    svg.append(svgEl('path', { d: `${line} L${x(h.length - 1)} ${H - B} L${L} ${H - B} Z`, fill: 'url(#areaFill)' }));
    svg.append(svgEl('path', { class: 'line', d: line }));

    pts.forEach(([px, py], i) => {
      const hit = svgEl('circle', { class: 'hit', cx: px, cy: py, r: 6 });
      const tip = svgEl('title', {});
      tip.textContent = `${h[i]} ms (${i === h.length - 1 ? 'now' : h.length - 1 - i + ' checks ago'})`;
      hit.append(tip);
      svg.append(hit);
    });
    const last = pts[pts.length - 1];
    svg.append(svgEl('circle', { class: 'dot-last', cx: last[0], cy: last[1], r: 4.5 }));

    const x0 = svgEl('text', { class: 'axis-label', x: L, y: H - 6 });
    x0.textContent = `${h.length - 1} checks ago`;
    const x1 = svgEl('text', { class: 'axis-label', x: W - R, y: H - 6, 'text-anchor': 'end' });
    x1.textContent = 'now';
    svg.append(x0, x1);

    const chart = $('#chart');
    chart.setAttribute('aria-label', `Line chart of average response time. Latest value ${h[h.length - 1]} milliseconds.`);
    chart.replaceChildren(svg);
    $('#chartNow').textContent = `Now ${h[h.length - 1]} ms`;

    const avgAll = Math.round(h.reduce((a, b) => a + b, 0) / h.length);
    const stat = (label, value) =>
      el('div', { class: 'chart-stat' }, el('dt', null, label), el('dd', null, value + ' ms'));
    $('#chartStats').replaceChildren(
      stat('Lowest', Math.min(...h)), stat('Average', avgAll), stat('Highest', Math.max(...h)));
  }

  /* ---------- status breakdown + live activity ---------- */
  function renderBreakdown() {
    const counts = logic.countBy(state.services, 'status');
    const total = state.services.length;

    $('#stack').replaceChildren(
      ...logic.STATUSES.filter((s) => counts[s]).map((s) => {
        const seg = el('span', { class: `stack__seg seg--${s}` });
        seg.style.flexBasis = (counts[s] / total) * 100 + '%';
        seg.style.flexGrow = counts[s];
        return seg;
      }));

    $('#legend').replaceChildren(
      ...logic.STATUSES.map((s) => {
        const n = counts[s] || 0;
        const dot = el('span', { class: 'legend__dot' });
        dot.style.background = STATUS_COLOR[s];
        return el('li', null,
          el('button', {
            class: 'legend__row', type: 'button', 'aria-pressed': String(state.status === s),
            'aria-label': `Show ${STATUS_LABEL[s]} services (${n})`,
            onclick: () => { setFilter({ status: state.status === s ? 'all' : s }); scrollToTable(); },
          },
          dot, el('span', { class: 'legend__name' }, STATUS_LABEL[s]),
          el('span', { class: 'legend__count' }, n),
          el('span', { class: 'legend__pct' }, Math.round((n / total) * 100) + '%')));
      }));
  }

  function eventItem(ev, withName, isNew) {
    const dot = el('span', { class: 'feed__dot' });
    dot.style.background = STATUS_COLOR[ev.to];
    return el('li', { class: 'feed__item' + (isNew ? ' is-new' : '') },
      dot,
      el('span', null,
        withName ? el('strong', null, ev.name) : null, withName ? ' ' : null,
        `${withName ? 'went' : 'Went'} from ${STATUS_LABEL[ev.from]} to `, el('strong', null, STATUS_LABEL[ev.to])),
      el('span', { class: 'feed__time', 'data-ts': ev.at }, logic.relativeTime(ev.at, Date.now())));
  }

  let lastFeedTop = null;
  function renderFeed() {
    const feed = $('#feed');
    if (!state.events.length) {
      feed.replaceChildren(el('li', { class: 'feed__empty' }, 'Waiting for the first status change…'));
      return;
    }
    const top = state.events[0];
    feed.replaceChildren(...state.events.slice(0, 5).map((ev) => eventItem(ev, true, ev === top && top !== lastFeedTop)));
    lastFeedTop = top;
  }

  /* ---------- filter chips + selects ---------- */
  function renderChips() {
    // Counts respect the search text and region, so each chip shows what you would get.
    const base = logic.filterServices(state.services, { q: state.q, region: state.region, status: 'all' });
    const counts = logic.countBy(base, 'status');
    const defs = [['all', 'All', base.length], ...logic.STATUSES.map((s) => [s, STATUS_LABEL[s], counts[s] || 0])];
    $('#chips').replaceChildren(
      ...defs.map(([key, label, n]) =>
        el('button', {
          class: 'chip', type: 'button', 'aria-pressed': String(state.status === key),
          onclick: () => setFilter({ status: key }),
        }, label, el('span', { class: 'chip__count' }, n))));
  }

  function buildSelects() {
    const region = $('#region');
    region.setAttribute('aria-label', 'Filter by region');
    region.replaceChildren(
      el('option', { value: 'all' }, 'All regions'),
      ...data.REGIONS.map((r) => el('option', { value: r.id }, r.label)));
    region.addEventListener('change', () => setFilter({ region: region.value }));

    $('#sortSelect').setAttribute('aria-label', 'Sort services');
    $('#sortSelect').addEventListener('change', (e) => {
      const [sort, dir] = e.target.value.split(':');
      setFilter({ sort, dir });
    });
    $('#pageSize').addEventListener('change', (e) => setFilter({ size: parseInt(e.target.value, 10) }));
  }

  function syncControls() {
    $('#region').value = state.region;
    $('#pageSize').value = String(state.size);
    const search = $('#search');
    if (search.value !== state.q) search.value = state.q;
    const combo = `${state.sort}:${state.dir}`;
    const sortSelect = $('#sortSelect');
    // Header clicks can pick combinations the mobile select does not list; keep it honest.
    if (![...sortSelect.options].some((o) => o.value === combo)) {
      sortSelect.append(el('option', { value: combo, hidden: true }, 'Sort: custom'));
    }
    sortSelect.value = combo;
    $('#resetBtn').hidden = !filtersActive();
  }

  /* ---------- table ---------- */
  function renderTable() {
    const rows = visibleRows();
    const pg = logic.paginate(rows, state.page, state.size);
    state.page = pg.page;

    // header sort indicators
    document.querySelectorAll('th[aria-sort]').forEach((th) => {
      const key = th.querySelector('[data-sort]').dataset.sort;
      th.setAttribute('aria-sort', key === state.sort ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    });

    const hasRows = pg.total > 0;
    $('#tableWrap').hidden = !hasRows;
    $('#empty').hidden = hasRows;
    $('#pager').hidden = !hasRows;

    $('#resultSummary').textContent = hasRows
      ? `${pg.total} of ${state.services.length} services${filtersActive() ? ' match your filters' : ''}`
      : 'No matching services';

    $('#tbody').replaceChildren(...pg.items.map(rowFor));
    renderPager(pg);
  }

  function rowFor(s) {
    const changed = state.changed.has(s.id);
    const meterClass = s.uptime >= 99 ? '' : s.uptime >= 97 ? ' meter--warn' : ' meter--bad';
    const meterFill = el('span');
    meterFill.style.width = Math.max(4, ((s.uptime - 85) / 15) * 100) + '%';

    return el('tr', { 'data-id': s.id, class: changed ? 'is-changed' : null },
      el('td', { class: 'cell-service' },
        el('div', { class: 'svc' },
          el('button', { class: 'svc__name', type: 'button', 'aria-label': `View details for ${s.name}`, 'data-open': s.id }, s.name),
          el('span', { class: 'svc__meta' }, s.category))),
      el('td', { 'data-label': 'Region', class: 'cell-region' }, REGION_LABEL[s.region]),
      el('td', { 'data-label': 'Owner', class: 'cell-owner' }, el('span', { class: 'owner' }, avatar(s.owner), s.owner)),
      el('td', { 'data-label': 'Status', class: 'cell-status' }, pill(s.status, changed)),
      el('td', { 'data-label': 'Uptime', class: 'num cell-uptime' },
        el('div', { class: 'uptime' }, el('span', null, s.uptime.toFixed(2) + '%'), el('span', { class: 'meter' + meterClass }, meterFill))),
      el('td', { 'data-label': 'Latency', class: 'num cell-latency' },
        s.latency == null
          ? el('span', { class: 'dash', title: 'No response' }, '—')
          : el('span', { class: s.latency >= 220 ? 'latency-warn' : null }, fmtLatency(s.latency))),
      el('td', { 'data-label': 'Last check', class: 'num cell-check' },
        el('span', { 'data-ts': s.checkedAt }, logic.relativeTime(s.checkedAt, Date.now()))));
  }

  function renderPager(pg) {
    $('#pageInfo').replaceChildren(
      'Showing ', el('strong', null, `${pg.from}–${pg.to}`), ' of ', el('strong', null, pg.total));

    const go = (p) => setFilter({ page: p }, { keepPage: true });
    const nav = $('#pageNav');
    nav.replaceChildren(
      el('button', { class: 'page-btn', type: 'button', 'aria-label': 'Previous page', disabled: pg.page === 1, onclick: () => go(pg.page - 1) }, icon('left')),
      ...logic.pageWindow(pg.page, pg.pages).map((n) =>
        n === '…'
          ? el('span', { class: 'page-gap', 'aria-hidden': 'true' }, '…')
          : el('button', {
              class: 'page-btn', type: 'button', 'aria-label': `Page ${n}`,
              'aria-current': n === pg.page ? 'page' : null, onclick: () => go(n),
            }, n)),
      el('button', { class: 'page-btn', type: 'button', 'aria-label': 'Next page', disabled: pg.page === pg.pages, onclick: () => go(pg.page + 1) }, icon('right')));
  }

  /* ---------- state changes from the user ---------- */
  function setFilter(patch, opts = {}) {
    Object.assign(state, patch);
    if (!opts.keepPage) state.page = 1;
    writeUrl();
    syncControls();
    renderChips();
    renderBreakdown();
    renderTable();
  }

  function resetFilters() {
    Object.assign(state, { q: '', status: 'all', region: 'all', page: 1 });
    writeUrl();
    syncControls();
    renderChips();
    renderBreakdown();
    renderTable();
  }

  function scrollToTable() {
    $('#services').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }

  /* ---------- drawer ---------- */
  let drawerOpener = null;

  function openDrawer(id, opener) {
    state.openId = id;
    drawerOpener = opener || document.activeElement;
    renderDrawer();
    const drawer = $('#drawer');
    const scrim = $('#drawerScrim');
    drawer.hidden = false;
    scrim.hidden = false;
    requestAnimationFrame(() => {
      drawer.classList.add('is-open');
      scrim.classList.add('is-open');
      $('#drawerClose').focus();
    });
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    if (!state.openId) return;
    state.openId = null;
    const drawer = $('#drawer');
    const scrim = $('#drawerScrim');
    drawer.classList.remove('is-open');
    scrim.classList.remove('is-open');
    document.body.style.overflow = '';
    setTimeout(() => { if (!state.openId) { drawer.hidden = true; scrim.hidden = true; } }, reduceMotion ? 0 : 260);
    if (drawerOpener && document.contains(drawerOpener)) drawerOpener.focus();
  }

  function renderDrawer() {
    const s = state.services.find((x) => x.id === state.openId);
    if (!s) return;
    $('#drawerTitle').textContent = s.name;

    const detail = (label, value) => el('div', { class: 'detail' }, el('dt', null, label), el('dd', null, value));
    const mine = state.events.filter((ev) => ev.id === s.id).slice(0, 6);

    const bars = el('div', { class: 'bars', role: 'img', 'aria-label': 'Daily uptime for the last 30 days' },
      ...s.history.map((v, i) => {
        const b = el('span', { class: v >= 99 ? null : v >= 97 ? 'bar--warn' : 'bar--bad', title: `Day ${i + 1}: ${v}%` });
        b.style.height = Math.max(6, ((v - 90) / 10) * 100) + '%';
        return b;
      }));

    $('#drawerBody').replaceChildren(
      el('div', null, pill(s.status)),
      el('dl', { class: 'detail-grid' },
        detail('Category', s.category),
        detail('Region', REGION_LABEL[s.region]),
        detail('Owner', s.owner),
        detail('Uptime', s.uptime.toFixed(2) + '%'),
        detail('Latency', fmtLatency(s.latency) || 'No response'),
        detail('Last check', logic.relativeTime(s.checkedAt, Date.now()))),
      el('section', null,
        el('h3', { class: 'section-title' }, 'Uptime · last 30 days'),
        bars,
        el('div', { class: 'bars-axis' }, el('span', null, '30 days ago'), el('span', null, 'Today'))),
      el('section', null,
        el('h3', { class: 'section-title' }, 'Status changes this session'),
        mine.length
          ? el('ul', { class: 'feed__list' }, mine.map((ev) => eventItem(ev, false, false)))
          : el('p', { class: 'feed__empty' }, 'No status changes yet. Keep this panel open and watch.')));
  }

  function trapFocus(e) {
    if (e.key !== 'Tab' || !state.openId) return;
    const items = [...$('#drawer').querySelectorAll('button, [href], input, select, [tabindex]:not([tabindex="-1"])')]
      .filter((n) => !n.disabled && n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* ---------- toasts ---------- */
  function toast(kind, title, message) {
    const box = $('#toasts');
    const t = el('div', { class: `toast toast--${kind}`, role: 'status' },
      el('div', null, el('p', { class: 'toast__title' }, title), el('p', { class: 'toast__msg' }, message)));
    box.append(t);
    while (box.children.length > 3) box.firstElementChild.remove();
    setTimeout(() => {
      t.classList.add('is-leaving');
      setTimeout(() => t.remove(), 300);
    }, 4200);
  }

  /* ---------- CSV export ---------- */
  function exportCsv() {
    const rows = visibleRows();
    if (!rows.length) { toast('bad', 'Nothing to export', 'Your filters match no services.'); return; }
    const csv = '﻿' + logic.toCSV(rows, REGION_LABEL); // BOM so Excel reads UTF-8 correctly
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = el('a', { href: url, download: `datadeck-services-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('ok', 'Export ready', `${rows.length} service${rows.length === 1 ? '' : 's'} saved as CSV.`);
  }

  /* ---------- live updates ---------- */
  let timer = null;

  function tickOnce() {
    const now = Date.now();
    const changes = data.tick(state.services, Math.random, now);
    state.changed = new Set(changes.map((c) => c.id));

    changes.forEach((c) => state.events.unshift(c));
    state.events = state.events.slice(0, 40);

    changes.filter((c) => c.to === 'down').slice(0, 2).forEach((c) =>
      toast('bad', `${c.name} is down`, `Changed from ${STATUS_LABEL[c.from]} to Down.`));

    state.history.push(averageLatency());
    if (state.history.length > HISTORY_POINTS) state.history.shift();

    renderAll();
    if (state.openId) renderDrawer();
  }

  function setLive(on) {
    state.live = on;
    clearInterval(timer);
    if (on) timer = setInterval(() => { if (!document.hidden) tickOnce(); }, TICK_MS);
    const btn = $('#liveBtn');
    btn.setAttribute('aria-pressed', String(on));
    $('#liveText').textContent = on ? 'Live' : 'Paused';
    btn.title = on ? 'Pause live updates' : 'Resume live updates';
  }

  // Keep "12s ago" labels fresh between ticks without re-rendering anything.
  function refreshTimes() {
    const now = Date.now();
    document.querySelectorAll('[data-ts]').forEach((n) => {
      n.textContent = logic.relativeTime(Number(n.dataset.ts), now);
    });
    const newest = Math.max(...state.services.map((s) => s.checkedAt));
    $('#liveTime').textContent = 'Updated ' + logic.relativeTime(newest, now);
  }

  /* ---------- theme ---------- */
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    $('#themeIcon').setAttribute('href', theme === 'dark' ? '#i-sun' : '#i-moon');
    $('#themeBtn').setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  }

  /* ---------- mobile navigation ---------- */
  function setMenu(open) {
    $('#sidebar').classList.toggle('is-open', open);
    $('#scrim').hidden = !open;
    $('#menuBtn').setAttribute('aria-expanded', String(open));
  }

  /* ---------- wiring ---------- */
  function renderAll() {
    renderKpis();
    renderChart();
    renderBreakdown();
    renderFeed();
    renderChips();
    renderTable();
    refreshTimes();
  }

  function bindEvents() {
    // search (debounced)
    let debounce;
    $('#search').addEventListener('input', (e) => {
      clearTimeout(debounce);
      const value = e.target.value;
      debounce = setTimeout(() => setFilter({ q: value }), 140);
    });
    $('#search').addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && e.target.value) { e.target.value = ''; setFilter({ q: '' }); }
    });

    // sorting: click the header; same column flips direction
    document.querySelector('thead').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-sort]');
      if (!btn) return;
      const key = btn.dataset.sort;
      const dir = state.sort === key && state.dir === 'asc' ? 'desc' : 'asc';
      setFilter({ sort: key, dir });
    });

    // open details by clicking a row or its name button
    $('#tbody').addEventListener('click', (e) => {
      const row = e.target.closest('tr[data-id]');
      if (!row) return;
      openDrawer(row.dataset.id, row.querySelector('.svc__name'));
    });

    $('#drawerClose').addEventListener('click', closeDrawer);
    $('#drawerScrim').addEventListener('click', closeDrawer);
    $('#exportBtn').addEventListener('click', exportCsv);
    $('#resetBtn').addEventListener('click', resetFilters);
    $('#emptyReset').addEventListener('click', resetFilters);
    $('#liveBtn').addEventListener('click', () => setLive(!state.live));
    $('#themeBtn').addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem('datadeck-theme', next); } catch (e) { /* private mode: ignore */ }
    });

    $('#menuBtn').addEventListener('click', () => setMenu(!$('#sidebar').classList.contains('is-open')));
    $('#scrim').addEventListener('click', () => setMenu(false));
    document.querySelectorAll('.nav__link').forEach((a) =>
      a.addEventListener('click', () => {
        document.querySelectorAll('.nav__link').forEach((n) => n.removeAttribute('aria-current'));
        a.setAttribute('aria-current', 'page');
        setMenu(false);
      }));

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeDrawer(); setMenu(false); }
      trapFocus(e);
      const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); $('#search').focus(); }
    });
  }

  /* ---------- start ---------- */
  readUrl();
  applyTheme(document.documentElement.getAttribute('data-theme') || 'light');
  buildSelects();
  bindEvents();
  syncControls();
  renderAll();
  setLive(true);
  setInterval(refreshTimes, 1000);
})();
