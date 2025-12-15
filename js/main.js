(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  const mark = (s) => {
    try { window.__mark && window.__mark(s); } catch (_) {}
  };

  const setMeta = (text) => {
    const el = $('#meta');
    if (el) el.textContent = text;
  };

  // ---------------------------
  // JSONP fetch
  // ---------------------------
  function fetchJsonp(url, { timeoutMs = 12000, callbackParam = 'callback' } = {}) {
    return new Promise((resolve, reject) => {
      const cbName = `__jsonp_cb_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const script = document.createElement('script');

      const cleanup = () => {
        try { delete window[cbName]; } catch (_) { window[cbName] = undefined; }
        if (script && script.parentNode) script.parentNode.removeChild(script);
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('JSONP load timeout'));
      }, timeoutMs);

      window[cbName] = (data) => {
        clearTimeout(timer);
        cleanup();
        resolve(data);
      };

      const u = new URL(url);
      u.searchParams.set(callbackParam, cbName);
      u.searchParams.set('_', String(Date.now())); // cache bust

      script.src = u.toString();
      script.async = true;
      script.onerror = () => {
        clearTimeout(timer);
        cleanup();
        reject(new Error('JSONP load error'));
      };

      document.head.appendChild(script);
    });
  }

  async function loadPayload() {
    const cfg = window.APP_CONFIG || {};
    const apiUrl = cfg.GAS_API_EXEC_URL;

    if (!apiUrl || typeof apiUrl !== 'string' || !apiUrl.startsWith('http')) {
      throw new Error('GAS_API_EXEC_URL is missing/invalid');
    }

    const payload = await fetchJsonp(apiUrl, { timeoutMs: 12000, callbackParam: 'callback' });

    if (!payload || payload.ok !== true || !Array.isArray(payload.events)) {
      throw new Error('Invalid payload');
    }
    return payload;
  }

  // ---------------------------
  // Utils
  // ---------------------------
  function parseYmd(ymd) {
    if (!ymd || typeof ymd !== 'string') return null;
    const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function dayIndexFromBase(baseDate, targetDate) {
    const ms = targetDate.getTime() - baseDate.getTime();
    const days = Math.floor(ms / 86400000);
    return days + 1; // 1日目 = 1
  }

  function buildCounts(events, users) {
    const leftName = users[0];
    const otherSet = new Set(users.slice(1));
    let left = 0;
    let others = 0;

    for (const ev of events) {
      const name = ev && ev.name;
      if (!name) continue;
      if (name === leftName) left++;
      else if (otherSet.has(name)) others++;
    }
    return { leftName, left, others };
  }

  // ---------------------------
  // Tabs
  // ---------------------------
  function setupTabs() {
    const tabs = Array.from(document.querySelectorAll('.tab[data-tab]'));
    const panels = Array.from(document.querySelectorAll('.panel[id]'));

    tabs.forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-tab');
        tabs.forEach((b) => b.classList.toggle('active', b === btn));
        panels.forEach((p) => p.classList.toggle('active', p.id === id));
      });
    });
  }

  // ---------------------------
  // ① Numbers (robust DOM write)
  // ---------------------------
  function animateCounts({ left, others, leftLabel, othersLabel, durationMs = 900 }) {
    // まず「書き込み先」を柔軟に探す
    const diffEl = $('#diffValue');          // あればここに
    const bigNumber = $('.big-number');      // 無ければ big-number 自体に
    const aCountEl = $('#aCount');
    const othersCountEl = $('#othersCount');

    const toL = Math.max(0, Number(left) || 0);
    const toR = Math.max(0, Number(others) || 0);

    const render = (l, r) => {
      const text = `${l} - ${r}`;
      if (diffEl) diffEl.textContent = text;
      else if (bigNumber) bigNumber.textContent = text;

      if (aCountEl) aCountEl.textContent = `${leftLabel}: ${l}`;
      if (othersCountEl) othersCountEl.textContent = `${othersLabel}: ${r}`;
    };

    // 最低でも一回は描画（DOMが多少違っても出す）
    render(0, 0);

    const start = performance.now();
    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

    const step = (now) => {
      const t = Math.min(1, (now - start) / durationMs);
      const k = easeOutCubic(t);
      const l = Math.round(toL * k);
      const r = Math.round(toR * k);
      render(l, r);
      if (t < 1) requestAnimationFrame(step);
      else render(toL, toR);
    };

    requestAnimationFrame(step);
  }

  // ---------------------------
  // ② Chart
  // ---------------------------
  let chartInstance = null;

  function renderCumulativeChart(events, users, baseDateStr) {
    const canvas = $('#cumChart');
    if (!canvas || typeof Chart === 'undefined') return;

    const base = parseYmd(baseDateStr || '2026-01-01') || new Date(2026, 0, 1);

    const daySet = new Set();
    const perUserPerDay = new Map();
    for (const u of users) perUserPerDay.set(u, new Map());

    for (const ev of events) {
      const name = ev && ev.name;
      const d = parseYmd(ev && ev.date);
      if (!name || !d) continue;
      if (!perUserPerDay.has(name)) continue;

      const idx = dayIndexFromBase(base, d);
      if (idx < 1) continue;

      daySet.add(idx);
      const m = perUserPerDay.get(name);
      m.set(idx, (m.get(idx) || 0) + 1);
    }

    const labels = Array.from(daySet).sort((a, b) => a - b);
    if (labels.length === 0) labels.push(1);

    const datasets = users.map((u) => {
      const m = perUserPerDay.get(u) || new Map();
      let cum = 0;
      const data = labels.map((day) => {
        cum += (m.get(day) || 0);
        return cum;
      });
      return { label: u, data, tension: 0.25, pointRadius: 2 };
    });

    if (chartInstance) {
      try { chartInstance.destroy(); } catch (_) {}
      chartInstance = null;
    }

    chartInstance = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: true } },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    });
  }

  // ---------------------------
  // Boot
  // ---------------------------
  async function boot() {
    mark('main.js');
    setupTabs();

    const cfg = window.APP_CONFIG || {};
    const users = Array.isArray(cfg.USERS) && cfg.USERS.length >= 2
      ? cfg.USERS
      : ['Cさん', 'Sさん', 'Hさん', 'Yさん', 'Aさん', 'Dさん'];

    setMeta('読み込み中…');

    const payload = await loadPayload();
    setMeta(`取得OK: events=${payload.events.length} / updatedAt=${payload.updatedAt || '-'}`);

    const { left, others } = buildCounts(payload.events, users);

    // ①：左=users[0]（Cさん） 右=users[1..]（S/H/Y/A/D）
    animateCounts({
      left,
      others,
      leftLabel: users[0],
      othersLabel: 'Others',
      durationMs: 900,
    });

    // ②
    renderCumulativeChart(payload.events, users, cfg.BASE_DATE || '2026-01-01');
  }

  window.addEventListener('DOMContentLoaded', () => {
    mark('DOMContentLoaded');
    boot().catch((err) => {
      console.error(err);
      setMeta(`初期化エラー: ${err && err.message ? err.message : String(err)}`);
      // 画面も保険で落とす
      const diffEl = $('#diffValue');
      const bigNumber = $('.big-number');
      if (diffEl) diffEl.textContent = '— — —';
      else if (bigNumber) bigNumber.textContent = '— — —';
    });
  });
})();
