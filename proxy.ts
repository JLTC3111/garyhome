import { NextResponse, type NextRequest } from "next/server";
import { isPublicPagePath, localizedPath, localizedRoute } from "./lib/localized-routes";

export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  // Never trust client-supplied routing evidence.
  headers.delete("x-gary-language"); headers.delete("x-gary-public-path");
  const localized = localizedRoute(request.nextUrl.pathname);
  if ((localized?.path || request.nextUrl.pathname).replace(/\/$/, "") === "/about") {
    const destination = request.nextUrl.clone();
    destination.pathname = localized ? localizedPath("/services", localized.language) : "/services";
    return NextResponse.redirect(destination, 308);
  }
  if (!localized || !isPublicPagePath(localized.path)) return NextResponse.next({ request: { headers } });
  const destination = request.nextUrl.clone();
  destination.pathname = localized.path;
  headers.set("x-gary-language", localized.language);
  headers.set("x-gary-public-path", request.nextUrl.pathname);
  const cookies = (headers.get("cookie") || "").split(";").map(value => value.trim()).filter(value => value && !value.startsWith("gary-language="));
  cookies.push(`gary-language=${localized.language}`);
  headers.set("cookie", cookies.join("; "));
  return NextResponse.rewrite(destination, { request: { headers } });
}

export const config = { matcher: ["/((?!_next/|images/|fonts/|shared/|favicon|.*\\.[a-zA-Z0-9]+$).*)"] };
