import { headers } from "next/headers";
import { siteUrl } from "@/lib/seo";

const PRIVATE_HOSTS = new Set(["staff.garyhome.vn", "customers.garyhome.vn"]);

export default async function robots() {
  const host = (await headers()).get("host")?.split(":")[0]?.toLowerCase();
  if (host && PRIVATE_HOSTS.has(host)) return { rules: { userAgent: "*", disallow: "/" } };
  return { rules: { userAgent: "*", allow: "/", disallow: ["/account", "/admin", "/login", "/cart", "/saved", "/auth/", "/api/"] }, sitemap: siteUrl() + "/sitemap.xml" };
}
