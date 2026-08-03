(() => {
  'use strict';

  const config = window.APP_CONFIG || {};

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function createCallbackName() {
    return `__dht_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  function buildUrl(baseUrl, params, callbackName) {
    const url = new URL(baseUrl);

    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });

    url.searchParams.set('callback', callbackName);
    url.searchParams.set('_', String(Date.now()));
    return url.toString();
  }

  function jsonpOnce(baseUrl, params, timeoutMs) {
    return new Promise((resolve, reject) => {
      const callbackName = createCallbackName();
      const script = document.createElement('script');
      let settled = false;

      const removeScript = () => {
        if (script.parentNode) script.parentNode.removeChild(script);
      };

      const leaveLateResponseGuard = () => {
        window[callbackName] = () => {};
        window.setTimeout(() => {
          try {
            delete window[callbackName];
          } catch (_) {
            window[callbackName] = undefined;
          }
        }, 30000);
      };

      const finish = (handler) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timerId);
        removeScript();
        handler();
      };

      window[callbackName] = (data) => {
        finish(() => {
          try {
            delete window[callbackName];
          } catch (_) {
            window[callbackName] = undefined;
          }
          resolve(data);
        });
      };

      script.async = true;
      script.src = buildUrl(baseUrl, params, callbackName);
      script.onerror = () => {
        finish(() => {
          leaveLateResponseGuard();
          reject(new Error('APIの読み込みに失敗しました'));
        });
      };

      const timerId = window.setTimeout(() => {
        finish(() => {
          leaveLateResponseGuard();
          reject(new Error(`APIが${Math.round(timeoutMs / 1000)}秒以内に応答しませんでした`));
        });
      }, timeoutMs);

      document.head.appendChild(script);
    });
  }

  async function request(params) {
    const baseUrl = config.GAS_API_EXEC_URL;
    if (!baseUrl) throw new Error('GAS_API_EXEC_URLが設定されていません');

    const timeoutMs = Number(config.JSONP_TIMEOUT_MS) || 20000;
    const retries = Math.max(0, Number(config.JSONP_RETRIES) || 0);
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const payload = await jsonpOnce(baseUrl, params, timeoutMs);
        if (!payload || payload.ok !== true) {
          throw new Error(payload && payload.error ? payload.error : 'APIの応答形式が不正です');
        }
        return payload;
      } catch (error) {
        lastError = error;
        if (attempt < retries) await sleep(400 * (attempt + 1));
      }
    }

    throw lastError || new Error('APIの読み込みに失敗しました');
  }

  window.DhtApi = Object.freeze({
    getSummary() {
      return request({ action: 'summary' });
    },

    getHistory({ year, page, limit }) {
      return request({
        action: 'history',
        year,
        page,
        limit,
      });
    },
  });
})();
