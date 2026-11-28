"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { homeAuthStorageKey, staffSessionStorage } from "./home-session-bridge";
import { serializeRealtimeReconnect } from "./realtime-lifecycle";
import { fetchWithDeadline } from "./requests";

// Only called in a browser effect; never share a user session across server requests.
let current: { url: string; key: string; client: SupabaseClient } | undefined;
let connecting: { url: string; key: string; promise: Promise<SupabaseClient> } | undefined;
let publicCurrent: { url: string; key: string; client: SupabaseClient } | undefined;

function withRealtimeLifecycle(client: SupabaseClient) {
  if (typeof window !== "undefined") serializeRealtimeReconnect(client.realtime);
  return client;
}

// Public connection settings only; resumable uploads authenticate with the
// current user's JWT and Storage RLS, never a server credential.
export function browserBackendConfig(client: SupabaseClient) { return current?.client === client ? { url: current.url, publishableKey: current.key } : null; }

export function publicBrowserClient(url: string, key: string) {
  if (!publicCurrent || publicCurrent.url !== url || publicCurrent.key !== key) {
    publicCurrent = { url, key, client: withRealtimeLifecycle(createClient(url, key, {
      auth: { storageKey: "gary-public-content", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: fetchWithDeadline },
    })) };
  }
  return publicCurrent.client;
}
export async function browserClient(url: string, key: string) {
  if (current?.url === url && current.key === key) return current.client;
  if (connecting?.url === url && connecting.key === key) return connecting.promise;

  const promise = Promise.resolve().then(async () => {
    const storageKey = homeAuthStorageKey(url);
    const storage = await staffSessionStorage(storageKey);
    const client = withRealtimeLifecycle(createClient(url, key, {
      auth: { storageKey, storage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      global: { fetch: fetchWithDeadline },
    }));
    if (connecting?.promise === promise) current = { url, key, client };
    return client;
  }).finally(() => {
    if (connecting?.promise === promise) connecting = undefined;
  });
  connecting = { url, key, promise };
  return promise;
}
