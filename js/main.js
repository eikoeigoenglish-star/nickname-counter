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
  // JSONP fetch (fallback込み)
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
      // キャッシュ回避
      u.searchParams.set('_', String(Date.now()));

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

    // もし api.js 側に fetchPayload 的な関数があるならそれを優先してもよいが、
    // “壊れてても動く”を優先してここでは JSONP を直に叩く
    const payload = await fetchJsonp(apiUrl, { timeoutMs: 12000, callbackParam: 'callback' });

    if (!payload || payload.ok !== true || !Array.isArray(payload.events)) {
      throw new Error('Invalid payload');
    }
    return payload;
  }

  // ---------------------------
  // 集計ユーティリティ
  // ---------------------------
  function parseYmd(ymd) {
    // ymd: "YYYY-MM-DD"
    if (!ymd || typeof ymd !== 'string') return null;
    const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function dayIndexFromBase(baseDate, targetDate) {
    // baseDate/targetDate: Date, 1日目=1
    const ms = targetDate.getTime() - baseDate.getTime();
    const days = Math.floor(ms / 86400000);
    return days + 1;
  }

  function buildCounts(events, users) {
    // users[0] = 左（Cさん想定）、users[1..] = Others
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
  // タブ
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
  // ① 数字表示（count-up）
  // ---------------------------
  function animateCounts({ left, others, leftLabel, othersLabel, durationMs = 900 }) {
    const diffEl = $('#diffValue');
    const aCountEl = $('#aCount');
    const othersCountEl = $('#othersCount');

    if (!diffEl || !aCountEl || !othersCountEl) return;

    const start = performance.now();
    const fromL = 0;
    const fromR = 0;
    const toL = Math.max(0, Number(left) || 0);
    const toR = Math.max(0, Number(others) || 0);

    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

    const render = (l, r) => {
      diffEl.textContent = `${l} - ${r}`;
      aCountEl.textContent = `${leftLabel}: ${l}`;
      othersCountEl.textContent = `${othersLabel}: ${r}`;
    };

    const step = (now) => {
      const t = Math.min(1, (now - start) / durationMs);
      const k = easeOutCubic(t);

      const l = Math.round(fromL + (toL - fromL) * k);
      const r = Math.round(fromR + (toR - fromR) * k);

      render(l, r);

      if (t < 1) requestAnimationFrame(step);
      else render(toL, toR);
    };

    requestAnimationFrame(step);
  }

  // ---------------------------
  // ② 累積グラフ（Chart.js）
  // ---------------------------
  let chartInstance = null;

  function renderCumulativeChart(events, users, baseDateStr) {
    const canvas = $('#cumChart');
    if (!canvas || typeof Chart === 'undefined') return;

    const base = parseYmd(baseDateStr || '2026-01-01') || new Date(2026, 0, 1);

    // day -> user -> count
    const daySet = new Set();
    const perUserPerDay = new Map(); // user => Map(day => count)

    for (const u of users) perUserPerDay.set(u, new Map());

    for (const ev of events) {
      const name = ev && ev.name;
      const d = parseYmd(ev && ev.date);
      if (!name || !d) continue;
      if (!perUserPerDay.has(name)) continue; // users外は無視

      const idx = dayIndexFromBase(base, d);
      // 1日目より前は無視（必要なら 0 も扱えるが、仕様上は 1 起点でOK）
      if (idx < 1) continue;

      daySet.add(idx);
      const m = perUserPerDay.get(name);
      m.set(idx, (m.get(idx) || 0) + 1);
    }

    const labels = Array.from(daySet).sort((a, b) => a - b);
    // データが少なすぎるとグラフが寂しいので、最低1点は持つ
    if (labels.length === 0) labels.push(1);

    const datasets = users.map((u) => {
      const m = perUserPerDay.get(u) || new Map();
      let cum = 0;
      const data = labels.map((day) => {
        cum += (m.get(day) || 0);
        return cum;
      });

      return {
        label: u,
        data,
        tension: 0.25,
        pointRadius: 2,
      };
    });

    // 既存破棄
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
        plugins: {
          legend: { display: true },
        },
        scales: {
          x: {
            title: { display: false },
          },
          y: {
            beginAtZero: true,
            ticks: { precision: 0 },
          },
        },
      },
    });
  }

  // ---------------------------
  // 起動
  // ---------------------------
  async function boot() {
    mark('main.js');
    setupTabs();

    const cfg = window.APP_CONFIG || {};
    const users = Array.isArray(cfg.USERS) && cfg.USERS.length >= 2
      ? cfg.USERS
      : ['Cさん', 'Sさん', 'Hさん', 'Yさん', 'Aさん', 'Dさん'];

    // ①タブの見出し（A/B..F のままでも機能は動くが、表示だけは C/Others に寄せる）
    // ※HTMLの文言は触らず、サブラインのラベルだけ制御する
    const leftLabel = users[0];
    const othersLabel = 'Others';

    setMeta('読み込み中…');

    const payload = await loadPayload();
    setMeta(`取得OK: events=${payload.events.length} / updatedAt=${payload.updatedAt || '-'}`);

    // ①
    const { left, others } = buildCounts(payload.events, users);
    animateCounts({ left, others, leftLabel, othersLabel, durationMs: 900 });

    // ②
    renderCumulativeChart(payload.events, users, cfg.BASE_DATE || '2026-01-01');
  }

  window.addEventListener('DOMContentLoaded', () => {
    mark('DOMContentLoaded');
    boot().catch((err) => {
      console.error(err);
      setMeta(`初期化エラー: ${err && err.message ? err.message : String(err)}`);
      // ①をダッシュ表示に戻す
      const diffEl = $('#diffValue');
      const aCountEl = $('#aCount');
      const othersCountEl = $('#othersCount');
      if (diffEl) diffEl.textContent = '— — —';
      if (aCountEl) aCountEl.textContent = 'A: –';
      if (othersCountEl) othersCountEl.textContent = '(B..F): –';
    });
  });
})();
