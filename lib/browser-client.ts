"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchWithDeadline } from "./requests";

// Only called in a browser effect; never share a user session across server requests.
let current: { url: string; key: string; client: SupabaseClient } | undefined;
let publicCurrent: { url: string; key: string; client: SupabaseClient } | undefined;

// Public connection settings only; resumable uploads authenticate with the
// current user's JWT and Storage RLS, never a server credential.
export function browserBackendConfig(client: SupabaseClient) { return current?.client === client ? { url: current.url, publishableKey: current.key } : null; }

export function publicBrowserClient(url: string, key: string) {
  if (!publicCurrent || publicCurrent.url !== url || publicCurrent.key !== key) {
    publicCurrent = { url, key, client: createClient(url, key, {
      auth: { storageKey: "gary-public-content", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: fetchWithDeadline },
    }) };
  }
  return publicCurrent.client;
}
export function browserClient(url: string, key: string) {
  if (!current || current.url !== url || current.key !== key) {
    current = { url, key, client: createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      global: { fetch: fetchWithDeadline },
    }) };
  }
  return current.client;
}
