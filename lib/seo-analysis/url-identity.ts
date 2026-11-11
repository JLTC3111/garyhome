import { isPublicPagePath, localizedRoute, unlocalizedPath } from "../localized-routes.ts";

// Only known UI state is consolidated. Unknown query parameters remain distinct.
const uiKeys: Record<string, Set<string>> = {
  "/homes": new Set(["q", "district", "type", "min", "max", "budget", "currency", "beds", "baths", "amenity", "listing", "id", "sort", "page", "term", "period"]),
  "/contact": new Set(["area", "project", "service", "property"]),
  "/activities": new Set(["category"]),
};
export function normalizedSeoUrl(value: string, base?: string) {
  const url = new URL(value, base); url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  url.searchParams.sort(); return url;
}
export function preferredUiUrl(value: string, base?: string) {
  const url = normalizedSeoUrl(value, base), path = unlocalizedPath(url.pathname).replace(/\/+$/, "") || "/";
  if (uiKeys[path] && [...url.searchParams.keys()].every(key => uiKeys[path].has(key) || /^(?:utm_|gclid$|fbclid$)/i.test(key))) url.search = "";
  return url;
}
export function equivalentSeoUrls(actual: string, preferred: string, language?: string) {
  try {
    const a = preferredUiUrl(actual), b = preferredUiUrl(preferred);
    if (a.origin !== b.origin || a.search !== b.search) return false;
    if (a.pathname === b.pathname) return true;
    const al = localizedRoute(a.pathname), bl = localizedRoute(b.pathname);
    if (al && bl && al.language !== bl.language) return false;
    if (!language || !isPublicPagePath(a.pathname) || !isPublicPagePath(b.pathname)) return false;
    const baseLanguage = language.split("-")[0].toLowerCase();
    return (!al || al.language === baseLanguage) && (!bl || bl.language === baseLanguage)
      && unlocalizedPath(a.pathname) === unlocalizedPath(b.pathname);
  } catch { return false; }
}
