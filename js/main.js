(() => {
  'use strict';

  const api = window.DhtApi;
  let snapshot = null;
  let loadingPromise = null;

  const FIELD_SELECTORS = Object.freeze({
    totalSince2025: ['#totalLeftValue', '[data-dht="total-since-2025"]'],
    totalCurrentYear: ['#total2026Value', '[data-dht="total-current-year"]'],
    year: ['[data-dht="year"]'],
    fig2025C: ['#fig2025LeftValue', '[data-dht="fig-2025-c"]'],
    fig2025Others: ['#fig2025RightValue', '[data-dht="fig-2025-others"]'],
    fig2025Total: ['[data-dht="fig-2025-total"]'],
    generatedAt: ['[data-dht="generated-at"]'],
  });

  const setTextForSelectors = (selectors, value) => {
    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((element) => {
        element.textContent = String(value);
      });
    });
  };

  const setStatus = (message, isError = false) => {
    const element = document.getElementById('meta')
      || document.querySelector('[data-dht="status"]');
    if (!element) return;

    element.textContent = message || '';
    element.classList.toggle('error', isError);
  };

  const toInteger = (value, fieldName) => {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      throw new Error(`${fieldName}が数値ではありません`);
    }
    return Math.trunc(number);
  };

  const validateAndNormalize = (payload) => {
    if (!payload || payload.ok !== true) {
      throw new Error('APIの応答が不正です');
    }
    if (!payload.totals || !payload.fig2025 || !Array.isArray(payload.ranking)) {
      throw new Error('GAS APIのデータ形式がフロント側と一致していません');
    }

    const ranking = payload.ranking.map((entry, index) => {
      if (!entry || !String(entry.name || '').trim()) {
        throw new Error(`ranking[${index}]のnameが不正です`);
      }

      return Object.freeze({
        position: toInteger(entry.position ?? index + 1, `ranking[${index}].position`),
        rank: toInteger(entry.rank ?? index + 1, `ranking[${index}].rank`),
        name: String(entry.name).trim(),
        emoji: String(entry.emoji || '👤'),
        count: toInteger(entry.count, `ranking[${index}].count`),
        sharePct: Number(entry.sharePct) || 0,
        gapFromLeader: toInteger(entry.gapFromLeader ?? 0, `ranking[${index}].gapFromLeader`),
        isPodium: Boolean(entry.isPodium ?? index < 3),
      });
    });

    return Object.freeze({
      schemaVersion: toInteger(payload.schemaVersion ?? 1, 'schemaVersion'),
      generatedAt: String(payload.generatedAt || ''),
      year: toInteger(payload.year, 'year'),
      totals: Object.freeze({
        since2025: toInteger(payload.totals.since2025, 'totals.since2025'),
        currentYear: toInteger(
          payload.totals.currentYear ?? payload.totals.y2026,
          'totals.currentYear'
        ),
      }),
      fig2025: Object.freeze({
        c: toInteger(payload.fig2025.c, 'fig2025.c'),
        others: toInteger(payload.fig2025.others, 'fig2025.others'),
        total: toInteger(
          payload.fig2025.total
            ?? Number(payload.fig2025.c) + Number(payload.fig2025.others),
          'fig2025.total'
        ),
      }),
      ranking: Object.freeze(ranking),
      podium: Object.freeze(ranking.slice(0, 3)),
      others: Object.freeze(ranking.slice(3)),
    });
  };

  const createRankItem = (entry, variant) => {
    const item = document.createElement('article');
    item.className = `dht-rank-item dht-rank-item--${variant}`;
    item.dataset.position = String(entry.position);
    item.dataset.rank = String(entry.rank);
    item.dataset.name = entry.name;
    item.dataset.count = String(entry.count);

    const rank = document.createElement('span');
    rank.className = 'dht-rank-number';
    rank.textContent = `${entry.rank}位`;

    const emoji = document.createElement('span');
    emoji.className = 'dht-rank-emoji';
    emoji.textContent = entry.emoji;
    emoji.setAttribute('aria-hidden', 'true');

    const name = document.createElement('span');
    name.className = 'dht-rank-name';
    name.textContent = entry.name;

    const count = document.createElement('span');
    count.className = 'dht-rank-count';
    count.textContent = `${entry.count}回`;

    const share = document.createElement('span');
    share.className = 'dht-rank-share';
    share.textContent = `${entry.sharePct}%`;

    item.append(rank, emoji, name, count, share);
    return item;
  };

  /**
   * Claude側が独自描画を行わない場合だけ使われる、最低限のDOM描画です。
   * CSS・アニメーションは一切含みません。
   */
  const renderRankingFallback = (data) => {
    const podium = document.getElementById('rankingPodium');
    if (podium) {
      podium.replaceChildren(...data.podium.map((entry) => createRankItem(entry, 'podium')));
    }

    const list = document.getElementById('rankingList');
    if (list) {
      const entries = podium ? data.others : data.ranking;
      list.replaceChildren(...entries.map((entry) => createRankItem(entry, 'list')));
    }
  };

  const renderScalars = (data) => {
    setTextForSelectors(FIELD_SELECTORS.totalSince2025, data.totals.since2025);
    setTextForSelectors(FIELD_SELECTORS.totalCurrentYear, data.totals.currentYear);
    setTextForSelectors(FIELD_SELECTORS.year, data.year);
    setTextForSelectors(FIELD_SELECTORS.fig2025C, data.fig2025.c);
    setTextForSelectors(FIELD_SELECTORS.fig2025Others, data.fig2025.others);
    setTextForSelectors(FIELD_SELECTORS.fig2025Total, data.fig2025.total);
    setTextForSelectors(FIELD_SELECTORS.generatedAt, data.generatedAt);
  };

  const render = (data) => {
    renderScalars(data);
    renderRankingFallback(data);
    setStatus('');
  };

  const dispatch = (name, detail) => {
    document.dispatchEvent(new CustomEvent(name, { detail }));
  };

  const load = async ({ force = false } = {}) => {
    if (snapshot && !force) return snapshot;
    if (loadingPromise && !force) return loadingPromise;

    if (!api || typeof api.getSummary !== 'function') {
      const error = new Error('api.jsを読み込めませんでした');
      setStatus(error.message, true);
      dispatch('dht:error', { error });
      throw error;
    }

    setStatus('読み込み中…');

    loadingPromise = api.getSummary()
      .then(validateAndNormalize)
      .then((data) => {
        snapshot = data;
        render(data);
        dispatch('dht:ready', data);
        return data;
      })
      .catch((error) => {
        console.error('[DhtCounter]', error);
        setStatus(error && error.message ? error.message : String(error), true);
        dispatch('dht:error', { error });
        throw error;
      })
      .finally(() => {
        loadingPromise = null;
      });

    return loadingPromise;
  };

  window.DhtCounter = Object.freeze({
    load,
    render,
    getSnapshot: () => snapshot,
  });

  const boot = () => {
    load().catch(() => {
      // エラー表示とイベント通知はload内で実施済みです。
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
