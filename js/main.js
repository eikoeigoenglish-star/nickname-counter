(() => {
  'use strict';

  // ==========
  // Config
  // ==========
  // GAS Web App の URL（あなたの実際の URL のままにしてOK）
  const GAS_ENDPOINT = window.__GAS_ENDPOINT__ || '';

  // 2026 のグラフ基準日
  const BASE_DATE = '2026-01-01';

  // ==========
  // Utilities
  // ==========
  const $ = (id) => document.getElementById(id);
  const fmtInt = (n) => (Number.isFinite(n) ? n.toLocaleString('ja-JP') : '-');

  // --- 2025 の「集計だけ」を受け取る（詳細行は保持しない想定） ---
  const getSummary2025 = (payload) => {
    const s =
      payload?.summary2025 ||
      payload?.sum2025 ||
      payload?.fig2025Summary ||
      payload?.fig2025 ||
      null;
    if (!s || typeof s !== 'object') return null;

    const c = Number.isFinite(+s.c) ? +s.c : (Number.isFinite(+s.left) ? +s.left : null);
    const others = Number.isFinite(+s.others) ? +s.others : (Number.isFinite(+s.right) ? +s.right : null);
    const total = Number.isFinite(+s.total) ? +s.total : (c != null && others != null ? c + others : null);

    if (c == null && others == null && total == null) return null;
    return { c, others, total };
  };

  const countEvents = (events, users, fromDateInclusive, toDateInclusive) => {
    const from = fromDateInclusive ? new Date(fromDateInclusive + 'T00:00:00') : null;
    const to = toDateInclusive ? new Date(toDateInclusive + 'T23:59:59') : null;

    let n = 0;
    for (const e of events || []) {
      if (!e || !users.includes(e.name)) continue;

      const d = e.date ? new Date(String(e.date)) : null;
      if (!(d instanceof Date) || Number.isNaN(d.getTime())) continue;

      if (from && d < from) continue;
      if (to && d > to) continue;
      n++;
    }
    return n;
  };

  const animateNumber = (value, domId, durationMs = 900) => {
    const el = $(domId);
    if (!el) return;

    const from = Number(String(el.textContent || '').replace(/,/g, ''));
    const start = Number.isFinite(from) ? from : 0;

    const to = Number.isFinite(value) ? value : 0;
    if (durationMs <= 0) {
      el.textContent = fmtInt(to);
      return;
    }

    const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / durationMs);
      const cur = Math.round(start + (to - start) * p);
      el.textContent = fmtInt(cur);
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const clearTextIfExists = (domId, text = '') => {
    const el = $(domId);
    if (el) el.textContent = text;
  };

  // dateStr: 'YYYY-MM-DD' / 'YYYY/MM/DD' / Date などを許容
  // 返り値は「1日目始まり」（同日=1）
  const daysSince = (baseDateStr, dateStr) => {
    const base = new Date(baseDateStr + 'T00:00:00');
    const d =
      dateStr instanceof Date
        ? new Date(dateStr.getFullYear(), dateStr.getMonth(), dateStr.getDate())
        : new Date(String(dateStr));

    if (Number.isNaN(base.getTime()) || Number.isNaN(d.getTime())) return null;

    const diff = Math.floor((d.getTime() - base.getTime()) / (24 * 3600 * 1000));
    return diff + 1; // 1日目始まり
  };

  // ==========
  // Fetch (JSONP)
  // ==========
  const jsonpFetch = (url, timeoutMs = 15000) =>
    new Promise((resolve, reject) => {
      const cbName = '__jsonp_cb_' + Math.random().toString(36).slice(2);
      const src = url.includes('?') ? `${url}&callback=${cbName}` : `${url}?callback=${cbName}`;

      let done = false;

      const cleanup = () => {
        try {
          delete window[cbName];
        } catch (_) {
          window[cbName] = undefined;
        }
        const s = document.getElementById(cbName);
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

  // ==========
  // Render
  // ==========
  const renderTabGraph2026 = (payload, events) => {
    const users = payload.users || [];
    const events2026 = (events || []).filter((e) => {
      const d = new Date(String(e.date));
      return (
        users.includes(e.name) &&
        d instanceof Date &&
        !Number.isNaN(d.getTime()) &&
        d >= new Date('2026-01-01T00:00:00') &&
        d <= new Date('2026-12-31T23:59:59')
      );
    });

    // 日数 => 各ユーザーの累積回数
    let maxDay = 1;
    const map = new Map(); // name -> Map(day -> count)

    for (const u of users) map.set(u, new Map());

    for (const e of events2026) {
      const day = daysSince(BASE_DATE, e.date); // 1日目始まり
      if (day == null) continue;
      maxDay = Math.max(maxDay, day);

      const m = map.get(e.name);
      m.set(day, (m.get(day) || 0) + 1);
    }

    const dayNums = [];
    for (let d = 1; d <= maxDay; d++) dayNums.push(d);

    const datasets = users.map((u) => {
      const m = map.get(u) || new Map();
      let cum = 0;
      const data = dayNums.map((d) => {
        cum += m.get(d) || 0;
        return cum;
      });
      return { label: u, data };
    });

    const canvas = $('graph2026Canvas');
    if (!canvas) return;

    // 既存チャート破棄
    if (canvas.__chart) {
      try {
        canvas.__chart.destroy();
      } catch (_) {}
      canvas.__chart = null;
    }

    const ctx = canvas.getContext('2d');
    canvas.__chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: dayNums,
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true },
          tooltip: { enabled: true },
        },
        scales: {
          x: { title: { display: false } },
          y: { beginAtZero: true },
        },
      },
    });

    // 説明文（ここだけ「0日目」→「1日目」へ）
    const xDesc = $('graph2026XDesc');
    const yDesc = $('graph2026YDesc');
    if (xDesc) xDesc.textContent = `横軸：${BASE_DATE} を 1日目とした日数`;
    if (yDesc) yDesc.textContent = '縦軸：累積回数';
  };

  const renderFig = (events, users, fromDateInclusive, toDateInclusive, leftId, rightId) => {
    const from = new Date(fromDateInclusive + 'T00:00:00');
    const to = new Date(toDateInclusive + 'T23:59:59');

    let left = 0;
    let right = 0;

    for (const e of events || []) {
      if (!e || !users.includes(e.name)) continue;

      const d = new Date(String(e.date));
      if (!(d instanceof Date) || Number.isNaN(d.getTime())) continue;

      if (d < from || d > to) continue;

      if (e.name === 'Cさん') left++;
      else right++;
    }

    animateNumber(left, leftId, 900);
    animateNumber(right, rightId, 900);
  };

  // ==========
  // Main
  // ==========
  const main = async () => {
    // UI: ローディング表示（必要なら）
    clearTextIfExists('errToast', '');

    try {
      if (!GAS_ENDPOINT) throw new Error('GAS endpoint is empty');

      // JSONP
      const payload = await jsonpFetch(GAS_ENDPOINT, 90000);

      const events = payload.events || [];

      // Total Since 2025
      // 2025年は「詳細行を持たず、集計だけ」を payload 側から受け取る想定。
      const sum2025 = getSummary2025(payload);

      const total2026 = countEvents(events, payload.users, '2026-01-01', '2026-12-31');
      const total2025 = sum2025?.total ?? countEvents(events, payload.users, '2025-01-01', '2025-12-31');
      animateNumber(total2025 + total2026, 'totalLeftValue', 900);
      clearTextIfExists('totalRightValue', ' ');

      // Total 2026
      animateNumber(total2026, 'total2026Value', 900);

      // Graph 2026
      renderTabGraph2026(payload, events);

      // Fig 2025 (Cさん vs 他)
      if (sum2025 && (sum2025.c != null || sum2025.others != null)) {
        animateNumber(sum2025.c ?? 0, 'fig2025LeftValue', 900);
        animateNumber(sum2025.others ?? 0, 'fig2025RightValue', 900);
      } else {
        renderFig(events, payload.users, '2025-01-01', '2025-12-31', 'fig2025LeftValue', 'fig2025RightValue');
      }

      // History 2026 等、他のタブ描画があるならここで呼ぶ（既存のまま）
      if (typeof window.renderTabHistory2026 === 'function') {
        window.renderTabHistory2026(payload, events);
      }

      // UI: OK 表示（任意）
      const ok = $('okToast');
      if (ok) ok.textContent = 'OK (rendered)';
    } catch (err) {
      // UI: エラー
      const el = $('errToast');
      if (el) el.textContent = `ERR: ${err?.message || err}`;

      // 数字を "-" に戻す（必要なら）
      clearTextIfExists('totalLeftValue', '-');
      clearTextIfExists('total2026Value', '-');
      clearTextIfExists('fig2025LeftValue', '0');
      clearTextIfExists('fig2025RightValue', '0');
    }
  };

  window.addEventListener('DOMContentLoaded', main);
})();
