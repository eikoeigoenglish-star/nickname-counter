/**
 * JSONPでURLを叩いてJSONを取得する
 * CORS回避のため fetch は使わない
 *
 * @param {string} url 例: https://script.google.com/macros/s/.../exec
 * @param {number} timeoutMs
 * @returns {Promise<any>}
 */
function fetchJsonp(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const cbName = "__jsonp_cb_" + Math.random().toString(36).slice(2);
    const script = document.createElement("script");

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("JSONP timeout"));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      try { delete window[cbName]; } catch (_) {}
      script.remove();
    }

    window[cbName] = (data) => {
      cleanup();
      resolve(data);
    };

    const sep = url.includes("?") ? "&" : "?";
    script.src = `${url}${sep}callback=${cbName}`;
    script.async = true;

    script.onerror = () => {
      cleanup();
      reject(new Error("JSONP load error"));
    };

    document.head.appendChild(script);
  });
}
