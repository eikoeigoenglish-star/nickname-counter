/* api.js */
(() => {
  'use strict';

  // JSONP: timeout + retry + late-response guard
  // - timeout: デフォルト30秒
  // - retry: デフォルト2回（計3回トライ）
  // - timeout後も callback を少し残して ReferenceError を防ぐ
  const fetchJsonp = (url, opts = {}) => {
    const timeoutMs = Number(opts.timeoutMs ?? 30000);
    const retries = Number(opts.retries ?? 2);

    const attempt = (tryNo) =>
      new Promise((resolve, reject) => {
        const cbName = `__jsonp_cb_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const sep = url.includes('?') ? '&' : '?';
        const src = `${url}${sep}callback=${encodeURIComponent(cbName)}&_=${Date.now()}`;

        let done = false;
        let script = null;

        const cleanup = () => {
          if (script && script.parentNode) script.parentNode.removeChild(script);
          script = null;
        };

        // timeout後に late response が来ても ReferenceError にしないためのガード
        const keepNoopCallbackFor = 60000; // 60秒
        const armNoop = () => {
          try {
            // 「消す」のではなく「noop」にして、遅延レスポンスを無害化
            window[cbName] = () => {};
            setTimeout(() => {
              try { delete window[cbName]; } catch {}
            }, keepNoopCallbackFor);
          } catch {}
        };

        const timer = setTimeout(() => {
          if (done) return;
          done = true;
          cleanup();
          armNoop();
          reject(new Error(`JSONP timeout (${timeoutMs}ms)`));
        }, timeoutMs);

        window[cbName] = (data) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          cleanup();
          try { delete window[cbName]; } catch {}
          resolve(data);
        };

        script = document.createElement('script');
        script.src = src;
        script.async = true;

        script.onerror = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          cleanup();
          armNoop();
          reject(new Error('JSONP load error'));
        };

        document.head.appendChild(script);
      }).catch((e) => {
        if (tryNo >= retries) throw e;
        // ちょい待ってリトライ（指数バックオフっぽく）
        const wait = 300 * (tryNo + 1);
        return new Promise((r) => setTimeout(r, wait)).then(() => attempt(tryNo + 1));
      });

    return attempt(0);
  };

  window.fetchJsonp = fetchJsonp;
})();
