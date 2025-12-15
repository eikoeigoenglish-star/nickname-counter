window.__mark && window.__mark('api.js');
window.__mark && window.__mark('api.js');

function buildUrlWithParams(baseUrl, params) {
  const u = new URL(baseUrl);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, String(v)));
  return u.toString();
}

function fetchJsonp(baseUrl, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const cbName = '__jsonp_cb_' + Math.random().toString(36).slice(2);
    const done = (err, data) => {
      cleanup();
      if (err) reject(err);
      else resolve(data);
    };

    const cleanup = () => {
      clearTimeout(timer);
      try { delete window[cbName]; } catch (_) {}
      if (script && script.parentNode) script.parentNode.removeChild(script);
    };

    window[cbName] = (data) => done(null, data);

    // ★ キャッシュ回避：t=現在時刻 を必ず付ける
    const url = buildUrlWithParams(baseUrl, {
      callback: cbName,
      t: Date.now()
    });

    let script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onerror = () => done(new Error('JSONP load error: ' + url));

    const timer = setTimeout(() => {
      done(new Error('JSONP timeout: ' + url));
    }, timeoutMs);

    document.head.appendChild(script);
  });
}

