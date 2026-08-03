/* =========================================================
   ranking-anim.js — 見た目専用の補助スクリプト
   ---------------------------------------------------------
   ここでやること（すべて「読むだけ／飾るだけ」）
     1. Ranking タブが表示されたら登場アニメを再生する
     2. 紙吹雪を降らせる
     3. シェア率のテキストを読んで、バー幅用の CSS 変数を付ける
     4. 大きい数字のカウントアップ演出

   ここでやらないこと
     - API 呼び出し、データ整形、ランキングの DOM 生成
     - main.js が参照する id / data-* / クラス名の変更
     - タブ切り替えロジックへの介入（属性の変化を「見て」いるだけ）
   ========================================================= */
(() => {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const rankingPanel = document.getElementById('tRanking2026');
  const rankingCard = rankingPanel ? rankingPanel.querySelector('.ranking-card') : null;
  const rankingList = document.getElementById('rankingList');
  const confettiLayer = document.getElementById('confettiLayer');

  const NUMBER_THEME_CLASSES = [
    'number-theme--sunset',
    'number-theme--berry',
    'number-theme--carnival',
    'number-theme--green',
    'number-theme--freezer',
  ];

  const applyRandomNumberThemes = () => {
    const numbers = [
      document.querySelector('[data-dht="total-since-2025"]'),
      document.querySelector('[data-dht="total-current-year"]'),
    ].filter(Boolean);

    numbers.forEach((element) => {
      NUMBER_THEME_CLASSES.forEach((className) => element.classList.remove(className));
      const className = NUMBER_THEME_CLASSES[Math.floor(Math.random() * NUMBER_THEME_CLASSES.length)];
      element.classList.add(className);
    });
  };

  const COUNTUP_SELECTOR = [
    '[data-dht="total-since-2025"]',
    '[data-dht="total-current-year"]',
    '[data-dht="fig-2025-c"]',
    '[data-dht="fig-2025-others"]',
    '[data-dht="fig-2025-total"]',
  ].join(',');

  /* ---------------------------------------------------------
     1. シェア率 → CSS変数（バー幅）
     テキストを読むだけ。値の書き換えはしない。
     --------------------------------------------------------- */
  const applyShareBars = () => {
    document.querySelectorAll('.dht-rank-item').forEach((item) => {
      const shareEl = item.querySelector('.dht-rank-share');
      if (!shareEl) return;

      const pct = parseFloat(String(shareEl.textContent).replace(/[^\d.]/g, ''));
      if (!Number.isFinite(pct)) return;

      item.style.setProperty('--share', String(Math.max(0, Math.min(100, pct))));
    });
  };

  /* ---------------------------------------------------------
     2. 4位以下の登場ディレイ用インデックス
     --------------------------------------------------------- */
  const applyListIndexes = () => {
    if (!rankingList) return;
    [...rankingList.children].forEach((item, index) => {
      item.style.setProperty('--i', String(index));
    });
  };

  /* ---------------------------------------------------------
     3. 紙吹雪
     --------------------------------------------------------- */
  const CONFETTI_COLORS = ['#ff5f8f', '#ffc53d', '#2fd0ab', '#4a9bff', '#9b7bff', '#ff8a5b'];

  const burstConfetti = (count = 46) => {
    if (reduceMotion || !confettiLayer) return;

    confettiLayer.replaceChildren();

    const fragment = document.createDocumentFragment();

    for (let i = 0; i < count; i += 1) {
      const piece = document.createElement('span');
      piece.className = i % 3 === 0 ? 'confetti-piece confetti-piece--round' : 'confetti-piece';

      const duration = 2.4 + Math.random() * 2.2;
      const delay = Math.random() * 1.6;

      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      piece.style.animationDuration = `${duration}s`;
      piece.style.animationDelay = `${delay}s`;
      piece.style.setProperty('--drift', `${(Math.random() - 0.5) * 220}px`);
      piece.style.setProperty('--spin', `${360 + Math.random() * 900}deg`);

      fragment.appendChild(piece);
    }

    confettiLayer.appendChild(fragment);

    window.setTimeout(() => {
      if (confettiLayer.isConnected) confettiLayer.replaceChildren();
    }, 7000);
  };

  /* ---------------------------------------------------------
     4. ランキングの登場アニメ再生
     --------------------------------------------------------- */
  let replayTimer = 0;

  const playRanking = () => {
    if (!rankingCard || !rankingPanel || rankingPanel.hidden) return;

    applyShareBars();
    applyListIndexes();

    if (reduceMotion) {
      rankingCard.classList.add('is-live');
      return;
    }

    rankingCard.classList.remove('is-live');
    void rankingCard.offsetWidth; // reflow でアニメーションを巻き戻す
    rankingCard.classList.add('is-live');

    window.clearTimeout(replayTimer);
    replayTimer = window.setTimeout(() => burstConfetti(), 700);
  };

  /* ---------------------------------------------------------
     5. 数字のカウントアップ
     テキストは必ず元の値ちょうどで終わるようにする。
     --------------------------------------------------------- */
  const running = new WeakMap();

  const countUp = (element) => {
    const target = Number(String(element.textContent).replace(/[^\d-]/g, ''));
    if (!Number.isFinite(target) || target === 0) return;

    const previous = running.get(element);
    if (previous) window.cancelAnimationFrame(previous);

    const duration = 850;
    const start = performance.now();

    const step = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      element.textContent = String(Math.round(target * eased));

      if (progress < 1) {
        running.set(element, window.requestAnimationFrame(step));
      } else {
        element.textContent = String(target); // 最終値を保証
        running.delete(element);
      }
    };

    running.set(element, window.requestAnimationFrame(step));
  };

  const countUpIn = (panel) => {
    if (reduceMotion || !panel || panel.hidden) return;
    panel.querySelectorAll(COUNTUP_SELECTOR).forEach(countUp);
  };

  /* ---------------------------------------------------------
     6. パネルの表示状態を「観測」する
     タブ切り替えのロジックには手を入れず、
     hidden / class の変化を MutationObserver で拾うだけ。
     --------------------------------------------------------- */
  const panels = [...document.querySelectorAll('[role="tabpanel"]')];

  const handlePanelShown = (panel) => {
    if (panel.hidden) return;
    if (panel === rankingPanel) {
      playRanking();
    } else {
      countUpIn(panel);
    }
  };

  const observer = new MutationObserver((records) => {
    records.forEach((record) => {
      const panel = record.target;
      if (panel.hidden) return;
      handlePanelShown(panel);
    });
  });

  panels.forEach((panel) => {
    observer.observe(panel, { attributes: true, attributeFilter: ['hidden', 'class'] });
  });

  /* ---------------------------------------------------------
     7. データ描画後のフック
     main.js は描画完了時に 'dht:ready' を投げるので、それに乗る。
     取りこぼし防止として、既に snapshot がある場合も一度走らせる。
     --------------------------------------------------------- */
  const onDataReady = () => {
    const visible = panels.find((panel) => !panel.hidden);
    if (visible) handlePanelShown(visible);
  };

  applyRandomNumberThemes();

  document.addEventListener('dht:ready', onDataReady);

  if (window.DhtCounter && typeof window.DhtCounter.getSnapshot === 'function') {
    if (window.DhtCounter.getSnapshot()) onDataReady();
  }

  /* Rankingカードをクリックすると、もう一度お祝いする（おまけ） */
  if (rankingCard) {
    rankingCard.addEventListener('click', (event) => {
      if (event.target.closest('a, button')) return;
      burstConfetti(30);
    });
  }
})();
