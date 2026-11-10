import { PUBLIC_LANDING_PATHS } from "./public-routes.ts";
import type { Language } from "./types";

export function localizedRoute(pathname: string): { language: Language; path: string } | null {
  const match = /^\/(en|vi)(?=\/|$)/.exec(pathname);
  return match ? { language: match[1] as Language, path: pathname.slice(match[0].length) || "/" } : null;
}
export function unlocalizedPath(pathname: string) { return localizedRoute(pathname)?.path || pathname; }
export function isPublicPagePath(pathname: string) {
  const path = unlocalizedPath(pathname).replace(/\/+$/, "") || "/";
  return (PUBLIC_LANDING_PATHS as readonly string[]).includes(path) || path === "/about"
    || /^\/(?:homes|tips-and-news)\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path);
}
export function localizedPath(value: string, language: Language) {
  if (!value.startsWith("/") || value.startsWith("//")) return value;
  const boundary = value.search(/[?#]/), pathname = boundary < 0 ? value : value.slice(0, boundary), suffix = boundary < 0 ? "" : value.slice(boundary);
  if (!isPublicPagePath(pathname)) return value;
  const base = unlocalizedPath(pathname).replace(/\/+$/, "") || "/";
  return `/${language}${base === "/" ? "" : base}${suffix}`;
}
export function localizedAlternates(path: string, origin: string, language: Language) {
  return {
    canonical: new URL(localizedPath(path, language), origin).href,
    languages: { en: new URL(localizedPath(path, "en"), origin).href, vi: new URL(localizedPath(path, "vi"), origin).href, "x-default": new URL(localizedPath(path, "en"), origin).href },
  };
}
