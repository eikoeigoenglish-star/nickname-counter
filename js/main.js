/* main.js */
(() => {
  'use strict';

  // ---- helpers -------------------------------------------------------------
  const $ = (id) => document.getElementById(id);

  const setMeta = (msg) => {
    const el = $('meta');
    if (el) el.textContent = msg;
  };

  const fmtDate = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  };

  const parseISODate = (s) => {
    // "yyyy-mm-dd" をローカル日付として扱う
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

  // JSONP loader (api.js が壊れても動く保険)
  const fetchJsonp = (url, timeoutMs = 12000) =>
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

  // ---- config --------------------------------------------------------------
  const cfg = window.APP_CONFIG || {};
  const API_URL = cfg.GAS_API_EXEC_URL;
  const BASE_DATE = cfg.BASE_DATE || '2025-11-01';
  const USERS = Array.isArray(cfg.USERS) ? cfg.USERS : [];

  // 1タブ目の「左（Cさん）」は USERS[0] を採用
  const PRIMARY = USERS[0] || 'Cさん';
  const OTHERS = USERS.slice(1);

  // ---- tab ui --------------------------------------------------------------
  const initTabs = () => {
    const tabs = Array.from(document.querySelectorAll('.tab[data-tab]'));
    const panels = Array.from(document.querySelectorAll('.panel[id]'));

    const activate = (tabId) => {
      tabs.forEach((b) => b.classList.toggle('active', b.dataset.tab === tabId));
      panels.forEach((p) => p.classList.toggle('active', p.id === tabId));
    };

    tabs.forEach((b) => {
      b.addEventListener('click', () => activate(b.dataset.tab));
    });
  };

// ---- rendering: tab1 -----------------------------------------------------
const renderTab1 = (events, usersFromApi) => {
  try {
    const diffEl = document.getElementById('diffValue');
    const leftEl = document.getElementById('aCount');
    const rightEl = document.getElementById('othersCount');

    const users = Array.isArray(usersFromApi) ? usersFromApi : [];
    const primary = users[0] || 'Cさん';
    const others = users.slice(1);

    const counts = new Map();
    for (const u of users) counts.set(String(u), 0);

    for (const e of (events || [])) {
      const name = String(e?.name ?? '');
      if (!counts.has(name)) continue;
      counts.set(name, (counts.get(name) || 0) + 1);
    }

    const left = counts.get(String(primary)) || 0;
    let right = 0;
    for (const u of others) right += counts.get(String(u)) || 0;

    // ここは必ず更新
    if (diffEl) diffEl.textContent = `${left}-${right}`;
    if (leftEl) leftEl.textContent = `${primary}: ${left}`;
    if (rightEl) rightEl.textContent = `Others: ${right}`;

    console.log('[tab1 ok]', { primary, left, right, users });
  } catch (err) {
    console.error('[tab1 error]', err);
  }
};

  // ---- rendering: tab2 chart ----------------------------------------------
  let chart = null;

  const renderTab2 = (events) => {
    const canvas = $('cumChart');
    if (!canvas || typeof Chart === 'undefined') return;

    // 日数軸を作る：BASE_DATE から events の最大日まで
    const dayNums = [];
    const byUserDay = new Map(); // user -> Map(dayNum -> count that day)

    for (const u of USERS) byUserDay.set(u, new Map());

    let maxDay = 0;
    for (const e of events || []) {
      const name = String(e.name || '');
      const day = daysSince(BASE_DATE, e.date);
      if (!byUserDay.has(name) || day == null) continue;

      const m = byUserDay.get(name);
      m.set(day, (m.get(day) || 0) + 1);
      if (day > maxDay) maxDay = day;
    }

    // maxDay が 0（データなし）でも最低 1 は描く
    const last = Math.max(1, maxDay);
    for (let d = 1; d <= last; d++) dayNums.push(d);

    // 累積系列に変換
    const datasets = USERS.map((u) => {
      const m = byUserDay.get(u) || new Map();
      let cum = 0;
      const data = dayNums.map((d) => {
        cum += (m.get(d) || 0);
        return cum;
      });
      return {
        label: u,
        data,
        fill: false,
        tension: 0.15,
        pointRadius: 2,
      };
    });

    // 既存チャート破棄
    if (chart) {
      chart.destroy();
      chart = null;
    }

    chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: dayNums,
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true },
        },
        scales: {
          x: {
            title: { display: false },
          },
          y: {
            beginAtZero: true,
          },
        },
      },
    });
  };

  // ---- bootstrap -----------------------------------------------------------
  const loadData = async () => {
    if (!API_URL) throw new Error('GAS_API_EXEC_URL is missing');

    // api.js が提供してる可能性がある関数を優先して使う
    if (window.API && typeof window.API.fetchPayload === 'function') {
      return await window.API.fetchPayload(API_URL);
    }
    if (typeof window.fetchJsonp === 'function') {
      return await window.fetchJsonp(API_URL);
    }
    // 最後の保険
    return await fetchJsonp(API_URL);
  };

  const main = async () => {
    try {
      initTabs();

      const payload = await loadData();
      if (!payload || payload.ok !== true) throw new Error('payload not ok');

      const events = Array.isArray(payload.events) ? payload.events : [];
      const updatedAt = payload.updatedAt ? String(payload.updatedAt) : '';

      // 取得結果を meta に出す（今出てる表示を維持）
      setMeta(`取得OK: events=${events.length}${updatedAt ? ` / updatedAt=${updatedAt}` : ''}`);

      renderTab1(events);
      renderTab2(events);
    } catch (e) {
      setMeta(`初期化エラー: ${e && e.message ? e.message : String(e)}`);
      // 失敗時は 1タブ目をハイフンに戻す（UI崩れ防止）
      const diffEl = $('diffValue');
      const leftEl = $('aCount');
      const rightEl = $('othersCount');
      if (diffEl) diffEl.textContent = '–';
      if (leftEl) leftEl.textContent = `${PRIMARY}: –`;
      if (rightEl) rightEl.textContent = `Others: –`;
    }
  };

  // DOM 構築後に実行
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }
})();
