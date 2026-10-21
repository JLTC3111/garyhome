"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchWithDeadline } from "./requests";

// Only called in a browser effect; never share a user session across server requests.
let current: { url: string; key: string; client: SupabaseClient } | undefined;
export function browserClient(url: string, key: string) {
  if (!current || current.url !== url || current.key !== key) {
    current = { url, key, client: createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      global: { fetch: fetchWithDeadline },
    }) };
  }
  return current.client;
}
