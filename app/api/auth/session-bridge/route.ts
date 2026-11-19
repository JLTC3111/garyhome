import { homeAuthStorageKey } from "@/lib/home-session-bridge";
import { backendConfig } from "@/lib/server";
import { CANONICAL_SITE_ORIGIN, STAFF_PORTAL_ORIGIN } from "@/lib/site-origin";

export function GET(request: Request) {
  const headers = {
    "Cache-Control": "no-store",
    "Content-Security-Policy": `default-src 'none'; script-src 'self'; frame-ancestors ${STAFF_PORTAL_ORIGIN}; base-uri 'none'; form-action 'none'`,
    "Content-Type": "text/html; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex",
  };
  if (new URL(request.url).origin !== CANONICAL_SITE_ORIGIN) return new Response(null, { status: 404, headers });

  const { url, key } = backendConfig();
  if (!url || !key) return new Response(null, { status: 404, headers });
  const storageKey = homeAuthStorageKey(url);
  if (!/^sb-[a-z0-9-]+-auth-token$/.test(storageKey)) return new Response(null, { status: 404, headers });

  const script = `<script src="/gary-home-session-bridge.js" data-origin="${CANONICAL_SITE_ORIGIN}" data-parent="${STAFF_PORTAL_ORIGIN}" data-key="${storageKey}"></script>`;
  return new Response(`<!doctype html><html><head><title>Gary Home session</title></head><body>${script}</body></html>`, { headers });
}
