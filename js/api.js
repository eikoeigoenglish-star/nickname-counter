window.__mark && window.__mark('api.js');
function fetchJsonp(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const cbName = "__jsonp_cb_" + Math.random().toString(36).slice(2);
    const script = document.createElement("script");

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("JSONP timeout: " + script.src));
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
      reject(new Error("JSONP load error: " + script.src));
    };

    document.head.appendChild(script);
  });
}
