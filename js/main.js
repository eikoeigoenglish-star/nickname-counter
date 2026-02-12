(() => {
  'use strict';

  // ====== 設定 ======
  // GAS WebApp URL（末尾に ?callback= を付けてJSONPする）
  const GAS_URL = window.__GAS_URL__ || ''; // index.html側で window.__GAS_URL__ をセットしている想定
  const BASE_DATE_2026 = '2026-01-01';

  // ====== DOMユーティリティ ======
  const $ = (id) => document.getElementById(id);

  const norm = (s) => (s ?? '').toString().trim();

  const parseISO = (iso) => {
    // "yyyy-mm-dd" 想定
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const d = Number(m[3]);
    const dt = new Date(Date.UTC(y, mo, d));
    return Number.isNaN(dt.getTime()) ? null : dt;
  };

  const inRange = (dateISO, fromISO, toISO) => {
    const dt = parseISO(dateISO);
    const from = parseISO(fromISO);
    const to = parseISO(toISO);
    if (!dt || !from || !to) return false;
    return dt.getTime() >= from.getTime() && dt.getTime() <= to.getTime();
  };

  const daysSince = (baseISO, dateISO) => {
    const base = parseISO(baseISO);
    const dt = parseISO(dateISO);
    if (!base || !dt) return null;
    const ms = dt.getTime() - base.getTime();
    return Math.floor(ms / (24 * 60 * 60 * 1000));
  };

  const todayISO = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  // ====== 表示（数値アニメ） ======
  const animateTo = (value, bindId, durationMs = 900) => {
    const el = document.querySelector(`[data-bind="${bindId}"]`);
    if (!el) return;

    const from = Number(String(el.textContent || '').replace(/[^\d]/g, '')) || 0;
    const to = Number(value) || 0;

    const start = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - start) / durationMs);
      const v = Math.round(from + (to - from) * p);
      el.textContent = String(v);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const animate2 = (left, right, leftBindId, rightBindId, durationMs = 900) => {
    animateTo(left, leftBindId, durationMs);
    animateTo(right, rightBindId, durationMs);
  };

  // ====== JSONP ======
  const loadData = () =>
    new Promise((resolve, reject) => {
      if (!GAS_URL) {
        reject(new Error('GAS_URL is empty.'));
        return;
      }

      const cbName = `__jsonp_cb_${Math.random().toString(36).slice(2)}`;
      const script = document.createElement('script');
      const sep = GAS_URL.includes('?') ? '&' : '?';
      script.src = `${GAS_URL}${sep}callback=${cbName}`;

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('JSONP timeout'));
      }, 90000);

      const cleanup = () => {
        clearTimeout(timer);
        delete window[cbName];
        if (script && script.parentNode) script.parentNode.removeChild(script);
      };

      window[cbName] = (payload) => {
        cleanup();
        resolve(payload);
      };

      script.onerror = () => {
        cleanup();
        reject(new Error('JSONP load error'));
      };

      document.head.appendChild(script);
    });

  // ====== タブ ======
  const initTabs = () => {
    const tabs = Array.from(document.querySelectorAll('[data-tab]'));
    const pages = Array.from(document.querySelectorAll('[data-page]'));

    const activate = (name) => {
      for (const t of tabs) {
        const on = t.getAttribute('data-tab') === name;
        t.classList.toggle('is-active', on);
      }
      for (const p of pages) {
        const on = p.getAttribute('data-page') === name;
        p.classList.toggle('is-active', on);
      }
    };

    for (const t of tabs) {
      t.addEventListener('click', () => activate(t.getAttribute('data-tab')));
    }

    // 初期表示
    activate('totalSince2025');
  };

  // ====== users ======
  const mergedUsers = (usersFromApi) => {
    const fallback = ['Cさん', 'Sさん', 'Hさん', 'Yさん', 'Aさん', 'Dさん', 'Syさん', 'Mさん', 'ゲストさん'];
    const u = Array.isArray(usersFromApi) ? usersFromApi : [];
    const out = [...new Set([...u, ...fallback].map(norm).filter(Boolean))];
    return out;
  };

  // ====== Total（汎用：期間内の件数） ======
  const renderTotalAll = (events, usersFromApi, fromISO, toISO, bindId) => {
    const users = mergedUsers(usersFromApi);
    const allow = new Set(users);

    let total = 0;
    for (const e of events || []) {
      const name = norm(e?.name);
      const date = String(e?.date || '');
      if (!allow.has(name)) continue;
      if (!inRange(date, fromISO, toISO)) continue;
      total += 1;
    }
    animateTo(total, bindId, 900);
    return total;
  };

  // ---- 2025の集計（シート側を軽量化した場合に備えて） ----
  const getSummary2025 = (payload, events, usersFromApi) => {
    // payload.summary2025 = { c: 601, other: 604 } の想定
    const s = payload && (payload.summary2025 || payload.fig2025 || payload.summary_2025);
    if (s && typeof s === 'object') {
      const c = Number(s.c ?? s.C ?? s.left ?? s.cCount ?? 0) || 0;
      const other = Number(s.other ?? s.others ?? s.right ?? s.otherCount ?? 0) || 0;
      return { c, other, source: 'payload' };
    }

    // 後方互換：イベントから算出（2025がeventsに残っている場合）
    const users = mergedUsers(usersFromApi);
    const allow = new Set(users);

    let c = 0,
      other = 0;
    for (const e of events || []) {
      const name = norm(e?.name);
      const date = String(e?.date || '');
      if (!allow.has(name)) continue;
      if (!inRange(date, '2025-01-01', '2025-12-31')) continue;
      if (name === 'Cさん') c += 1;
      else other += 1;
    }
    return { c, other, source: 'events' };
  };

  const renderTotalSince2025 = (payload, events, usersFromApi, bindId) => {
    const { c, other } = getSummary2025(payload, events, usersFromApi);

    // 2026はevents側（軽量化後もここは必要）
    let total2026 = 0;
    for (const e of events || []) {
      const date = String(e?.date || '');
      if (inRange(date, '2026-01-01', '2026-12-31')) total2026 += 1;
    }

    const total = c + other + total2026;
    animateTo(total, bindId, 900);
    return total;
  };

  const renderFig2025 = (payload, events, usersFromApi, leftBindId, rightBindId) => {
    const { c, other } = getSummary2025(payload, events, usersFromApi);
    animate2(c, other, leftBindId, rightBindId, 900);
  };

  // ====== Graph 2026（累積） ======
  let cumChartInstance = null;

  const renderTabGraph2026 = (events, usersFromApi) => {
    const users = mergedUsers(usersFromApi);
    const allow = new Set(users);

    // day(1..N) -> user -> count
    const byUserDay = new Map(); // key: `${user}|${day}`

    let maxDay = 1;

    for (const e of events || []) {
      const name = norm(e?.name);
      const date = String(e?.date || '');
      if (!allow.has(name)) continue;
      if (!inRange(date, '2026-01-01', '2026-12-31')) continue;

      // ★修正：2026-01-01 を day=1 にする
      const day0 = daysSince(BASE_DATE_2026, date);
      if (day0 === null) continue;
      const day = day0 + 1;

      maxDay = Math.max(maxDay, day);

      const key = `${name}|${day}`;
      byUserDay.set(key, (byUserDay.get(key) || 0) + 1);
    }

    const dayNums = Array.from({ length: maxDay }, (_, i) => i + 1);

    // datasets：各ユーザーの累積
    const datasets = users.map((u) => {
      let cum = 0;
      const data = dayNums.map((d) => {
        const key = `${u}|${d}`;
        cum += byUserDay.get(key) || 0;
        return cum;
      });
      return {
        label: u,
        data,
        tension: 0.2,
      };
    });

    const canvas = $('cumChart');
    if (!canvas) return;

    // Chart.js が無い場合の保険
    if (typeof window.Chart === 'undefined') {
      const box = canvas.parentElement;
      if (box) box.innerHTML = '<div style="color:#fff;padding:16px;">ERR: Chart.js not loaded</div>';
      return;
    }

    if (cumChartInstance) {
      cumChartInstance.destroy();
      cumChartInstance = null;
    }

    cumChartInstance = new window.Chart(canvas, {
      type: 'line',
      data: { labels: dayNums, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true },
        },
        scales: {
          x: {
            title: { display: true, text: '2026-01-01 を 1日目とした日数' },
            ticks: { autoSkip: true, maxTicksLimit: 12 },
          },
          y: {
            title: { display: true, text: '累積回数' },
            beginAtZero: true,
          },
        },
      },
    });
  };

  // ====== History 2026 ======
  const buildHistoryRows2026 = (events, usersFromApi) => {
    const users = mergedUsers(usersFromApi);
    const allow = new Set(users);

    const rows = [];
    for (const e of events || []) {
      const name = norm(e?.name);
      const date = String(e?.date || '');
      const url = norm(e?.url);
      if (!allow.has(name)) continue;
      if (!inRange(date, '2026-01-01', '2026-12-31')) continue;
      rows.push({ date, name, url });
    }

    // 新しい順（date降順、同日内は後ろ優先）
    rows.sort((a, b) => {
      if (a.date === b.date) return 0;
      return a.date < b.date ? 1 : -1;
    });

    return rows;
  };

  let histRows = [];
  let histPage = 0;
  const HIST_PAGE_SIZE = 40;

  const renderHistoryPage = () => {
    const body = $('histBody');
    const pageInfo = $('histPageInfo');
    if (!body) return;

    body.innerHTML = '';

    const total = histRows.length;
    const totalPages = Math.max(1, Math.ceil(total / HIST_PAGE_SIZE));
    histPage = Math.max(0, Math.min(histPage, totalPages - 1));

    const from = histPage * HIST_PAGE_SIZE;
    const to = Math.min(total, from + HIST_PAGE_SIZE);

    if (pageInfo) pageInfo.textContent = `${histPage + 1} / ${totalPages}`;

    if (total === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="3" style="opacity:.8;">データなし</td>`;
      body.appendChild(tr);
      return;
    }

    for (let i = from; i < to; i++) {
      const r = histRows[i];
      const tr = document.createElement('tr');
      const url = r.url ? `<a href="${r.url}" target="_blank" rel="noopener noreferrer">link</a>` : '';
      tr.innerHTML = `<td>${r.date}</td><td>${r.name}</td><td>${url}</td>`;
      body.appendChild(tr);
    }
  };

  const initHistoryPager = () => {
    const prev = $('histPrev');
    const next = $('histNext');
    if (prev) {
      prev.addEventListener('click', () => {
        histPage -= 1;
        renderHistoryPage();
      });
    }
    if (next) {
      next.addEventListener('click', () => {
        histPage += 1;
        renderHistoryPage();
      });
    }
  };

  // ====== main ======
  const main = async () => {
    initTabs();
    initHistoryPager();

    try {
      const payload = await loadData();

      const updatedEl = $('metaUpdatedAt');
      if (updatedEl) updatedEl.textContent = payload?.updatedAt ? `Updated: ${payload.updatedAt}` : '';

      const events = Array.isArray(payload?.events) ? payload.events : [];
      const events2026 = (events || []).filter((e) => inRange(String(e?.date || ''), '2026-01-01', '2026-12-31'));

      // タブ1：Total Since 2025（= 2025 summary + 2026件数）
      renderTotalSince2025(payload, events, payload?.users, 'totalLeftValue');

      // タブ2：Total 2026（これはOK）
      renderTotalAll(events, payload?.users, '2026-01-01', '2026-12-31', 'total2026Value');

      // タブ3：Graph 2026（x軸 1始まり）
      renderTabGraph2026(events2026, payload?.users);

      // タブ4：History 2026
      histRows = buildHistoryRows2026(events2026, payload?.users);
      histPage = 0;
      renderHistoryPage();

      // タブ5：Fig 2025（601-604）
      renderFig2025(payload, events, payload?.users, 'figLeftValue', 'figRightValue');
    } catch (e) {
      const errEl = $('metaError');
      if (errEl) errEl.textContent = `ERR: ${e?.message || e}`;
      // 目に見える形で - のままになるのはOK（エラー表示優先）
    }
  };

  document.addEventListener('DOMContentLoaded', main);
})();
