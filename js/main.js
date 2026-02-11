/* main.js */
(() => {
  'use strict';
  if (window.__RIN_MAIN_V2__) return;
  window.__RIN_MAIN_V2__ = true;

  const $ = (id) => document.getElementById(id);
  const norm = (s) => String(s ?? '').replace(/\u3000/g, ' ').trim();

  // 画面左上ステータス（metaが無い構成でも見える）
  const ensureStatus = () => {
    let el = document.getElementById('__status');
    if (el) return el;
    el = document.createElement('div');
    el.id = '__status';
    el.style.cssText =
      'position:fixed;left:10px;top:10px;z-index:99999;' +
      'background:rgba(0,0,0,.55);color:#cfe8ff;padding:6px 8px;' +
      'border-radius:8px;font:12px ui-monospace,Menlo,Consolas,monospace;' +
      'backdrop-filter: blur(6px);';
    el.textContent = 'BOOT...';
    document.body.appendChild(el);
    return el;
  };
  const setStatus = (msg) => {
    console.log('[status]', msg);
    const el = ensureStatus();
    el.textContent = msg;
  };

  // tabs
  const initTabs = () => {
    const tabs = Array.from(document.querySelectorAll('.tab[data-tab]'));
    const panels = Array.from(document.querySelectorAll('.panel[id]'));

    const activate = (tabId) => {
      tabs.forEach((b) => b.classList.toggle('active', b.dataset.tab === tabId));
      panels.forEach((p) => p.classList.toggle('active', p.id === tabId));
    };

    tabs.forEach((b) => b.addEventListener('click', () => activate(b.dataset.tab)));
    const activeBtn = tabs.find((b) => b.classList.contains('active')) || tabs[0];
    if (activeBtn) activate(activeBtn.dataset.tab);
  };

  // date helpers
  const parseISODate = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  };
  const inRange = (dateStr, fromInclusive, toInclusive) => {
    if (!dateStr) return false;
    if (fromInclusive && dateStr < fromInclusive) return false;
    if (toInclusive && dateStr > toInclusive) return false;
    return true;
  };
  const daysDiff0 = (baseDateStr, dateStr) => {
    const base = parseISODate(baseDateStr);
    const d = parseISODate(dateStr);
    if (!base || !d) return null;
    return Math.floor((d.getTime() - base.getTime()) / 86400000);
  };

  // animations
  const animate1 = (to, id, durationMs = 900) => {
    const el = $(id);
    if (!el) return;
    const T = Math.max(0, Number(to) || 0);
    const start = performance.now();
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);

    el.textContent = '0';
    const step = (now) => {
      const t = Math.min(1, (now - start) / durationMs);
      const k = easeOut(t);
      el.textContent = String(Math.round(T * k));
      if (t < 1) requestAnimationFrame(step);
      else el.textContent = String(T);
    };
    requestAnimationFrame(step);
  };

  const animate2 = (leftTo, rightTo, leftId, rightId, durationMs = 900) => {
    const lEl = $(leftId);
    const rEl = $(rightId);
    const L = Math.max(0, Number(leftTo) || 0);
    const R = Math.max(0, Number(rightTo) || 0);
    const start = performance.now();
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);

    if (lEl) lEl.textContent = '0';
    if (rEl) rEl.textContent = '0';

    const step = (now) => {
      const t = Math.min(1, (now - start) / durationMs);
      const k = easeOut(t);
      if (lEl) lEl.textContent = String(Math.round(L * k));
      if (rEl) rEl.textContent = String(Math.round(R * k));
      if (t < 1) requestAnimationFrame(step);
      else {
        if (lEl) lEl.textContent = String(L);
        if (rEl) rEl.textContent = String(R);
      }
    };
    requestAnimationFrame(step);
  };

  const mergedUsers = (usersFromApi) => {
    const cfgUsers = Array.isArray(window.APP_CONFIG?.USERS) ? window.APP_CONFIG.USERS : [];
    const apiUsers = Array.isArray(usersFromApi) ? usersFromApi : [];
    return Array.from(new Set([...apiUsers, ...cfgUsers])).map(norm).filter(Boolean);
  };

  // -------- JSONP (api.js を絶対に使わない安定版) --------
  const LS_KEY = 'rin_counter_last_payload_v2';

  const saveLastPayload = (payload) => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(payload)); } catch {}
  };
  const loadLastPayload = () => {
    try {
      const s = localStorage.getItem(LS_KEY);
      return s ? JSON.parse(s) : null;
    } catch { return null; }
  };

  const fetchJsonp = (url, timeoutMs) =>
    new Promise((resolve, reject) => {
      const cbName = `__jsonp_cb_${Date.now().toString(36)}${Math.random().toString(16).slice(2)}`;
      const sep = url.includes('?') ? '&' : '?';
      const src = `${url}${sep}callback=${encodeURIComponent(cbName)}&_=${Date.now()}`;

      let done = false;
      let script = null;

      const cleanup = () => {
        if (script && script.parentNode) script.parentNode.removeChild(script);
        script = null;
      };

      // timeout後の遅延着弾を握りつぶす（ReferenceError防止）
      const setNoop = () => { window[cbName] = () => {}; };

      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        setNoop();
        cleanup();
        reject(new Error('JSONP timeout'));
      }, Math.max(1000, Number(timeoutMs) || 90000));

      window[cbName] = (data) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        setNoop();
        cleanup();
        resolve(data);
      };

      script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onerror = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        setNoop();
        cleanup();
        reject(new Error('JSONP load error'));
      };

      document.head.appendChild(script);
    });

  const loadData = async () => {
    const cfg = window.APP_CONFIG || {};
    const API_URL = cfg.GAS_API_EXEC_URL || cfg.API_URL || cfg.GAS_URL;
    if (!API_URL) throw new Error('GAS_API_EXEC_URL is missing');

    const timeoutMs = Number(cfg.JSONP_TIMEOUT_MS || 90000);
    const tries = Math.max(1, Number(cfg.JSONP_RETRY || 3));
    const backoff = Math.max(200, Number(cfg.JSONP_BACKOFF_MS || 800));

    let lastErr = null;
    for (let i = 0; i < tries; i++) {
      try {
        setStatus(`fetch... (try ${i + 1}/${tries})`);
        const payload = await fetchJsonp(API_URL, timeoutMs);
        if (payload && payload.ok === true) {
          saveLastPayload(payload);
          setStatus('OK');
          return payload;
        }
        throw new Error('payload not ok');
      } catch (e) {
        lastErr = e;
        setStatus(`fail: ${e?.message || e}`);
        if (i < tries - 1) {
          await new Promise((r) => setTimeout(r, backoff * Math.pow(2, i)));
        }
      }
    }

    const cached = loadLastPayload();
    if (cached && cached.ok === true) {
      setStatus('API NG → cache');
      return cached;
    }

    throw lastErr || new Error('loadData failed');
  };

  // -------- renderers --------
  const renderTotalAll = (events, usersFromApi, from, to, valueId) => {
    const users = mergedUsers(usersFromApi);
    const allow = new Set(users);
    let total = 0;
    for (const e of events || []) {
      const name = norm(e?.name);
      const date = String(e?.date || '');
      if (!name) continue;
      if (allow.size && !allow.has(name)) continue;
      if (!inRange(date, from, to)) continue;
      total++;
    }
    animate1(total, valueId, 900);
  };

  const renderFig = (events, usersFromApi, from, to, leftId, rightId) => {
    const users = mergedUsers(usersFromApi);
    const allow = new Set(users.length ? users : ['Cさん']);
    let cCount = 0;
    let others = 0;
    for (const e of events || []) {
      const name = norm(e?.name);
      const date = String(e?.date || '');
      if (!name) continue;
      if (allow.size && !allow.has(name)) continue;
      if (!inRange(date, from, to)) continue;
      if (name === 'Cさん') cCount++;
      else others++;
    }
    animate2(cCount, others, leftId, rightId, 900);
  };

  let chart = null;
  const renderGraph2026 = (events, usersFromApi) => {
    const cfg = window.APP_CONFIG || {};
    const BASE_DATE = cfg.BASE_DATE || '2026-01-01';
    const USERS = mergedUsers(usersFromApi);

    const canvas = $('cumChart');
    if (!canvas || typeof Chart === 'undefined') return;

    const byUserDay = new Map();
    for (const u of USERS) byUserDay.set(u, new Map());

    let maxDay = 0;
    for (const e of events || []) {
      const name = norm(e?.name);
      const date = String(e?.date || '');
      if (!inRange(date, '2026-01-01', '2026-12-31')) continue;
      const day0 = daysDiff0(BASE_DATE, date);
      if (day0 == null) continue;
      if (!byUserDay.has(name)) continue;
      const m = byUserDay.get(name);
      m.set(day0, (m.get(day0) || 0) + 1);
      if (day0 > maxDay) maxDay = day0;
    }

    const last = Math.max(0, maxDay);
    const labels = [];
    for (let d = 0; d <= last; d++) labels.push(d);

    const datasets = USERS.map((u) => {
      const m = byUserDay.get(u) || new Map();
      let cum = 0;
      const data = labels.map((d) => {
        if (d === 0) return 0; // 要件：0日は全員0
        cum += (m.get(d) || 0);
        return cum;
      });
      return { label: u, data, fill: false, tension: 0.15, pointRadius: 2 };
    });

    if (chart) chart.destroy();
    chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: true } },
        scales: { y: { beginAtZero: true } },
      },
    });
  };

  // history（最低限：壊れないように）
  let histRows = [];
  let histPage = 1;
  const PAGE_SIZE = 10;

  const isValidHttpUrl = (s) => {
    try {
      const u = new URL(String(s || ''));
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch { return false; }
  };

  const buildHistoryRows2026 = (events, usersFromApi) => {
    const users = mergedUsers(usersFromApi);
    const allow = new Set(users);
    const rows = [];
    for (const e of events || []) {
      const name = norm(e?.name);
      const date = String(e?.date || '');
      const url = String(e?.url || '');
      if (!name || !date) continue;
      if (allow.size && !allow.has(name)) continue;
      if (!inRange(date, '2026-01-01', '2026-12-31')) continue;
      rows.push({ date, name, url });
    }
    rows.sort((a, b) => (b.date.localeCompare(a.date) || a.name.localeCompare(b.name)));
    return rows;
  };

  const renderHistoryPage = () => {
    const body = $('histBody');
    const prev = $('histPrev');
    const next = $('histNext');
    const info = $('histPageInfo');
    if (!body || !prev || !next || !info) return;

    const total = histRows.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    histPage = Math.min(Math.max(1, histPage), totalPages);

    const start = (histPage - 1) * PAGE_SIZE;
    const pageRows = histRows.slice(start, start + PAGE_SIZE);

    body.innerHTML = '';
    if (!pageRows.length) {
      body.innerHTML = `<tr><td colspan="3" class="hist-empty">データなし</td></tr>`;
    } else {
      for (const r of pageRows) {
        const urlCell = r.url
          ? (isValidHttpUrl(r.url)
              ? `<a href="${r.url}" target="_blank" rel="noopener noreferrer">open</a>`
              : `<span>${r.url}</span>`)
          : `<span></span>`;
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${r.date}</td><td>${r.name}</td><td class="col-url">${urlCell}</td>`;
        body.appendChild(tr);
      }
    }

    info.textContent = `${histPage} / ${totalPages}（${total}件）`;
    prev.disabled = histPage <= 1;
    next.disabled = histPage >= totalPages;
  };

  const initHistoryPager = () => {
    const prev = $('histPrev');
    const next = $('histNext');
    if (prev) prev.addEventListener('click', () => { histPage--; renderHistoryPage(); });
    if (next) next.addEventListener('click', () => { histPage++; renderHistoryPage(); });
  };

  const main = async () => {
    ensureStatus();
    setStatus('BOOT');

    initTabs();
    initHistoryPager();

    const payload = await loadData(); // ← ここで api.js を一切使わない
    const events = Array.isArray(payload.events) ? payload.events : [];

    renderTotalAll(events, payload.users, '2025-01-01', null, 'totalLeftValue');                 // Total Since 2025
    renderTotalAll(events, payload.users, '2026-01-01', '2026-12-31', 'total2026Value');         // Total 2026
    renderGraph2026(events, payload.users);                                                      // Graph 2026 (x=0)
    renderFig(events, payload.users, '2025-01-01', '2025-12-31', 'fig2025LeftValue', 'fig2025RightValue'); // Fig 2025

    histRows = buildHistoryRows2026(events, payload.users);
    histPage = 1;
    renderHistoryPage();

    setStatus('OK (rendered)');
  };

  const boot = () => main().catch((e) => setStatus(`ERR: ${e?.message || String(e)}`));

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
