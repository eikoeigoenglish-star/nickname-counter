/* main.js */
(() => {
  'use strict';

  // 二重起動ガード
  if (window.__OTAKU_MAIN_STARTED__) return;
  window.__OTAKU_MAIN_STARTED__ = true;

  const $ = (id) => document.getElementById(id);

  // meta が無い構成でも気づけるように console へも出す
  const setMeta = (msg) => {
    const el = $('meta');
    if (el) el.textContent = msg;
    console.log('[meta]', msg);
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

  // 2026-01-01 を 1日目… だったが、グラフ要件で 0日目を作るために「差分日数(0始まり)」も用意
  const daysDiff0 = (baseDateStr, dateStr) => {
    const base = parseISODate(baseDateStr);
    const d = parseISODate(dateStr);
    if (!base || !d) return null;
    const ms = d.getTime() - base.getTime();
    return Math.floor(ms / 86400000); // 0日目始まり
  };

  // 0→目的値へアニメ（1値）
  const animate1 = (to, id, durationMs = 900) => {
    const el = $(id);
    if (!el) return;

    const T = Math.max(0, Number(to) || 0);
    const start = performance.now();
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);

    const render = (v) => { el.textContent = String(v); };

    const step = (now) => {
      const t = Math.min(1, (now - start) / durationMs);
      const k = easeOut(t);
      render(Math.round(T * k));
      if (t < 1) requestAnimationFrame(step);
      else render(T);
    };

    render(0);
    requestAnimationFrame(step);
  };

  // 0→目的値へアニメ（2値）
  const animate2 = (leftTo, rightTo, leftId, rightId, durationMs = 900) => {
    const leftEl = $(leftId);
    const rightEl = $(rightId);

    const L = Math.max(0, Number(leftTo) || 0);
    const R = Math.max(0, Number(rightTo) || 0);

    const start = performance.now();
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);

    const render = (l, r) => {
      if (leftEl) leftEl.textContent = String(l);
      if (rightEl) rightEl.textContent = String(r);
    };

    const step = (now) => {
      const t = Math.min(1, (now - start) / durationMs);
      const k = easeOut(t);
      render(Math.round(L * k), Math.round(R * k));
      if (t < 1) requestAnimationFrame(step);
      else render(L, R);
    };

    render(0, 0);
    requestAnimationFrame(step);
  };

  // users の和集合（途中追加ユーザーを落とさない）
  const mergedUsers = (usersFromApi) => {
    const cfgUsers = Array.isArray(window.APP_CONFIG?.USERS) ? window.APP_CONFIG.USERS : [];
    const apiUsers = Array.isArray(usersFromApi) ? usersFromApi : [];
    return Array.from(new Set([...apiUsers, ...cfgUsers])).map(norm).filter(Boolean);
  };

  // Fig（Cさん vs Others）をレンジ指定で描画
  const renderFig = (events, usersFromApi, from, to, leftId, rightId) => {
    const users = mergedUsers(usersFromApi);
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

  // Total（全員合計）をレンジ指定で描画（Total Since 2025 / Total 2026 用）
  const renderTotalAll = (events, usersFromApi, from, to, valueId) => {
    const users = mergedUsers(usersFromApi);
    const allow = new Set(users); // USERS管理を尊重

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

  // Graph 2026：累積折れ線（2026年だけ / x軸は 0 から）
  let chart = null;
  const renderTabGraph2026 = (events, usersFromApi) => {
    const cfg = window.APP_CONFIG || {};
    const BASE_DATE = cfg.BASE_DATE || '2026-01-01';

    const USERS = mergedUsers(usersFromApi);
    const canvas = $('cumChart');
    if (!canvas || typeof Chart === 'undefined') return;

    const byUserDay = new Map();
    for (const u of USERS) byUserDay.set(u, new Map());

    let maxDay = 0; // 0始まりの最大日数
    for (const e of events || []) {
      const name = norm(e?.name);
      const date = String(e?.date || '');

      if (!inRange(date, '2026-01-01', '2026-12-31')) continue;

      const day0 = daysDiff0(BASE_DATE, date);
      if (day0 == null) continue;
      if (!byUserDay.has(name)) continue;

      const m = byUserDay.get(name);
      // day0=0 は「2026-01-01」。そこもカウントに含める（要件：0は全員0にしたい → 後で配列の先頭を 0 に固定する）
      m.set(day0, (m.get(day0) || 0) + 1);
      if (day0 > maxDay) maxDay = day0;
    }

    // 0日目を必ず含める（全員0固定にするため、labelsは 0..maxDay）
    const last = Math.max(0, maxDay);
    const dayNums = [];
    for (let d = 0; d <= last; d++) dayNums.push(d);

    const COLOR_MAP = {
      'Cさん': '#ff6b8a',
      'Sさん': '#4aa3ff',
      'Hさん': '#ffa94d',
      'Yさん': '#ffd43b',
      'Aさん': '#63e6be',
      'Dさん': '#9775fa',
      'Mさん': '#ced4da',
      'ゲストさん': '#ff8787'
    };

    const datasets = USERS.map((u) => {
      const m = byUserDay.get(u) || new Map();

      // day=0 は必ず 0 に固定（要件）
      let cum = 0;
      const data = dayNums.map((d) => {
        if (d === 0) return 0;
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
    const users = mergedUsers(usersFromApi);
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
        const linkText = 'open';
        const urlCell = r.url
          ? (isValidHttpUrl(r.url)
              ? `<a href="${r.url}" target="_blank" rel="noopener noreferrer">${linkText}</a>`
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

  /* ------------------------------
     JSONP loader (安定版)
     - timeout 後に callback を消さず no-op にして ReferenceError を防止
     - リトライ + localStorage fallback
  ------------------------------ */

  const LS_KEY = 'rin_counter_last_payload_v1';

  const saveLastPayload = (payload) => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(payload)); } catch {}
  };
  const loadLastPayload = () => {
    try {
      const s = localStorage.getItem(LS_KEY);
      return s ? JSON.parse(s) : null;
    } catch {
      return null;
    }
  };

  const fetchJsonpLocal = (url, timeoutMs = 30000) =>
    new Promise((resolve, reject) => {
      const cbName = `__jsonp_cb_${Date.now().toString(36)}${Math.random().toString(16).slice(2)}`;
      const sep = url.includes('?') ? '&' : '?';
      const src = `${url}${sep}callback=${encodeURIComponent(cbName)}&_=${Date.now()}`;

      let done = false;
      let script = null;

      const cleanupScript = () => {
        if (script && script.parentNode) script.parentNode.removeChild(script);
        script = null;
      };

      // callback を「消す」のではなく「遅延着弾を握りつぶす no-op」にする
      const setNoopCb = () => {
        try { window[cbName] = () => {}; } catch {}
      };

      const timer = setTimeout(() => {
        if (done) return;
        done = true;

        // ここがポイント：遅延で script が来ても ReferenceError にしない
        setNoopCb();
        cleanupScript();

        reject(new Error('JSONP timeout'));
      }, Math.max(1000, Number(timeoutMs) || 30000));

      window[cbName] = (data) => {
        if (done) return;
        done = true;

        clearTimeout(timer);
        cleanupScript();

        // 成功時は callback を no-op に寄せておく（再実行などの安全策）
        setNoopCb();

        resolve(data);
      };

      script = document.createElement('script');
      script.src = src;
      script.async = true;

      script.onerror = () => {
        if (done) return;
        done = true;

        clearTimeout(timer);
        setNoopCb();
        cleanupScript();

        reject(new Error('JSONP load error'));
      };

      document.head.appendChild(script);
    });

  // データ取得（api.js の fetchJsonp があればそれを使うが、失敗時は local 方式にフォールバック）
  const loadDataOnce = async () => {
    const cfg = window.APP_CONFIG || {};
    const API_URL = cfg.GAS_API_EXEC_URL || cfg.API_URL || cfg.GAS_URL;
    if (!API_URL) throw new Error('GAS_API_EXEC_URL is missing');

    // timeout は config で上書きできるように
    const timeoutMs = Number(cfg.JSONP_TIMEOUT_MS || 30000);

    if (typeof window.fetchJsonp === 'function') {
      // 既存 api.js がある場合
      return await window.fetchJsonp(API_URL);
    }
    return await fetchJsonpLocal(API_URL, timeoutMs);
  };

  // リトライ + localStorage fallback
  const loadData = async () => {
    const cfg = window.APP_CONFIG || {};
    const tries = Math.max(1, Number(cfg.JSONP_RETRY || 3)); // 既定3回
    const backoffBase = Math.max(200, Number(cfg.JSONP_BACKOFF_MS || 600));

    let lastErr = null;
    for (let i = 0; i < tries; i++) {
      try {
        const payload = await loadDataOnce();
        if (payload && payload.ok === true) {
          saveLastPayload(payload);
          return payload;
        }
        throw new Error('payload not ok');
      } catch (e) {
        lastErr = e;
        // 次があるなら少し待つ
        if (i < tries - 1) {
          const wait = backoffBase * Math.pow(2, i); // 600ms, 1200ms, 2400ms...
          await new Promise((r) => setTimeout(r, wait));
        }
      }
    }

    // ここまで失敗したら最後の payload を出す（表示を落とさない）
    const cached = loadLastPayload();
    if (cached && cached.ok === true) {
      setMeta(`API失敗のためキャッシュ表示: ${lastErr?.message || String(lastErr)}`);
      return cached;
    }

    throw lastErr || new Error('loadData failed');
  };

  const main = async () => {
    initTabs();
    initHistoryPager();

    // 取得（リトライ＋キャッシュ）
    const payload = await loadData();

    const events = Array.isArray(payload.events) ? payload.events : [];

    // Total Since 2025：全員合計
    renderTotalAll(events, payload.users, '2025-01-01', null, 'totalLeftValue');

    // Total 2026：2026年だけ（全員合計）
    renderTotalAll(events, payload.users, '2026-01-01', '2026-12-31', 'total2026Value');

    // Graph 2026：x=0 から
    renderTabGraph2026(events, payload.users);

    // Fig 2025：Cさん vs Others
    renderFig(events, payload.users, '2025-01-01', '2025-12-31', 'fig2025LeftValue', 'fig2025RightValue');

    // History 2026
    histRows = buildHistoryRows2026(events, payload.users);
    histPage = 1;
    renderHistoryPage();

    setMeta('OK');
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      main().catch((e) => setMeta(`初期化エラー: ${e?.message || String(e)}`));
    });
  } else {
    main().catch((e) => setMeta(`初期化エラー: ${e?.message || String(e)}`));
  }
})();
