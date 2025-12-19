/* main.js */
(() => {
  'use strict';

  // 二重起動ガード
  if (window.__OTAKU_MAIN_STARTED__) return;
  window.__OTAKU_MAIN_STARTED__ = true;

  const $ = (id) => document.getElementById(id);

  const setMeta = (msg) => {
    const el = $('meta');
    if (el) el.textContent = msg;
  };

  // 文字のブレ対策（全角スペースも潰す）
  const norm = (s) => String(s ?? '').replace(/\u3000/g, ' ').trim();

  // タブ切替（HTML側の .tab[data-tab] と .panel[id] を同期）
  const initTabs = () => {
    const tabs = Array.from(document.querySelectorAll('.tab[data-tab]'));
    const panels = Array.from(document.querySelectorAll('.panel[id]'));

    const activate = (tabId) => {
      tabs.forEach((b) => b.classList.toggle('active', b.dataset.tab === tabId));
      panels.forEach((p) => p.classList.toggle('active', p.id === tabId));
    };

    tabs.forEach((b) => b.addEventListener('click', () => activate(b.dataset.tab)));

    // 初期 active（HTMLで指定されている想定だが、保険）
    const activeBtn = tabs.find((b) => b.classList.contains('active'));
    if (activeBtn) activate(activeBtn.dataset.tab);
  };

  // 日付レンジ判定（dateStr は 'yyyy-mm-dd' 前提）
  const inRange = (dateStr, fromInclusive, toInclusive) => {
    if (!dateStr) return false;
    if (fromInclusive && dateStr < fromInclusive) return false;
    if (toInclusive && dateStr > toInclusive) return false;
    return true;
  };

  // 日付パース（yyyy-mm-dd）
  const parseISODate = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  };

  const daysSince = (baseDateStr, dateStr) => {
    const base = parseISODate(baseDateStr);
    const d = parseISODate(dateStr);
    if (!base || !d) return null;
    const ms = d.getTime() - base.getTime();
    return Math.floor(ms / 86400000) + 1; // 1日目始まり
  };

  // 0→目的値へアニメ（要素ID指定）
  const animate2 = (leftTo, rightTo, leftId, rightId, durationMs = 900) => {
    const leftValueEl = $(leftId);
    const rightValueEl = $(rightId);

    const L = Math.max(0, Number(leftTo) || 0);
    const R = Math.max(0, Number(rightTo) || 0);

    const start = performance.now();
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);

    const render = (l, r) => {
      if (leftValueEl) leftValueEl.textContent = String(l);
      if (rightValueEl) rightValueEl.textContent = String(r);
    };

    const step = (now) => {
      const t = Math.min(1, (now - start) / durationMs);
      const k = easeOut(t);
      const l = Math.round(L * k);
      const r = Math.round(R * k);
      render(l, r);
      if (t < 1) requestAnimationFrame(step);
      else render(L, R);
    };

    render(0, 0);
    requestAnimationFrame(step);
  };

  // Fig（Cさん vs Others）をレンジ指定で描画
  const renderFig = (events, usersFromApi, from, to, leftId, rightId) => {
  const cfgUsers = Array.isArray(window.APP_CONFIG?.USERS) ? window.APP_CONFIG.USERS : [];
  const apiUsers = Array.isArray(usersFromApi) ? usersFromApi : [];

  // ★ API優先ではなく「和集合」にする
  const users = Array.from(new Set([...apiUsers, ...cfgUsers]))
    .map(norm)
    .filter(Boolean);

  const primary = 'Cさん';
  const allow = new Set(users.length ? users : [primary]);

  let cCount = 0;
  let othersCount = 0;

  for (const e of events || []) {
    const name = norm(e?.name);
    const date = String(e?.date || '');
    if (!name) continue;
    if (allow.size && !allow.has(name)) continue;
    if (!inRange(date, from, to)) continue;

    if (name === primary) cCount++;
    else othersCount++;
  }

  animate2(cCount, othersCount, leftId, rightId, 900);
};


  // Graph 2026：累積折れ線（2026年だけ）
  let chart = null;
  const renderTabGraph2026 = (events) => {
    const cfg = window.APP_CONFIG || {};
    const BASE_DATE = cfg.BASE_DATE || '2026-01-01';
    const USERS = Array.isArray(cfg.USERS) ? cfg.USERS.map(norm).filter(Boolean) : [];

    const canvas = $('cumChart');
    if (!canvas || typeof Chart === 'undefined') return;

    const dayNums = [];
    const byUserDay = new Map();
    for (const u of USERS) byUserDay.set(u, new Map());

    let maxDay = 0;
    for (const e of events || []) {
      const name = norm(e?.name);
      const date = String(e?.date || '');

      // 2026だけ
      if (!inRange(date, '2026-01-01', '2026-12-31')) continue;

      const day = daysSince(BASE_DATE, date);
      if (!byUserDay.has(name) || day == null) continue;

      const m = byUserDay.get(name);
      m.set(day, (m.get(day) || 0) + 1);
      if (day > maxDay) maxDay = day;
    }

    const last = Math.max(1, maxDay);
    for (let d = 1; d <= last; d++) dayNums.push(d);

    const COLOR_MAP = {
      'Cさん': '#ff6b8a',     // pink
      'Sさん': '#4aa3ff',     // blue
      'Hさん': '#ffa94d',     // orange
      'Yさん': '#ffd43b',     // yellow
      'Aさん': '#63e6be',     // teal
      'Dさん': '#9775fa',     // purple
      'Syさん': '#ced4da', // gray
      '予備さん': '#74c0fc', // light blue（Cさんと被らない）
      'ゲストさん': '#ff8787' // red-pink（Sさんと被らない）
    };

    const datasets = USERS.map((u) => {
      const m = byUserDay.get(u) || new Map();
      let cum = 0;
      const data = dayNums.map((d) => {
        cum += (m.get(d) || 0);
        return cum;
      });

      const color = COLOR_MAP[u] || '#ffffff';

      return {
        label: u,
        data,
        fill: false,
        tension: 0.15,
        pointRadius: 2,
        borderColor: color,
        backgroundColor: color
      };
    });


    if (chart) { chart.destroy(); chart = null; }

    chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels: dayNums, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: true } },
        scales: { y: { beginAtZero: true } },
      },
    });
  };

  // History 2026：日付降順テーブル + 10件ページング
let histRows = [];
let histPage = 1;
const HIST_PAGE_SIZE = 10;

const isValidHttpUrl = (s) => {
  try {
    const u = new URL(String(s || ''));
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

const buildHistoryRows2026 = (events, usersFromApi) => {
  const cfgUsers = Array.isArray(window.APP_CONFIG?.USERS) ? window.APP_CONFIG.USERS : [];
  const users = (Array.isArray(usersFromApi) && usersFromApi.length ? usersFromApi : cfgUsers)
    .map(norm)
    .filter(Boolean);
  const allow = new Set(users);

  const rows = [];
  for (const e of events || []) {
    const name = norm(e?.name);
    const date = String(e?.date || '');
    const url  = String(e?.url || '');

    if (!name || !date) continue;
    if (allow.size && !allow.has(name)) continue;
    if (!inRange(date, '2026-01-01', '2026-12-31')) continue;

    rows.push({ date, name, url });
  }

  // 日付降順（同日なら name 昇順で安定化）
  rows.sort((a, b) => (b.date.localeCompare(a.date) || a.name.localeCompare(b.name)));
  return rows;
};

const renderHistoryPage = () => {
  const body = $('histBody');
  const prevBtn = $('histPrev');
  const nextBtn = $('histNext');
  const info = $('histPageInfo');

  if (!body || !prevBtn || !nextBtn || !info) return;

  const total = histRows.length;
  const totalPages = Math.max(1, Math.ceil(total / HIST_PAGE_SIZE));
  histPage = Math.min(Math.max(1, histPage), totalPages);

  const start = (histPage - 1) * HIST_PAGE_SIZE;
  const pageRows = histRows.slice(start, start + HIST_PAGE_SIZE);

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
      tr.innerHTML = `
        <td>${r.date}</td>
        <td>${r.name}</td>
        <td class="col-url">${urlCell}</td>
      `;
      body.appendChild(tr);
    }
  }

  info.textContent = `${histPage} / ${totalPages}（${total}件）`;
  prevBtn.disabled = histPage <= 1;
  nextBtn.disabled = histPage >= totalPages;
};

const initHistoryPager = () => {
  const prevBtn = $('histPrev');
  const nextBtn = $('histNext');
  if (prevBtn) prevBtn.addEventListener('click', () => { histPage--; renderHistoryPage(); });
  if (nextBtn) nextBtn.addEventListener('click', () => { histPage++; renderHistoryPage(); });
};


  // main.js 内蔵JSONP（api.js が無い場合の保険）
  const fetchJsonpLocal = (url, timeoutMs = 12000) =>
    new Promise((resolve, reject) => {
      const cbName = `__cb_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const sep = url.includes('?') ? '&' : '?';
      const src = `${url}${sep}callback=${encodeURIComponent(cbName)}&_=${Date.now()}`;

      let done = false;
      const cleanup = () => {
        try { delete window[cbName]; } catch {}
        if (script && script.parentNode) script.parentNode.removeChild(script);
      };

      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error('JSONP timeout'));
      }, timeoutMs);

      window[cbName] = (data) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        cleanup();
        resolve(data);
      };

      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onerror = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        cleanup();
        reject(new Error('JSONP load error'));
      };
      document.head.appendChild(script);
    });

  // データ取得（api.js の fetchJsonp があればそれを使う）
  const loadData = async () => {
    const cfg = window.APP_CONFIG || {};
    const API_URL = cfg.GAS_API_EXEC_URL;
    if (!API_URL) throw new Error('GAS_API_EXEC_URL is missing');

    if (typeof window.fetchJsonp === 'function') {
      return await window.fetchJsonp(API_URL);
    }
    return await fetchJsonpLocal(API_URL);
  };

  const main = async () => {
    initTabs();
    initHistoryPager();

    const payload = await loadData();
    if (!payload || payload.ok !== true) throw new Error('payload not ok');

    const events = Array.isArray(payload.events) ? payload.events : [];

    // Total Since 2025（2025-01-01以降）
    renderFig(events, payload.users, '2025-01-01', null, 'totalLeftValue', 'totalRightValue');

    // Fig 2026（2026年だけ）
    renderFig(events, payload.users, '2026-01-01', '2026-12-31', 'fig2026LeftValue', 'fig2026RightValue');

    // Graph 2026（2026年だけ）
    renderTabGraph2026(events);

    // Fig 2025（2025年だけ）
    renderFig(events, payload.users, '2025-01-01', '2025-12-31', 'fig2025LeftValue', 'fig2025RightValue');

    // History 2026
    histRows = buildHistoryRows2026(events, payload.users);
    histPage = 1;
    renderHistoryPage();

  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      main().catch((e) => setMeta(`初期化エラー: ${e?.message || String(e)}`));
    });
  } else {
    main().catch((e) => setMeta(`初期化エラー: ${e?.message || String(e)}`));
  }
})();
