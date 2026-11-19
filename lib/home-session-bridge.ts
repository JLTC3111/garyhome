import { request } from "./requests.ts";
import { CANONICAL_SITE_ORIGIN, STAFF_PORTAL_ORIGIN } from "./site-origin.ts";

const bridgePath = "/api/auth/session-bridge";
const bridgeProtocol = "gary-home-session-v1";
const sessionChanged = "gary-home-shared-session-changed";

export function homeAuthStorageKey(url: string) {
  return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
}

type SessionOperation = "read" | "write" | "remove" | "adopt";
type Reply = { type: "result"; id: number; ok: boolean; value?: string | boolean | null };

async function connectSessionFrame(storageKey: string) {
  const frame = document.createElement("iframe");
  frame.hidden = true;
  frame.title = "Gary Home session";
  frame.referrerPolicy = "no-referrer";
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
  frame.src = CANONICAL_SITE_ORIGIN + bridgePath;

  const { port1, port2 } = new MessageChannel();
  const pending = new Map<number, (reply: Reply) => void>();
  let operationId = 0;
  const close = () => { port1.close(); port2.close(); frame.remove(); };

  async function send(operation: SessionOperation, value?: string) {
    const id = ++operationId;
    try {
      const reply = await request(() => new Promise<Reply>(resolve => {
        pending.set(id, resolve);
        port1.postMessage({ id, operation, value });
      }), 5000);
      if (!reply.ok) throw new Error("Shared session storage is unavailable.");
      return reply.value;
    } finally { pending.delete(id); }
  }

  try {
    await request(() => new Promise<void>((resolve, reject) => {
      port1.onmessage = ({ data }) => {
        if (data?.type === "ready") resolve();
        if (data?.type === "unavailable") reject(new Error("Shared session storage is unavailable."));
        if (data?.type === "result") pending.get(data.id)?.(data);
        if (data?.type === "changed") window.dispatchEvent(new Event(sessionChanged));
      };
      frame.addEventListener("load", () => {
        frame.contentWindow?.postMessage({ type: bridgeProtocol, storageKey }, CANONICAL_SITE_ORIGIN, [port2]);
      }, { once: true });
      frame.addEventListener("error", () => reject(new Error("Shared session storage is unavailable.")), { once: true });
      document.body.appendChild(frame);
    }), 4000);
    return { send, close };
  } catch {
    close();
    return null;
  }
}

export async function staffSessionStorage(storageKey: string) {
  if (window.location.origin !== STAFF_PORTAL_ORIGIN || window.top !== window || typeof MessageChannel === "undefined") return undefined;
  const peer = await connectSessionFrame(storageKey);
  if (!peer) return undefined;

  try {
    const legacy = window.localStorage.getItem(storageKey);
    if (legacy) {
      // Keep a different, existing identity on its original hostname.
      if (await peer.send("adopt", legacy) !== true) {
        peer.close();
        return undefined;
      }
      window.localStorage.removeItem(storageKey);
    }
  } catch (error) {
    peer.close();
    throw error;
  }

  // Only the session record is shared. Auth link and PKCE state remain local
  // to the hostname that started the email flow.
  return {
    async getItem(key: string) {
      if (key !== storageKey) return window.localStorage.getItem(key);
      const value = await peer.send("read");
      return typeof value === "string" ? value : null;
    },
    async setItem(key: string, value: string) {
      if (key === storageKey) await peer.send("write", value);
      else window.localStorage.setItem(key, value);
    },
    async removeItem(key: string) {
      if (key === storageKey) await peer.send("remove");
      else window.localStorage.removeItem(key);
    },
  };
}

export function watchHomeSessionStorage(url: string, changed: () => void) {
  const origin = window.location.origin;
  if (origin === STAFF_PORTAL_ORIGIN) {
    window.addEventListener(sessionChanged, changed);
    return () => window.removeEventListener(sessionChanged, changed);
  }
  if (origin === CANONICAL_SITE_ORIGIN) {
    const storageKey = homeAuthStorageKey(url);
    const sync = (event: StorageEvent) => { if (event.key === storageKey || event.key === null) changed(); };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }
  return () => {};
}
