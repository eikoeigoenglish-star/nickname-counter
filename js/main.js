let chartInstance = null;

function parseISODateToUTC(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function dayIndexSince(baseISO, iso) {
  const base = parseISODateToUTC(baseISO);
  const dt = parseISODateToUTC(iso);
  const diffDays = Math.floor((dt - base) / 86400000);
  return diffDays + 1; // base日を1日目
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
    if (counts[e.name] != null) counts[e.name] += 1;
  }
  return counts;
}

function renderTab1(counts) {
  const a = counts["Aさん"] || 0;
  const others =
    (counts["Bさん"] || 0) +
    (counts["Cさん"] || 0) +
    (counts["Dさん"] || 0) +
    (counts["Eさん"] || 0) +
    (counts["Fさん"] || 0);

  const diff = a - others;

  document.getElementById("diffValue").textContent = diff.toLocaleString("ja-JP");
  document.getElementById("aCount").textContent = `A: ${a.toLocaleString("ja-JP")}`;
  document.getElementById("othersCount").textContent = `(B..F): ${others.toLocaleString("ja-JP")}`;
}

function renderTab2(events, users, baseDateISO) {
  // 日別カウント（dayIndex -> {user: count}）
  const daily = new Map();
  let maxDay = 0;

  for (const e of events) {
    const di = dayIndexSince(baseDateISO, e.date);
    if (di < 1) continue; // baseより前は捨てる（仕様通り）
    maxDay = Math.max(maxDay, di);

    if (!daily.has(di)) daily.set(di, {});
    const obj = daily.get(di);
    obj[e.name] = (obj[e.name] || 0) + 1;
  }

  // チャートが空で落ちるのを防ぐ（データが無い場合は1日分だけ描く）
  if (maxDay === 0) maxDay = 1;

  const labels = [];
  for (let d = 1; d <= maxDay; d++) labels.push(d);

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

  const canvas = document.getElementById("cumChart");
  const ctx = canvas.getContext("2d");

  if (chartInstance) chartInstance.destroy();

  chartInstance = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      interaction: { mode: "nearest", intersect: false },
      plugins: { legend: { position: "bottom" } },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } },
        x: { ticks: { maxTicksLimit: 12 } }
      }
    }
  });
}

async function main() {
  // タブ切り替え
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab));
  });

  const cfg = window.APP_CONFIG;
  const apiUrl = cfg.GAS_API_EXEC_URL;
  const baseDateISO = cfg.BASE_DATE;
  const users = cfg.USERS;

  // ★ここがポイント：JSONPで取得
  const data = await fetchJsonp(apiUrl);

  if (!data || !data.ok) {
    document.getElementById("meta").textContent = "データ取得エラー";
    return;
  }

  const events = Array.isArray(data.events) ? data.events : [];
  const updatedAt = data.updatedAt || null;

  document.getElementById("meta").textContent =
    updatedAt ? `最終更新日（GSS）: ${updatedAt}` : "";

  const counts = buildCounts(events, users);

  // ①は必ず表示（例外で全部止まらないように）
  renderTab1(counts);

  // ②（Chart.js）が落ちても①は生かす
  try {
    renderTab2(events, users, baseDateISO);
  } catch (e) {
    console.error("renderTab2 failed:", e);
  }
}

// main失敗時に「初期化エラー」
main().catch(err => {
  console.error(err);
  const meta = document.getElementById("meta");
  if (meta) meta.textContent = "初期化エラー";
});
