(() => {
  const { origin, parent, key } = document.currentScript.dataset;
  if (location.origin !== origin || window.parent === window) return;

  function sessionIdentity(value) {
    try {
      const session = JSON.parse(value);
      if (typeof session?.user?.id === "string" && session.access_token && session.refresh_token) return session.user.id;
    } catch { /* The existing browser record may be invalid. */ }
    return null;
  }

  function serve({ source, origin, data, ports }) {
    if (source !== window.parent || origin !== parent || data?.type !== "gary-home-session-v1" || data.storageKey !== key || ports.length !== 1) return;
    window.removeEventListener("message", serve);
    const port = ports[0];
    let storage;
    try {
      storage = window.localStorage;
      storage.getItem(key);
    } catch {
      port.postMessage({ type: "unavailable" });
      return;
    }

    port.onmessage = ({ data }) => {
      if (!Number.isSafeInteger(data?.id)) return;
      const { id, operation, value } = data;
      const respond = value => port.postMessage({ type: "result", id, ok: true, value });
      try {
        if (operation === "read") return respond(storage.getItem(key));
        if (operation === "write" && typeof value === "string") {
          storage.setItem(key, value);
          return respond();
        }
        if (operation === "remove") {
          storage.removeItem(key);
          return respond();
        }
        if (operation === "adopt" && typeof value === "string") {
          const identity = sessionIdentity(value);
          if (!identity) return respond(false);
          const existing = storage.getItem(key);
          if (existing !== null) return respond(sessionIdentity(existing) === identity);
          storage.setItem(key, value);
          return respond(true);
        }
      } catch { /* Report failure without including the session or error body. */ }
      port.postMessage({ type: "result", id, ok: false });
    };
    window.addEventListener("storage", event => {
      if (event.storageArea === storage && (event.key === key || event.key === null)) port.postMessage({ type: "changed" });
    });
    port.postMessage({ type: "ready" });
  }
  window.addEventListener("message", serve);
})();
