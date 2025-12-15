window.__mark && window.__mark("main.js");

let chartInstance = null;

function $(id) { return document.getElementById(id); }

function setMeta(msg) {
  const el = $("meta");
  if (el) el.textContent = msg;
}

function activateTab(tabId) {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tabId);
  });
  document.querySelectorAll(".panel").forEach(p => {
    p.classList.toggle("active", p.id === tabId);
  });
}

function buildCounts(events, users) {
  const counts = Object.fromEntries(users.map(u => [u, 0]));
  for (const e of events) {
    if (!e || !e.name) continue;
    if (counts[e.name] != null) counts[e.name] += 1;
  }
  return counts;
}

function parseISODateToUTC(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function dayIndexSince(baseISO, iso) {
  const base = parseISODateToUTC(baseISO);
  const dt = parseISODateToUTC(iso);
  const diffDays = Math.floor((dt - base) / 86400000);
  return diffDays + 1;
}

/**
 * Tab1: 「Cさんの合計 −（S/H/Y/A/D の合計）」を大きく "X − Y" で表示
 * ※HTML側は id="diffValue" をそのまま使い、そこに "X − Y" を入れる方式
 */
function renderTab1(counts) {
  const leftName = "Cさん";
  const rightNames = ["Sさん", "Hさん", "Yさん", "Aさん", "Dさん"];

  const left = counts[leftName] || 0;
  const right = rightNames.reduce((sum, n) => sum + (counts[n] || 0), 0);

  // 大きい表示は "X − Y"
  const diffEl = $("diffValue");
  if (diffEl) diffEl.textContent = `${left.toLocaleString("ja-JP")} − ${right.toLocaleString("ja-JP")}`;

  // 小さい補助表示（既存DOMを流用）
  const aCountEl = $("aCount");
  const othersEl = $("othersCount");
  if (aCountEl) aCountEl.textContent = `${leftName}: ${left.toLocaleString("ja-JP")}`;
  if (othersEl) othersEl.textContent = `Others: ${right.toLocaleString("ja-JP")}`;
}

function renderTab2(events, users, baseDateISO) {
  if (!window.Chart) {
    throw new Error("Chart.js が読み込めていません");
  }

  const daily = new Map();
  let maxDay = 0;

  for (const e of events) {
    if (!e?.date || !e?.name) continue;
    const di = dayIndexSince(baseDateISO, e.date);
    if (di < 1) continue; // BASE_DATEより前は捨てる
    maxDay = Math.max(maxDay, di);

    if (!daily.has(di)) daily.set(di, {});
    const obj = daily.get(di);
    obj[e.name] = (obj[e.name] || 0) + 1;
  }

  if (maxDay === 0) maxDay = 1;

  const labels = Array.from({ length: maxDay }, (_, i) => i + 1);

  const datasets = users.map((u) => {
    let cum = 0;
    const data = labels.map((day) => {
      const obj = daily.get(day);
      const add = obj && obj[u] ? obj[u] : 0;
      cum += add;
      return cum;
    });
    return { label: u, data, tension: 0.2 };
  });

  const canvas = $("cumChart");
  const ctx = canvas.getContext("2d");

  if (chartInstance) chartInstance.destroy();

  chartInstance = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: { legend: { position: "bottom" } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

async function main() {
  // タブ
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab));
  });

  // config
  if (!window.APP_CONFIG) {
    throw new Error("APP_CONFIG が未定義（config.js 読めてない）");
  }
  const cfg = window.APP_CONFIG;

  if (!cfg.GAS_API_EXEC_URL) throw new Error("GAS_API_EXEC_URL が空です（config.js設定）");
  if (!Array.isArray(cfg.USERS)) throw new Error("USERS が配列ではありません（config.js設定）");
  if (!cfg.BASE_DATE) throw new Error("BASE_DATE が空です（config.js設定）");

  setMeta("データ取得中…");

  // JSONPで取得
  const data = await fetchJsonp(cfg.GAS_API_EXEC_URL);

  const events = Array.isArray(data?.events) ? data.events : [];
  const updatedAt = data?.updatedAt ? ` / updatedAt=${data.updatedAt}` : "";
  setMeta(`取得OK: events=${events.length}${updatedAt}`);

  if (!data?.ok) {
    throw new Error("API returned not-ok: " + JSON.stringify(data));
  }

  // Tab1
  const counts = buildCounts(events, cfg.USERS);
  renderTab1(counts);

  // Tab2（失敗してもTab1は出す）
  try {
    renderTab2(events, cfg.USERS, cfg.BASE_DATE);
  } catch (e) {
    console.error(e);
    setMeta(`取得OK（グラフ失敗）: ${e?.message || e}`);
  }
}

main().catch(err => {
  console.error(err);
  setMeta("初期化エラー: " + (err?.stack || err?.message || String(err)));
});
