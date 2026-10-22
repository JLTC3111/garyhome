import { env } from "cloudflare:workers";
import { createClient } from "@supabase/supabase-js";
import { seed } from "./seed";
import type { Content } from "./types";
import { fetchWithDeadline } from "./requests";
import { ContentReadError, readPublishedContent } from "./public-content";

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
    return { content: await readPublishedContent(db), configured: true, error: false };
  } catch (error) {
    // Log identifiers only: SDK error details can contain URLs and credentials.
    console.warn("[Gary Home] Public content unavailable", error instanceof ContentReadError
      ? { resource: error.resource, status: error.status, code: error.code }
      : { type: error instanceof Error ? error.name : "UnknownError" });
    return { content: seed, configured: true, error: true };
  }
}
