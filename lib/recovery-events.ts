// Coalesce wake-up events, but never drop a new online event behind an older,
// failing request. Browsers may emit focus/visibility/pageshow together.
export function installRecoveryEvents(
  recover: () => Promise<void>,
  offline: () => void,
  browser: Pick<Window, "addEventListener" | "removeEventListener"> = window,
  page: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState"> = document,
) {
  let active = true, queuedOnline = false;
  let flight: Promise<void> | null = null;
  const resume = () => {
    if (!active || page.visibilityState === "hidden" || flight) return;
    const task = Promise.resolve().then(recover).catch(() => {}).finally(() => {
      if (flight === task) flight = null;
      if (active && queuedOnline) { queuedOnline = false; resume(); }
    });
    flight = task;
  };
  const online = () => { if (flight) queuedOnline = true; resume(); };
  browser.addEventListener("focus", resume);
  browser.addEventListener("pageshow", resume);
  browser.addEventListener("online", online);
  browser.addEventListener("offline", offline);
  page.addEventListener("visibilitychange", resume);
  return () => {
    active = false;
    browser.removeEventListener("focus", resume); browser.removeEventListener("pageshow", resume);
    browser.removeEventListener("online", online); browser.removeEventListener("offline", offline);
    page.removeEventListener("visibilitychange", resume);
  };
}
