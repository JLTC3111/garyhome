import { runtimeEnv } from "./runtime-env";
import { createClient } from "@supabase/supabase-js";
import { seed } from "./seed";
import type { Content } from "./types";
import { fetchWithDeadline } from "./requests";
import { ContentReadError, readPublishedContent } from "./public-content";

export function backendConfig() {
  const runtime = runtimeEnv as unknown as Record<string, string | undefined>;
  return {
    url: runtime.SUPABASE_URL || process.env.SUPABASE_URL || "",
    key: runtime.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "",
  };
}
export function mayShowSeedContent() {
  return process.env.NODE_ENV !== "production" && runtimeEnv.VERCEL_ENV !== "production";
}

function unavailableContent(): Content {
  return {settings:seed.settings,properties:[],neighbourhoods:[],authors:[],activities:[],editorial:[]};
}
export function publicSupabase(accessToken?: string) {
  const { url, key } = backendConfig();
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}), fetch: (input, init) => fetchWithDeadline(input, init, 10000) } }) : null;
}
// Service credentials stay on the server. Routes must enforce fresh staff
// permissions or validated, tightly scoped public intake rules before using
// this client. The secret is never returned by /api/config.
export function staffAdminClient() {
  const runtime = runtimeEnv as unknown as Record<string, string | undefined>;
  const secret = runtime.SUPABASE_SECRET_KEY || process.env.SUPABASE_SECRET_KEY
    || runtime.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const { url } = backendConfig();
  return url && secret ? createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetchWithDeadline(input, init, 10000) },
  }) : null;
}
export async function loadContent(scope?: string): Promise<{ content: Content; configured: boolean; error: boolean }> {
  const db = publicSupabase();
  const allowSeed = mayShowSeedContent();
  if (!db) return { content: allowSeed ? seed : unavailableContent(), configured: false, error: !allowSeed };
  try {
    return { content: await readPublishedContent(db, undefined, scope), configured: true, error: false };
  } catch (error) {
    // Log identifiers only: SDK error details can contain URLs and credentials.
    console.warn("[Gary Home] Public content unavailable", error instanceof ContentReadError
      ? { resource: error.resource, status: error.status, code: error.code }
      : { type: error instanceof Error ? error.name : "UnknownError" });
    return { content: allowSeed ? seed : unavailableContent(), configured: true, error: true };
  }
}
