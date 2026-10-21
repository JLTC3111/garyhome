import { env } from "cloudflare:workers";
import { createClient } from "@supabase/supabase-js";
import { seed } from "./seed";
import type { Content } from "./types";
import { fetchWithDeadline, request } from "./requests";

export function backendConfig() {
  const runtime = env as unknown as Record<string, string | undefined>;
  return {
    url: runtime.SUPABASE_URL || process.env.SUPABASE_URL || "",
    key: runtime.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "",
  };
}
export function publicSupabase(accessToken?: string) {
  const { url, key } = backendConfig();
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}), fetch: (input, init) => fetchWithDeadline(input, init, 10000) } }) : null;
}
export async function loadContent(): Promise<{ content: Content; configured: boolean; error: boolean }> {
  const db = publicSupabase();
  if (!db) return { content: seed, configured: false, error: false };
  try {
    const [properties, neighbourhoods, settings] = await request(signal => Promise.all([
      db.from("properties").select("*").eq("status", "published").order("sort_order").abortSignal(signal),
      db.from("neighbourhoods").select("*").order("sort_order").abortSignal(signal),
      db.from("site_settings").select("*").eq("id", "main").abortSignal(signal).single(),
    ]), 12000);
    if (properties.error || neighbourhoods.error || settings.error) throw new Error("Content unavailable");
    return { content: { properties: properties.data, neighbourhoods: neighbourhoods.data, settings: settings.data } as Content, configured: true, error: false };
  } catch {
    return { content: seed, configured: true, error: true };
  }
}
