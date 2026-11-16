import { NextResponse, type NextRequest } from "next/server";
import { isPublicPagePath, localizedPath, localizedRoute } from "./lib/localized-routes";
import { CANONICAL_SITE_ORIGIN } from "./lib/site-origin";

export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  // Never trust client-supplied routing evidence.
  headers.delete("x-gary-language"); headers.delete("x-gary-public-path");
  const pathname = request.nextUrl.pathname, localized = localizedRoute(pathname);
  // Auth, staff, API, assets and unknown routes do not participate in public
  // locale or hostname redirects. In particular, never prefix recovery URLs.
  if (!isPublicPagePath(pathname)) return NextResponse.next({ request: { headers } });
  const language = localized?.language || "en";
  const base = (localized?.path || pathname).replace(/\/+$/, "") || "/";
  // A plain URL does not retain NextURL's original trailingSlash flag, which
  // would otherwise re-add a slash to /vi and redirect the page to itself.
  const incoming = new URL(request.url), destination = new URL(incoming);
  destination.pathname = localizedPath(base === "/about" ? "/services" : base, language);
  if (["garyhome.vn", "www.garyhome.vn"].includes(destination.hostname)) {
    const canonical = new URL(CANONICAL_SITE_ORIGIN);
    destination.protocol = canonical.protocol;
    destination.host = canonical.host;
  }
  // Legacy URLs have a stable English destination, irrespective of cookies or
  // Accept-Language. Cloning retains query parameters; browsers inherit hashes
  // across redirects because Location does not replace the fragment.
  if (pathname !== destination.pathname || incoming.origin !== destination.origin) {
    return NextResponse.redirect(destination, 308);
  }
  headers.set("x-gary-language", language);
  headers.set("x-gary-public-path", request.nextUrl.pathname);
  const cookies = (headers.get("cookie") || "").split(";").map(value => value.trim()).filter(value => value && !value.startsWith("gary-language="));
  cookies.push(`gary-language=${language}`);
  headers.set("cookie", cookies.join("; "));
  // Real /[locale] routes reuse the public page components. Rewriting to the
  // legacy URL would run its redirect again in Node proxy request handling.
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/((?!_next/|images/|fonts/|shared/|favicon|.*\\.[a-zA-Z0-9]+$).*)"] };
