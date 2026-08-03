(() => {
  'use strict';

  const config = window.APP_CONFIG || {};

  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  const createCallbackName = () =>
    `__dht_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const buildUrl = (callbackName) => {
    const url = new URL(config.GAS_API_EXEC_URL);
    url.searchParams.set('action', 'summary');
    url.searchParams.set('callback', callbackName);
    url.searchParams.set('_', String(Date.now()));
    return url.toString();
  };

  const jsonpOnce = (timeoutMs) =>
    new Promise((resolve, reject) => {
      const callbackName = createCallbackName();
      const script = document.createElement('script');
      let settled = false;
      let timerId = null;

      const cleanupScript = () => {
        if (timerId !== null) window.clearTimeout(timerId);
        if (script.parentNode) script.parentNode.removeChild(script);
      };

      const preserveLateCallback = () => {
        window[callbackName] = () => {};
        window.setTimeout(() => {
          try { delete window[callbackName]; } catch (_) {}
        }, 30000);
      };

      const finish = (fn) => {
        if (settled) return;
        settled = true;
        cleanupScript();
        fn();
      };

      window[callbackName] = (payload) => {
        finish(() => {
          try { delete window[callbackName]; } catch (_) {}
          resolve(payload);
        });
      };

      script.async = true;
      script.src = buildUrl(callbackName);
      script.onerror = () => {
        finish(() => {
          preserveLateCallback();
          reject(new Error('APIの読み込みに失敗しました'));
        });
      };

      timerId = window.setTimeout(() => {
        finish(() => {
          preserveLateCallback();
          reject(new Error(`APIが${Math.round(timeoutMs / 1000)}秒以内に応答しませんでした`));
        });
      }, timeoutMs);

      document.head.appendChild(script);
    });

  const getSummary = async () => {
    if (!config.GAS_API_EXEC_URL) {
      throw new Error('GAS_API_EXEC_URLが設定されていません');
    }

    const timeoutMs = Number(config.JSONP_TIMEOUT_MS) || 15000;
    const retries = Math.max(0, Number(config.JSONP_RETRIES) || 0);
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const payload = await jsonpOnce(timeoutMs);
        if (!payload || payload.ok !== true) {
          throw new Error(
            payload && payload.error
              ? payload.error
              : 'APIの応答形式が不正です'
          );
        }
        return payload;
      } catch (error) {
        lastError = error;
        if (attempt < retries) {
          await sleep(400 * (attempt + 1));
        }
      }
    }

    throw lastError || new Error('APIの読み込みに失敗しました');
  };

  window.DhtApi = Object.freeze({ getSummary });
})();
