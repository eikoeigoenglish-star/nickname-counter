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

  // JSONP（CORS回避、キャッシュ回避付き）
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

  // タブ切替
  const initTabs = () => {
    const tabs = Array.from(document.querySelectorAll('.tab[data-tab]'));
    const panels = Array.from(document.querySelectorAll('.panel[id]'));

    const activate = (tabId) => {
      tabs.forEach((b) => b.classList.toggle('active', b.dataset.tab === tabId));
      panels.forEach((p) => p.classList.toggle('active', p.id === tabId));
    };

    tabs.forEach((b) => b.addEventListener('click', () => activate(b.dataset.tab)));
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

  // 0→目的値へアニメ
  const animate2 = (leftTo, rightTo, durationMs = 900) => {
    const leftValueEl = $('leftValue');
    const rightValueEl = $('rightValue');
    const aCountEl = $('aCount');
    const othersEl = $('othersCount');

    const L = Math.max(0, Number(leftTo) || 0);
    const R = Math.max(0, Number(rightTo) || 0);

    const start = performance.now();
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);

    const render = (l, r) => {
      if (leftValueEl) leftValueEl.textContent = String(l);
      if (rightValueEl) rightValueEl.textContent = String(r);
      if (aCountEl) aCountEl.textContent = `Cさん: ${l}`;
      if (othersEl) othersEl.textContent = `Others: ${r}`;
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

  // Tab1：Cさん vs Cさん以外合計（2値のみ）
  const renderTab1 = (events, usersFromApi) => {
    // users は API優先、なければ config の USERS
    const cfgUsers = Array.isArray(window.APP_CONFIG?.USERS) ? window.APP_CONFIG.USERS : [];
    const users = (Array.isArray(usersFromApi) && usersFromApi.length ? usersFromApi : cfgUsers)
      .map(norm)
      .filter(Boolean);

    // 左は「Cさん」固定（要件）
    const primary = 'Cさん';

    const allow = new Set(users.length ? users : [primary]);
    let cCount = 0;
    let othersCount = 0;

    for (const e of events || []) {
      const name = norm(e?.name);
      if (!name) continue;
      if (allow.size && !allow.has(name)) continue; // usersで制限する場合
      if (name === primary) cCount++;
      else othersCount++;
    }

    animate2(cCount, othersCount, 900);
  };

  // Tab2：累積折れ線（config USERS を使う）
  let chart = null;
  const renderTab2 = (events) => {
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
      const day = daysSince(BASE_DATE, e?.date);
      if (!byUserDay.has(name) || day == null) continue;

      const m = byUserDay.get(name);
      m.set(day, (m.get(day) || 0) + 1);
      if (day > maxDay) maxDay = day;
    }

    const last = Math.max(1, maxDay);
    for (let d = 1; d <= last; d++) dayNums.push(d);

    const datasets = USERS.map((u) => {
      const m = byUserDay.get(u) || new Map();
      let cum = 0;
      const data = dayNums.map((d) => {
        cum += (m.get(d) || 0);
        return cum;
      });
      return { label: u, data, fill: false, tension: 0.15, pointRadius: 2 };
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

  // データ取得（api.js があれば優先）
  const loadData = async () => {
    const cfg = window.APP_CONFIG || {};
    const API_URL = cfg.GAS_API_EXEC_URL;
    if (!API_URL) throw new Error('GAS_API_EXEC_URL is missing');

    if (window.API && typeof window.API.fetchPayload === 'function') {
      return await window.API.fetchPayload(API_URL);
    }
    return await fetchJsonp(API_URL);
  };

  const main = async () => {
    initTabs();

    const payload = await loadData();
    if (!payload || payload.ok !== true) throw new Error('payload not ok');

    const events = Array.isArray(payload.events) ? payload.events : [];
    const updatedAt = payload.updatedAt ? String(payload.updatedAt) : '';

    setMeta(`取得OK: events=${events.length}${updatedAt ? ` / updatedAt=${updatedAt}` : ''}`);

    // ①：C vs Others
    renderTab1(events, payload.users);

    // ②：累積推移
    renderTab2(events);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      main().catch((e) => setMeta(`初期化エラー: ${e?.message || String(e)}`));
    });
  } else {
    main().catch((e) => setMeta(`初期化エラー: ${e?.message || String(e)}`));
  }
})();
