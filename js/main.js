(() => {
  'use strict';

  const config = window.APP_CONFIG || {};
  const api = window.DhtApi;

  const state = {
    summary: null,
    activeTab: 'total',
    chart: null,
    chartRendered: false,
    historyLoaded: false,
    historyLoading: false,
    historyPage: 1,
    historyPageCount: 1,
  };

  const elements = {};

  function cacheElements() {
    elements.status = document.getElementById('status');
    elements.tabs = Array.from(document.querySelectorAll('[data-tab]'));
    elements.panels = Array.from(document.querySelectorAll('[data-panel]'));

    elements.yearTotalTab = document.getElementById('yearTotalTab');
    elements.graphTab = document.getElementById('graphTab');
    elements.historyTab = document.getElementById('historyTab');

    elements.totalValue = document.getElementById('totalValue');
    elements.yearTotalValue = document.getElementById('yearTotalValue');
    elements.fig2025CValue = document.getElementById('fig2025CValue');
    elements.fig2025OthersValue = document.getElementById('fig2025OthersValue');

    elements.graphDescription = document.getElementById('graphDescription');
    elements.chartCanvas = document.getElementById('cumulativeChart');

    elements.historyPrev = document.getElementById('historyPrev');
    elements.historyNext = document.getElementById('historyNext');
    elements.historyPageInfo = document.getElementById('historyPageInfo');
    elements.historyBody = document.getElementById('historyBody');
  }

  function setStatus(message, isError = false) {
    elements.status.textContent = message || '';
    elements.status.classList.toggle('is-error', isError);
  }

  function renderNumber(element, value) {
    element.textContent = Number.isFinite(Number(value)) ? String(Math.trunc(Number(value))) : '–';
  }

  function initTabs() {
    elements.tabs.forEach((button) => {
      button.addEventListener('click', () => activateTab(button.dataset.tab));
    });
  }

  function activateTab(tabName) {
    state.activeTab = tabName;

    elements.tabs.forEach((button) => {
      const isActive = button.dataset.tab === tabName;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-selected', String(isActive));
    });

    elements.panels.forEach((panel) => {
      panel.hidden = panel.dataset.panel !== tabName;
    });

    if (!state.summary) return;

    if (tabName === 'graph') renderChartOnce();
    if (tabName === 'history' && !state.historyLoaded) loadHistory(1);
  }

  function updateYearLabels(year) {
    elements.yearTotalTab.textContent = `Total ${year}`;
    elements.graphTab.textContent = `Graph ${year}`;
    elements.historyTab.textContent = `History ${year}`;
  }

  function renderSummary(summary) {
    renderNumber(elements.totalValue, summary.totals && summary.totals.since2025);
    renderNumber(elements.yearTotalValue, summary.totals && summary.totals.activeYear);
    renderNumber(elements.fig2025CValue, summary.fig2025 && summary.fig2025.c);
    renderNumber(elements.fig2025OthersValue, summary.fig2025 && summary.fig2025.others);

    updateYearLabels(summary.activeYear);
    elements.graphDescription.textContent =
      `横軸：${summary.activeYear}-01-01を1日目とした日数　／　縦軸：累積回数`;

    const lastDate = summary.lastEventDate || '記録なし';
    setStatus(`最終記録：${lastDate}`);
  }

  function parseIsoDateParts(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;

    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
    };
  }

  function dayOfYear(value) {
    const parts = parseIsoDateParts(value);
    if (!parts) return null;

    const start = Date.UTC(parts.year, 0, 1);
    const current = Date.UTC(parts.year, parts.month - 1, parts.day);
    return Math.floor((current - start) / 86400000) + 1;
  }

  function fallbackColor(name) {
    let hash = 0;
    for (const char of String(name)) {
      hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
    }
    return `hsl(${Math.abs(hash) % 360} 72% 68%)`;
  }

  function userColor(name) {
    const colors = config.USER_COLORS || {};
    return colors[name] || fallbackColor(name);
  }

  function buildChartData(summary) {
    const users = Array.isArray(summary.users) ? summary.users : [];
    const daily = Array.isArray(summary.daily) ? summary.daily : [];
    const countsByDay = new Map();
    let maxDay = 1;

    daily.forEach((entry) => {
      if (!Array.isArray(entry) || entry.length < 2) return;
      const day = dayOfYear(entry[0]);
      if (!day || day < 1) return;

      countsByDay.set(day, Array.isArray(entry[1]) ? entry[1] : []);
      if (day > maxDay) maxDay = day;
    });

    const labels = Array.from({ length: maxDay }, (_, index) => index + 1);
    const datasets = users.map((name, userIndex) => {
      let cumulative = 0;
      const data = labels.map((day) => {
        const counts = countsByDay.get(day) || [];
        cumulative += Number(counts[userIndex]) || 0;
        return cumulative;
      });
      const color = userColor(name);

      return {
        label: name,
        data,
        borderColor: color,
        backgroundColor: color,
        pointBackgroundColor: color,
        pointBorderColor: color,
        borderWidth: 2,
        pointRadius: 1.5,
        pointHoverRadius: 4,
        tension: 0.2,
        fill: false,
      };
    });

    return { labels, datasets };
  }

  function renderChartOnce() {
    if (state.chartRendered) {
      if (state.chart) state.chart.resize();
      return;
    }

    if (!window.Chart) {
      setStatus('グラフライブラリを読み込めませんでした', true);
      return;
    }

    const chartData = buildChartData(state.summary);
    state.chart = new window.Chart(elements.chartCanvas, {
      type: 'line',
      data: chartData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
          legend: {
            position: 'top',
            labels: { color: 'rgba(255,255,255,.88)' },
          },
          tooltip: { enabled: true },
        },
        scales: {
          x: {
            title: {
              display: true,
              text: `${state.summary.activeYear}-01-01を1日目とした日数`,
              color: 'rgba(255,255,255,.76)',
            },
            ticks: {
              color: 'rgba(255,255,255,.68)',
              precision: 0,
            },
            grid: { color: 'rgba(255,255,255,.08)' },
          },
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: '累積回数',
              color: 'rgba(255,255,255,.76)',
            },
            ticks: {
              color: 'rgba(255,255,255,.68)',
              precision: 0,
            },
            grid: { color: 'rgba(255,255,255,.08)' },
          },
        },
      },
    });

    state.chartRendered = true;
  }

  function initHistoryPager() {
    elements.historyPrev.disabled = true;
    elements.historyNext.disabled = true;

    elements.historyPrev.addEventListener('click', () => {
      if (state.historyLoading || state.historyPage <= 1) return;
      loadHistory(state.historyPage - 1);
    });

    elements.historyNext.addEventListener('click', () => {
      if (state.historyLoading || state.historyPage >= state.historyPageCount) return;
      loadHistory(state.historyPage + 1);
    });
  }

  function setHistoryMessage(message) {
    elements.historyBody.replaceChildren();
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 3;
    cell.className = 'empty-cell';
    cell.textContent = message;
    row.appendChild(cell);
    elements.historyBody.appendChild(row);
  }

  function safeHttpUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
    } catch (_) {
      return '';
    }
  }

  function appendHistoryRow(event) {
    const row = document.createElement('tr');
    const dateCell = document.createElement('td');
    const nameCell = document.createElement('td');
    const urlCell = document.createElement('td');

    dateCell.className = 'date-column';
    nameCell.className = 'name-column';
    dateCell.textContent = event.date || '';
    nameCell.textContent = event.name || '';

    const href = safeHttpUrl(event.url);
    if (href) {
      const link = document.createElement('a');
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'link';
      urlCell.appendChild(link);
    }

    row.append(dateCell, nameCell, urlCell);
    elements.historyBody.appendChild(row);
  }

  function renderHistory(payload) {
    state.historyPage = payload.page;
    state.historyPageCount = payload.pageCount;
    state.historyLoaded = true;

    elements.historyPageInfo.textContent =
      `${payload.page} / ${payload.pageCount}  (${payload.total}件)`;
    elements.historyPrev.disabled = payload.page <= 1;
    elements.historyNext.disabled = payload.page >= payload.pageCount;

    elements.historyBody.replaceChildren();
    const events = Array.isArray(payload.events) ? payload.events : [];

    if (events.length === 0) {
      setHistoryMessage('データなし');
      return;
    }

    events.forEach(appendHistoryRow);
  }

  async function loadHistory(page) {
    if (!state.summary || state.historyLoading) return;

    state.historyLoading = true;
    elements.historyPrev.disabled = true;
    elements.historyNext.disabled = true;
    elements.historyPageInfo.textContent = '読み込み中…';
    setHistoryMessage('読み込み中…');

    try {
      const payload = await api.getHistory({
        year: state.summary.activeYear,
        page,
        limit: Number(config.HISTORY_PAGE_SIZE) || 50,
      });
      renderHistory(payload);
    } catch (error) {
      state.historyLoaded = false;
      elements.historyPageInfo.textContent = '–';
      setHistoryMessage('履歴を読み込めませんでした');
      setStatus(error.message || String(error), true);
    } finally {
      state.historyLoading = false;
    }
  }

  async function boot() {
    cacheElements();
    initTabs();
    initHistoryPager();

    if (!api) {
      setStatus('api.jsを読み込めませんでした', true);
      return;
    }

    try {
      const summary = await api.getSummary();
      state.summary = summary;
      renderSummary(summary);

      if (state.activeTab === 'graph') renderChartOnce();
      if (state.activeTab === 'history') loadHistory(1);
    } catch (error) {
      setStatus(error.message || String(error), true);
      setHistoryMessage('データを読み込めませんでした');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
