import { runtimeEnv } from "../runtime-env";
import { PUBLIC_LANDING_PATHS } from "../public-routes";
import { publicArticles } from "../editorial";
import { isPublicRental } from "../rentals";
import type { Content } from "../types";

export function auditEnvironment() {
  const primary = runtimeEnv.SITE_URL || runtimeEnv.VERCEL_PROJECT_PRODUCTION_URL;
  if (!primary) throw new Error("Configure SITE_URL with the public production domain before scanning.");
  const origin = (value: string) => {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443"
      || url.pathname !== "/" || url.search || url.hash) throw new Error("SEO domains must be HTTPS origins without paths or credentials.");
    return url.origin;
  };
  const base = origin(primary);
  return { base, allowedOrigins: [...new Set([base, ...(runtimeEnv.SEO_ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean).map(origin)])] };
}

export function auditSeeds(base: string, content: Content) {
  return [...new Set([
    ...PUBLIC_LANDING_PATHS.map(path => new URL(path, base).href),
    ...content.properties.filter(isPublicRental).map(row => new URL(`/homes/${row.slug}`, base).href),
    ...publicArticles(content.editorial).map(row => new URL(`/tips-and-news/${row.slug}`, base).href),
  ])];
}
