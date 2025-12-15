// js/main.js
(() => {
  'use strict';

  // ----------------------------
  // Utils
  // ----------------------------
  const $ = (sel, root = document) => root.querySelector(sel);

  function normName(s) {
    return String(s ?? '').trim();
  }

  function parseDateYMD(s) {
    // "2025-11-21" / "2025/11/21" などを許容
    const str = String(s ?? '').trim();
    if (!str) return null;
    const m = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const d = Number(m[3]);
    const dt = new Date(Date.UTC(y, mo, d));
    if (Number.isNaN(dt.getTime())) return null;
    return dt;
  }

  function daysDiffUTC(a, b) {
    // a,b: Date (UTC midnight想定)
    const ms = b.getTime() - a.getTime();
    return Math.floor(ms / 86400000);
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function animateNumber(el, to, ms = 900) {
    if (!el) return;
    const from = 0;
    const start = performance.now();
    const target = Number.isFinite(to) ? to : 0;

    const tick = (now) => {
      const t = Math.min(1, (now - start) / ms);
      const v = Math.round(from + (target - from) * t);
      el.textContent = String(v);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function animatePair(el, left, right, ms = 900) {
    // 例: "54 - 50"
    if (!el) return;
    const L = Number.isFinite(left) ? left : 0;
    const R = Number.isFinite(right) ? right : 0;
    const start = performance.now();

    const tick = (now) => {
      const t = Math.min(1, (now - start) / ms);
      const lv = Math.round(L * t);
      const rv = Math.round(R * t);
      el.textContent = `${lv} - ${rv}`;
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ----------------------------
  // JSONP (CORS回避)
  // ----------------------------
  function fetchJsonp(url, { timeoutMs = 12000, callbackParam = 'callback' } = {}) {
    return new Promise((resolve, reject) => {
      const cbName = '__jsonp_cb_' + Math.random().toString(36).slice(2);
      const sep = url.includes('?') ? '&' : '?';
      const fullUrl = `${url}${sep}${callbackParam}=${encodeURIComponent(cbName)}&_ts=${Date.now()}`;

      let timer = null;
      const script = document.createElement('script');

      window[cbName] = (data) => {
        cleanup();
        resolve(data);
      };

      function cleanup() {
        if (timer) clearTimeout(timer);
        try { delete window[cbName]; } catch (_) { window[cbName] = undefined; }
        if (script && script.parentNode) script.parentNode.removeChild(script);
      }

      timer = setTimeout(() => {
        cleanup();
        reject(new Error('JSONP timeout'));
      }, timeoutMs);

      script.onerror = () => {
        cleanup();
        reject(new Error('JSONP load error'));
      };

      script.src = fullUrl;
      document.head.appendChild(script);
    });
  }

  // ----------------------------
  // Tabs
  // ----------------------------
  function initTabs() {
    const tabs = Array.from(document.querySelectorAll('.tab[data-tab]'));
    const panels = Array.from(document.querySelectorAll('.panel[id]'));

    const activate = (tabId) => {
      tabs.forEach((b) => b.classList.toggle('active', b.dataset.tab === tabId));
      panels.forEach((p) => p.classList.toggle('active', p.id === tabId));
    };

    tabs.forEach((b) => {
      b.addEventListener('click', () => activate(b.dataset.tab));
    });
  }

  // ----------------------------
  // Data shaping
  // ----------------------------
  function shapeEvents(payload) {
    const eventsRaw = Array.isArray(payload?.events) ? payload.events : [];
    const events = eventsRaw
      .map((e) => ({
        name: normName(e?.name),
        date: parseDateYMD(e?.date),
        url: String(e?.url ?? ''),
      }))
      .filter((e) => e.name && e.date); // name/date必須（urlは任意）

    return {
      ok: !!payload?.ok,
      updatedAt: String(payload?.updatedAt ?? ''),
      usersFromApi: Array.isArray(payload?.users) ? payload.users.map(normName).filter(Boolean) : [],
      events,
    };
  }

  function countByName(events) {
    const m = new Map();
    for (const e of events) m.set(e.name, (m.get(e.name) ?? 0) + 1);
    return m;
  }

  // ----------------------------
  // Chart
  // ----------------------------
  let chart = null;

  function renderCumChart({ events, users, baseDateStr }) {
    const canvas = document.getElementById('cumChart');
    if (!canvas || !window.Chart) return;

    const baseDate = parseDateYMD(baseDateStr) ?? parseDateYMD('2026-01-01');
    // baseDate以降だけ採用（それ以前は無視）
    const filtered = events.filter((e) => daysDiffUTC(baseDate, e.date) >= 0);

    // maxDay = 1..N（baseDateを1日目）
    let maxDay = 1;
    for (const e of filtered) {
      const day = daysDiffUTC(baseDate, e.date) + 1;
      if (day > maxDay) maxDay = day;
    }

    const labels = Array.from({ length: maxDay }, (_, i) => String(i + 1));

    // 1日ごとの増分 → 累積へ
    const perUserDaily = new Map();
    users.forEach((u) => perUserDaily.set(u, new Array(maxDay).fill(0)));

    for (const e of filtered) {
      if (!perUserDaily.has(e.name)) continue;
      const dayIdx = daysDiffUTC(baseDate, e.date); // 0-based
      if (dayIdx >= 0 && dayIdx < maxDay) {
        perUserDaily.get(e.name)[dayIdx] += 1;
      }
    }

    const datasets = users.map((u) => {
      const daily = perUserDaily.get(u) ?? new Array(maxDay).fill(0);
      let cum = 0;
      const data = daily.map((v) => (cum += v));
      return {
        label: u,
        data,
        tension: 0.25,
        pointRadius: 2,
      };
    });

    if (chart) chart.destroy();

    chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom' },
          tooltip: { mode: 'index', intersect: false },
        },
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { title: { display: false } },
          y: { beginAtZero: true },
        },
      },
    });
  }

  // ----------------------------
  // Boot
  // ----------------------------
  async function main() {
    initTabs();

    const cfg = window.APP_CONFIG || {};
    const apiUrl = String(cfg.GAS_API_EXEC_URL || '').trim();
    const users = Array.isArray(cfg.USERS) && cfg.USERS.length
      ? cfg.USERS.map(normName).filter(Boolean)
      : [];

    // 要件: タブ1は「Cさん - その他」
    const primary = users[0] || 'Cさん';
    const others = users.length ? users.slice(1) : [];

    // 横軸: 2026-01-01 を 1日目
    const baseDateStr = '2026-01-01';

    if (!apiUrl) {
      setText('meta', '初期化エラー: GAS_API_EXEC_URL が未設定');
      return;
    }

    let shaped;
    try {
      const payload = await fetchJsonp(apiUrl, { callbackParam: 'callback' });
      shaped = shapeEvents(payload);
      setText('meta', `取得OK: events=${shaped.events.length} / updatedAt=${shaped.updatedAt || '-'}`);
    } catch (e) {
      console.error(e);
      setText('meta', `初期化エラー: ${e?.message || e}`);
      return;
    }

    // ---- Tab1: C合計 - その他合計
    const byName = countByName(shaped.events);
    const left = byName.get(primary) ?? 0;
    const right = others.reduce((sum, n) => sum + (byName.get(n) ?? 0), 0);

    const diffEl = document.getElementById('diffValue');
    animatePair(diffEl, left, right, 900);

    // サブ表示（要件に合わせて "Cさん:2 Others:0"）
    setText('aCount', `${primary}: ${left}`);
    setText('othersCount', `Others: ${right}`);

    // ---- Tab2: 累積推移（usersの順で6本）
    // configのusersを優先。なければAPIのusers、それもなければeventsから抽出
    const chartUsers = users.length
      ? users
      : (shaped.usersFromApi.length ? shaped.usersFromApi : Array.from(new Set(shaped.events.map(e => e.name))));

    renderCumChart({ events: shaped.events, users: chartUsers, baseDateStr });
  }

  // DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }
})();
