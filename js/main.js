/* main.js
   - JSONPでGAS(WebApp)から payload を取得して描画
   - 2025年は「Cさん件数 / Cさん以外件数」だけを保持する前提に対応
   - 2026年はイベント明細(events)を使って Graph/History/Total を生成

   payload 想定（後方互換）:
   {
     ok: true,
     updatedAt: '2026-02-11',
     users: ['Cさん','Sさん',...],
     events: [ { name:'Cさん', date:'2026-02-11', url:'...' }, ... ], // 2026のみ
     // 2025集計（どれかが入っていればOK）
     fig2025: { c: 601, others: 604 }
     // or summary2025: { c: 601, others: 604, total:1205 }
     // totals（入っていれば優先）
     totals: { since2025: 1602, y2026: 397 }
   }
*/

(() => {
  'use strict';

  // boot marker (optional)
  try { window.__mark && window.__mark('main.js'); } catch {}

  // ===== 固定カラーマップ（Graph 2026 用）=====
  const USER_COLORS = {
    'Cさん': '#4aa3ff',      // blue
    'Sさん': '#ff6b8a',      // pink
    'Hさん': '#ffa94d',      // orange
    'Yさん': '#ffd43b',      // yellow
    'Aさん': '#63e6be',      // teal
    'Dさん': '#9775fa',      // purple
    'Syさん': '#ced4da',     // gray
    'Mさん': '#74c0fc',      // light blue（Cさんと被らない）
    'ゲストさん': '#ff8787'   // red-pink（Sさんと被らない）
  };

  const getUserColor = (name) => USER_COLORS[name] || '#ffffff';

  // ===== helpers =====
  const $ = (sel) => document.querySelector(sel);

  const setMeta = (msg) => {
    const el = document.getElementById('meta');
    if (el) el.textContent = msg;
  };

  const clearTextIfExists = (id, text = '') => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  const renderNumberTo = (id, value) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = Number.isFinite(value) ? String(value) : '–';
  };

  const toInt = (x) => {
    const n = Number(x);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  };

  // ===== date utils =====
  const parseDate = (s) => {
    // 'YYYY/MM/DD' or 'YYYY-MM-DD' or Date object
    if (!s) return null;
    if (s instanceof Date) return isNaN(+s) ? null : s;
    const str = String(s).trim();
    if (!str) return null;

    const m = str.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return isNaN(+dt) ? null : dt;
  };

  const toISODate = (dt) => {
    if (!dt) return '';
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const inRange = (dt, startISO, endISO) => {
    if (!dt) return false;
    const t = dt.getTime();
    if (startISO) {
      const s = parseDate(startISO);
      if (s && t < s.getTime()) return false;
    }
    if (endISO) {
      const e = parseDate(endISO);
      if (e && t > e.getTime()) return false;
    }
    return true;
  };

  // BASE_DATE (default: 2026-01-01)
  const getBaseDateISO = () => {
    const cfg = window.APP_CONFIG || {};
    const base = cfg.BASE_DATE ? String(cfg.BASE_DATE) : '2026-01-01';
    // sanitize
    const dt = parseDate(base);
    return dt ? toISODate(dt) : '2026-01-01';
  };

  // 2026-01-01(=BASE_DATE) からの経過日数（1始まり）
  const dayIndexFromBase1 = (dt) => {
    const baseISO = getBaseDateISO();
    const baseDt = parseDate(baseISO);
    if (!baseDt) return 1;

    const base = Date.UTC(baseDt.getUTCFullYear(), baseDt.getUTCMonth(), baseDt.getUTCDate());
    const t = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
    const diff = Math.floor((t - base) / 86400000);
    return diff + 1; // ★ 1日目開始
  };

  // ===== payload normalize / absorb =====
  const normalizePayload = (payload) => {
    const p = payload ?? {};
    return {
      ok: p.ok === true,
      updatedAt: p.updatedAt ?? null,
      users: Array.isArray(p.users) ? p.users : [],
      events: Array.isArray(p.events) ? p.events : [],
      fig2025: p.fig2025 ?? null,
      summary2025: p.summary2025 ?? null,
      totals: p.totals ?? null,
    };
  };

  const getFig2025Counts = (p) => {
    // priority: fig2025 -> summary2025
    const f = (p && p.fig2025 && typeof p.fig2025 === 'object') ? p.fig2025
            : (p && p.summary2025 && typeof p.summary2025 === 'object') ? p.summary2025
            : null;
    if (!f) return null;

    const c =
      Number.isFinite(Number(f.c)) ? Number(f.c) :
      Number.isFinite(Number(f.cCount)) ? Number(f.cCount) :
      Number.isFinite(Number(f.left)) ? Number(f.left) :
      null;

    const others =
      Number.isFinite(Number(f.others)) ? Number(f.others) :
      Number.isFinite(Number(f.otherCount)) ? Number(f.otherCount) :
      Number.isFinite(Number(f.right)) ? Number(f.right) :
      null;

    if (c == null || others == null) return null;
    return { c: toInt(c), others: toInt(others) };
  };

  const getTotalsIfAny = (p) => {
    const t = p && p.totals && typeof p.totals === 'object' ? p.totals : null;
    if (!t) return null;
    const since2025 = Number(t.since2025);
    const y2026 = Number(t.y2026);
    return {
      since2025: Number.isFinite(since2025) ? Math.trunc(since2025) : null,
      y2026: Number.isFinite(y2026) ? Math.trunc(y2026) : null,
    };
  };

  // ===== aggregation =====
  const countEvents = (events, users, startISO, endISO) => {
    const userSet = new Set((users || []).map(String));
    let n = 0;
    for (const ev of events) {
      const name = ev && ev.name != null ? String(ev.name) : '';
      if (!name) continue;
      if (userSet.size && !userSet.has(name)) continue;

      const dt = parseDate(ev.date);
      if (!dt) continue;

      if (!inRange(dt, startISO, endISO)) continue;
      n++;
    }
    return n;
  };

  const countEventsYear = (events, users, year) =>
    countEvents(events, users, `${year}-01-01`, `${year}-12-31`);

  const calcTotalSince2025 = (p) => {
    // 1) payload.totals.since2025 があれば最優先
    const totals = getTotalsIfAny(p);
    if (totals && totals.since2025 != null) return totals.since2025;

    // 2) 2025集計( fig2025 or summary2025 ) + 2026明細件数
    const fig = getFig2025Counts(p);
    const n2026 = countEventsYear(p.events, p.users, 2026);

    if (fig) return fig.c + fig.others + n2026;

    // 3) 後方互換（2025明細が残ってる場合）
    return countEvents(p.events, p.users, '2025-01-01', null);
  };

  const calcTotal2026 = (p) => {
    const totals = getTotalsIfAny(p);
    if (totals && totals.y2026 != null) return totals.y2026;
    return countEventsYear(p.events, p.users, 2026);
  };

  const calcFig2025 = (p) => {
    const fig = getFig2025Counts(p);
    if (fig) return fig;

    // 後方互換：2025明細が events にある場合に算出
    const users = p.users || [];
    const userSet = new Set((users || []).map(String));
    let c = 0;
    let others = 0;

    for (const ev of p.events || []) {
      const name = ev && ev.name != null ? String(ev.name) : '';
      if (!name) continue;
      if (userSet.size && !userSet.has(name)) continue;

      const dt = parseDate(ev.date);
      if (!dt) continue;
      if (!inRange(dt, '2025-01-01', '2025-12-31')) continue;

      if (name === 'Cさん') c++;
      else others++;
    }
    return { c, others };
  };

  // ===== Tabs =====
  const initTabs = () => {
    const tabs = document.querySelectorAll('.tab');
    const panels = document.querySelectorAll('.panel');

    const activate = (tabId) => {
      tabs.forEach((b) => b.classList.toggle('active', b.dataset.tab === tabId));
      panels.forEach((p) => p.classList.toggle('active', p.id === tabId));
    };

    tabs.forEach((b) => {
      b.addEventListener('click', () => {
        try { activate(b.dataset.tab); } catch (e) { console.error('[tabs]', e); }
      });
    });
  };

  // ===== History pager =====
  let histRows = [];
  let histPage = 1;
  const HIST_PAGE_SIZE = 50;

  const buildHistoryRows2026 = (events, users) => {
    const userSet = new Set((users || []).map(String));
    const rows = [];

    for (const ev of events) {
      const name = ev && ev.name != null ? String(ev.name) : '';
      if (!name) continue;
      if (userSet.size && !userSet.has(name)) continue;

      const dt = parseDate(ev.date);
      if (!dt) continue;
      if (!inRange(dt, '2026-01-01', '2026-12-31')) continue;

      rows.push({
        date: toISODate(dt),
        name,
        url: ev.url ? String(ev.url) : '',
      });
    }

    rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return rows;
  };

  const renderHistoryPage = () => {
    const body = document.getElementById('histBody');
    const info = document.getElementById('histPageInfo');
    const prev = document.getElementById('histPrev');
    const next = document.getElementById('histNext');
    if (!body || !info || !prev || !next) return;

    const total = histRows.length;
    const totalPages = Math.max(1, Math.ceil(total / HIST_PAGE_SIZE));
    histPage = Math.min(Math.max(1, histPage), totalPages);

    const start = (histPage - 1) * HIST_PAGE_SIZE;
    const end = Math.min(start + HIST_PAGE_SIZE, total);
    const slice = histRows.slice(start, end);

    info.textContent = `${histPage} / ${totalPages}  (${total}件)`;
    prev.disabled = histPage <= 1;
    next.disabled = histPage >= totalPages;

    body.innerHTML = '';
    if (!slice.length) {
      body.innerHTML = `<tr><td colspan="3" class="hist-empty">データなし</td></tr>`;
      return;
    }

    const esc = (s) =>
      String(s)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');

    for (const r of slice) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="col-date">${esc(r.date)}</td>
        <td class="col-name">${esc(r.name)}</td>
        <td class="col-url">${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">link</a>` : ''}</td>
      `;
      body.appendChild(tr);
    }
  };

  const initHistoryPager = () => {
    const prev = document.getElementById('histPrev');
    const next = document.getElementById('histNext');

    if (prev) prev.addEventListener('click', () => {
      try { histPage--; renderHistoryPage(); } catch (e) { console.error('[histPrev]', e); }
    });

    if (next) next.addEventListener('click', () => {
      try { histPage++; renderHistoryPage(); } catch (e) { console.error('[histNext]', e); }
    });
  };

  // ===== Graph 2026 (1日目開始) =====
  let chartInstance = null;

  const renderTabGraph2026 = (events, users) => {
    const canvas = document.getElementById('cumChart');
    if (!canvas || typeof Chart === 'undefined') return;

    const userList = (users || []).map(String);
    const userSet = new Set(userList);

    // 2026のイベントだけ取り出す
    const evs = [];
    for (const ev of events) {
      const name = ev && ev.name != null ? String(ev.name) : '';
      if (!name) continue;
      if (userSet.size && !userSet.has(name)) continue;

      const dt = parseDate(ev.date);
      if (!dt) continue;
      if (!inRange(dt, '2026-01-01', '2026-12-31')) continue;

      const di1 = dayIndexFromBase1(dt); // 1,2,3...
      if (di1 <= 0) continue;

      evs.push({ name, day: di1 });
    }

    let maxDay = 1;
    for (const e of evs) if (e.day > maxDay) maxDay = e.day;

    // labels: 1..maxDay（最低でも1を作る）
    const labels = [];
    for (let d = 1; d <= Math.max(1, maxDay); d++) labels.push(d);

    // user -> day -> count
    const counts = new Map();
    for (const u of userList) counts.set(u, new Map());

    for (const e of evs) {
      const m = counts.get(e.name);
      if (!m) continue;
      m.set(e.day, (m.get(e.day) || 0) + 1);
    }

    const datasets = userList.map((u) => {
      const m = counts.get(u) || new Map();
      let cum = 0;
      const data = labels.map((d) => {
        cum += (m.get(d) || 0);
        return cum;
      });

      const color = getUserColor(u);

      return {
        label: u,
        data,
        tension: 0.2,
        fill: false,

        // ★ここが追加：色の固定
        borderColor: color,
        backgroundColor: color,
        pointBackgroundColor: color,
        pointBorderColor: color,
        borderWidth: 2,
        pointRadius: 2,
        pointHoverRadius: 4,
      };
    });

    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }

    const baseISO = getBaseDateISO();
    chartInstance = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
          legend: { position: 'top' },
          tooltip: { enabled: true },
        },
        scales: {
          x: {
            title: { display: true, text: `${baseISO} を 1日目とした日数` },
            ticks: { precision: 0 },
          },
          y: {
            title: { display: true, text: '累積回数' },
            beginAtZero: true,
            ticks: { precision: 0 },
          },
        },
      },
    });
  };

  // ===== JSONP fallback (api.js が無い/壊れてる時用) =====
  const fetchJsonpLocal = (url, timeoutMs = 90000) => {
    return new Promise((resolve, reject) => {
      const cbName = `__jsonp_cb_${Math.random().toString(36).slice(2)}`;
      const sep = url.includes('?') ? '&' : '?';
      const full = `${url}${sep}callback=${encodeURIComponent(cbName)}&_=${Date.now()}`;

      let done = false;

      const cleanup = () => {
        const s = document.getElementById(cbName);
        if (s && s.parentNode) s.parentNode.removeChild(s);
        try { delete window[cbName]; } catch {}
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
      script.src = full;
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
  };

  // ===== load / main =====
  const loadData = async () => {
    const cfg = window.APP_CONFIG || {};
    const API_URL = cfg.GAS_API_EXEC_URL;
    if (!API_URL) throw new Error('GAS_API_EXEC_URL is missing');

    // api.js の fetchJsonp を優先
    if (typeof window.fetchJsonp === 'function') {
      return await window.fetchJsonp(API_URL);
    }
    return await fetchJsonpLocal(API_URL);
  };

  const main = async () => {
    initTabs();
    initHistoryPager();

    const raw = await loadData();
    const payload = normalizePayload(raw);
    if (!payload.ok) throw new Error('payload not ok');

    // Total Since 2025
    const totalSince = calcTotalSince2025(payload);
    renderNumberTo('totalLeftValue', totalSince);
    clearTextIfExists('totalRightValue', ' ');

    // Total 2026
    const total2026 = calcTotal2026(payload);
    renderNumberTo('total2026Value', total2026);

    // Fig 2025
    const fig = calcFig2025(payload);
    renderNumberTo('fig2025LeftValue', fig.c);
    renderNumberTo('fig2025RightValue', fig.others);

    // Graph 2026 (1日目開始)
    renderTabGraph2026(payload.events, payload.users);

    // History 2026
    histRows = buildHistoryRows2026(payload.events, payload.users);
    histPage = 1;
    renderHistoryPage();

    // 旧IDが残ってても事故らないように（保険）
    clearTextIfExists('fig2026LeftValue', ' ');
    clearTextIfExists('fig2026RightValue', ' ');

    setMeta(payload.updatedAt ? `updatedAt: ${payload.updatedAt}` : '');
  };

  const boot = () => main().catch((e) => {
    console.error('[main] error:', e);
    setMeta(`ERR: ${e?.message || String(e)}`);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
