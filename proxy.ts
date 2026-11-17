import { NextResponse, type NextRequest } from "next/server";
import { isPublicPagePath, localizedPath, localizedRoute, unlocalizedPath } from "./lib/localized-routes";
import { CANONICAL_SITE_ORIGIN, STAFF_PORTAL_ORIGIN } from "./lib/site-origin";

const STAFF_HOST = "staff.garyhome.vn";
const CUSTOMERS_HOST = "customers.garyhome.vn";
const PUBLIC_HOSTS = ["garyhome.vn", "www.garyhome.vn"];
const CUSTOMER_PATHS = ["/account", "/login", "/saved", "/cart"];

function barePath(pathname: string) {
  return unlocalizedPath(pathname).replace(/\/+$/, "") || "/";
}
function redirect(origin: string, pathname: string, search: string) {
  const url = new URL(pathname, origin);
  url.search = search;
  return NextResponse.redirect(url, 308);
}

export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  // Never trust client-supplied routing evidence.
  headers.delete("x-gary-language"); headers.delete("x-gary-public-path");
  const incoming = new URL(request.url), host = incoming.hostname, pathname = request.nextUrl.pathname, search = incoming.search, path = barePath(pathname);
  // customers.garyhome.vn is an entry to the existing account page. Recovery
  // and every other path keep their path on the public site.
  if (host === CUSTOMERS_HOST) {
    if (path === "/" || path === "/account") return redirect(CANONICAL_SITE_ORIGIN, "/account", search);
    return redirect(CANONICAL_SITE_ORIGIN, pathname, search);
  }
  // The staff host serves the portal. Its public and customer URLs belong on www.
  if (host === STAFF_HOST) {
    const normalized = pathname.replace(/\/+$/, "") || "/";
    if (normalized === "/" || path === "/admin") {
      if (pathname !== "/admin") return redirect(STAFF_PORTAL_ORIGIN, "/admin", search);
      return NextResponse.next({ request: { headers } });
    }
    if (CUSTOMER_PATHS.includes(path)) return redirect(CANONICAL_SITE_ORIGIN, path, search);
    if (!isPublicPagePath(pathname)) return NextResponse.next({ request: { headers } });
  } else if (PUBLIC_HOSTS.includes(host) && path === "/admin") {
    return redirect(STAFF_PORTAL_ORIGIN, "/admin", search);
  }
  // Auth, API, assets and unknown routes do not participate in public
  // locale or hostname redirects. In particular, never prefix recovery URLs.
  if (!isPublicPagePath(pathname)) return NextResponse.next({ request: { headers } });
  const localized = localizedRoute(pathname);
  const language = localized?.language || "en";
  const base = (localized?.path || pathname).replace(/\/+$/, "") || "/";
  // A plain URL does not retain NextURL's original trailingSlash flag, which
  // would otherwise re-add a slash to /vi and redirect the page to itself.
  const destination = new URL(incoming);
  destination.pathname = localizedPath(base === "/about" ? "/services" : base, language);
  if ([...PUBLIC_HOSTS, STAFF_HOST].includes(destination.hostname)) {
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
