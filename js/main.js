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

function renderTab1(counts) {
  const a = counts["Cさん"] || 0;
  const others =
    (counts["Sさん"] || 0) +
    (counts["Hさん"] || 0) +
    (counts["Yさん"] || 0) +
    (counts["Aさん"] || 0) +
    (counts["Dさん"] || 0);

  const diff = a - others;

  $("diffValue").textContent = diff.toLocaleString("ja-JP");
  $("aCount").textContent = `A: ${a.toLocaleString("ja-JP")}`;
  $("othersCount").textContent = `(B..F): ${others.toLocaleString("ja-JP")}`;
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
  // タブ初期化
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab));
  });

  // config確認
  if (!window.APP_CONFIG) {
    throw new Error("APP_CONFIG が未定義（config.js 読めてない）");
  }
  const cfg = window.APP_CONFIG;

  if (!cfg.GAS_API_EXEC_URL) throw new Error("GAS_API_EXEC_URL が空です（config.js設定）");
  if (!Array.isArray(cfg.USERS)) throw new Error("USERS が配列ではありません（config.js設定）");
  if (!cfg.BASE_DATE) throw new Error("BASE_DATE が空です（config.js設定）");

  setMeta("データ取得中…");

  // ★ JSONPで取得（CORS回避）
  const data = await fetchJsonp(cfg.GAS_API_EXEC_URL);

  // 取得確認をmetaに出す（まずここで確実に進捗が見える）
  const events = Array.isArray(data?.events) ? data.events : [];
  const updatedAt = data?.updatedAt ? ` / updatedAt=${data.updatedAt}` : "";
  setMeta(`取得OK: events=${events.length}${updatedAt}`);

  if (!data?.ok) {
    throw new Error("API returned not-ok: " + JSON.stringify(data));
  }

  // 描画
  const counts = buildCounts(events, cfg.USERS);
  renderTab1(counts);

  // グラフは失敗してもタブ①は表示させる
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
