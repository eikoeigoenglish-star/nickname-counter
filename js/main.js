(() => {
  'use strict';

  // =========================
  // 0) 小物ユーティリティ
  // =========================
  const $id = (id) => document.getElementById(id);
  const setText = (id, text) => {
    const el = $id(id);
    if (el) el.textContent = text;
  };
  const setMeta = (msg) => {
    // 画面左上に出してるやつ（無くても落ちない）
    const el = $id('meta');
    if (el) el.textContent = msg;
    // 無い場合は console にも出す
    console.log('[meta]', msg);
  };
  const safe = (fn) => {
    try { return fn(); } catch (e) { console.warn(e); return undefined; }
  };

  const toISODate = (d) => {
    // Date or string => 'YYYY-MM-DD'
    if (!d) return null;
    if (typeof d === 'string') return d.slice(0, 10);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  const parseEventRow = (r) => {
    // GAS payload event shape を幅広く吸収
    // 期待: { name, date, url } だが、配列/別キーでも極力拾う
    if (!r) return null;

    // 1) 既にオブジェクト型
    if (typeof r === 'object' && !Array.isArray(r)) {
      const name = r.name ?? r.speaker ?? r.user ?? r[1];
      const date = r.date ?? r.day ?? r[2];
      const url  = r.url  ?? r.link ?? r[3];
      if (!name || !date) return null;
      return { name: String(name), date: String(date).slice(0, 10), url: url ? String(url) : '' };
    }

    // 2) 配列型 [no, name, date, url] 想定
    if (Array.isArray(r)) {
      const name = r[1];
      const date = r[2];
      const url = r[3];
      if (!name || !date) return null;
      return { name: String(name), date: String(date).slice(0, 10), url: url ? String(url) : '' };
    }

    return null;
  };

  const yearOf = (isoDate) => {
    if (!isoDate) return NaN;
    return Number(String(isoDate).slice(0, 4));
    };

  // =========================
  // 1) タブ（UI）は最優先で生かす
  // =========================
  const initTabs = () => {
    // ボタン: data-tab="tTotal" みたいな想定（無い場合でも落ちない）
    const btns = Array.from(document.querySelectorAll('[data-tab]'));
    const panels = Array.from(document.querySelectorAll('.panel[id]'));

    const show = (tabId) => {
      // パネル表示
      panels.forEach(p => {
        p.style.display = (p.id === tabId) ? 'block' : 'none';
      });
      // ボタン active
      btns.forEach(b => {
        const on = b.getAttribute('data-tab') === tabId;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    };

    btns.forEach(b => {
      b.addEventListener('click', (e) => {
        e.preventDefault();
        const tabId = b.getAttribute('data-tab');
        if (tabId) show(tabId);
      }, { passive: false });
    });

    // 初期表示：存在する最初のタブへ（tTotal が無い/違ってもOK）
    const first = btns[0]?.getAttribute('data-tab');
    if (first) show(first);
  };

  // =========================
  // 2) JSONP（落ちても UI を壊さない）
  // =========================
  const fetchJsonp = (url, timeoutMs = 25000) =>
    new Promise((resolve, reject) => {
      const cbName = `__jsonp_cb_${Math.random().toString(36).slice(2)}`;
      const src = url + (url.includes('?') ? '&' : '?') +
        `callback=${cbName}&_t=${Date.now()}`;

      let done = false;

      const cleanup = () => {
        safe(() => delete window[cbName]);
        const s = $id(cbName);
        if (s) s.remove();
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
      script.id = cbName;
      script.async = true;
      script.src = src;
      script.onerror = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        cleanup();
        reject(new Error('JSONP load error'));
      };

      document.head.appendChild(script);
    });

  const loadPayload = async () => {
    const cfg = window.APP_CONFIG || {};
    const api = cfg.GAS_API_EXEC_URL;
    if (!api) throw new Error('GAS_API_EXEC_URL is missing (APP_CONFIG)');

    // もし既存の fetchJsonp があるなら使う（無ければローカル）
    if (typeof window.fetchJsonp === 'function') {
      return await window.fetchJsonp(api);
    }
    return await fetchJsonp(api, cfg.JSONP_TIMEOUT_MS ?? 25000);
  };

  // =========================
  // 3) データ整形（payload 形が変わっても耐える）
  // =========================
  const normalizePayload = (payload) => {
    // ok が無い/false でも events だけ取れていれば救う
    const users = Array.isArray(payload?.users) ? payload.users.map(String) : [];

    // events の候補を幅広く拾う
    const rawEvents =
      (Array.isArray(payload?.events) && payload.events) ||
      (Array.isArray(payload?.events2026) && payload.events2026) ||
      (Array.isArray(payload?.data) && payload.data) ||
      [];

    const events = rawEvents
      .map(parseEventRow)
      .filter(Boolean);

    // 2025 サマリ（あれば採用、無ければ events から計算）
    // 期待: { c:601, other:604 } / { C:601, others:604 } なども吸収
    const s = payload?.summary2025 ?? payload?.y2025 ?? payload?.fig2025 ?? null;
    let summary2025 = null;

    if (s && typeof s === 'object') {
      const c =
        Number(s.c ?? s.C ?? s.cCount ?? s.c_total ?? 0) || 0;
      const other =
        Number(s.other ?? s.others ?? s.otherCount ?? s.other_total ?? 0) || 0;
      summary2025 = { c, other };
    } else {
      // events に 2025 行がある場合のみ計算
      const y2025 = events.filter(e => yearOf(e.date) === 2025);
      if (y2025.length) {
        const c = y2025.filter(e => e.name === 'Cさん').length;
        const other = y2025.length - c;
        summary2025 = { c, other };
      } else {
        // 2025 を別管理にしていて events からは消えてるケース
        summary2025 = { c: 0, other: 0 };
      }
    }

    return { users, events, summary2025 };
  };

  // =========================
  // 4) 描画（ID が無くても落ちない）
  // =========================
  const renderTotals = ({ events, summary2025 }) => {
    const y2026 = events.filter(e => yearOf(e.date) === 2026);

    // 2026 合計
    setText('total2026Value', y2026.length ? String(y2026.length) : '–');

    // Total Since 2025（C vs Others を維持）
    const c2026 = y2026.filter(e => e.name === 'Cさん').length;
    const o2026 = y2026.length - c2026;

    const left = (summary2025?.c ?? 0) + c2026;
    const right = (summary2025?.other ?? 0) + o2026;

    // 画面側が「0 - 0」を 2つの span で持ってる想定
    setText('totalLeftValue', String(left));
    setText('totalRightValue', String(right));

    // Fig 2025（C vs Others）
    setText('fig2025LeftValue', String(summary2025?.c ?? 0));
    setText('fig2025RightValue', String(summary2025?.other ?? 0));
  };

  const renderGraph2026 = ({ users, events }) => {
    // Chart.js 前提（無ければ何もしない）
    if (typeof window.Chart !== 'function') return;

    const canvas = $id('chart2026');
    if (!canvas) return;

    const y2026 = events.filter(e => yearOf(e.date) === 2026);

    // dayIndex: 2026-01-01 を 1日目（ユーザー要望）
    const start = new Date('2026-01-01T00:00:00');
    const dayIndex = (iso) => {
      const d = new Date(`${iso}T00:00:00`);
      const diff = Math.floor((d - start) / (24 * 3600 * 1000));
      return diff + 1; // ★ここが 1 始まり
    };

    // day => counts per user
    const byDay = new Map(); // day -> Map(name->count)
    let maxDay = 1;

    for (const e of y2026) {
      const di = dayIndex(e.date);
      if (!Number.isFinite(di) || di < 1) continue;
      maxDay = Math.max(maxDay, di);
      if (!byDay.has(di)) byDay.set(di, new Map());
      const m = byDay.get(di);
      m.set(e.name, (m.get(e.name) || 0) + 1);
    }

    // labels 1..maxDay
    const labels = Array.from({ length: maxDay }, (_, i) => i + 1);

    // users が無い場合は events から作る
    const allNames = users.length
      ? users
      : Array.from(new Set(y2026.map(e => e.name)));

    // 累積系列
    const datasets = allNames.map((name) => {
      let cum = 0;
      const data = labels.map((di) => {
        const m = byDay.get(di);
        const inc = m ? (m.get(name) || 0) : 0;
        cum += inc;
        return cum;
      });
      return {
        label: name,
        data,
        tension: 0.2,
      };
    });

    // 既存チャート破棄
    if (window.__chart2026) {
      try { window.__chart2026.destroy(); } catch {}
      window.__chart2026 = null;
    }

    window.__chart2026 = new window.Chart(canvas, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        animation: false,
        plugins: {
          legend: { display: true },
        },
        scales: {
          x: {
            title: {
              display: true,
              text: '2026-01-01 を 1日目とした日数',
            },
          },
          y: {
            title: {
              display: true,
              text: '累積回数',
            },
          },
        },
      },
    });
  };

  const renderHistory2026 = ({ events }) => {
    const box = $id('history2026');
    if (!box) return;

    const y2026 = events
      .filter(e => yearOf(e.date) === 2026)
      .sort((a, b) => (a.date < b.date ? 1 : -1));

    // まずは全件ドン（必要なら paging は後で）
    const html = y2026.slice(0, 200).map(e => {
      const url = e.url ? `<a href="${e.url}" target="_blank" rel="noopener">link</a>` : '';
      return `<div class="hist-row">
        <span class="hist-date">${e.date}</span>
        <span class="hist-name">${e.name}</span>
        <span class="hist-url">${url}</span>
      </div>`;
    }).join('');

    box.innerHTML = html || '<div class="hist-row">no data</div>';
  };

  // =========================
  // 5) メイン（“落ちない” が最優先）
  // =========================
  const main = async () => {
    // タブは先に必ず初期化（ここで落ちない）
    safe(() => initTabs());

    // 初期表示
    setText('total2026Value', '–');
    setText('totalLeftValue', '–');
    setText('totalRightValue', '–');
    setText('fig2025LeftValue', '–');
    setText('fig2025RightValue', '–');

    setMeta('Loading…');

    try {
      const payload = await loadPayload();
      const norm = normalizePayload(payload);

      // ok フラグが無くても events が取れていれば続行
      renderTotals(norm);
      renderGraph2026(norm);
      renderHistory2026(norm);

      setMeta('OK');
    } catch (e) {
      // ここで落ちても UI は生きる（タブ切替可）
      setMeta(`ERR: ${e?.message || String(e)}`);
      console.error(e);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }
})();
