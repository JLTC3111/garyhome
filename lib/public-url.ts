export type PublicUrlKind = "property" | "article" | "neighbourhood";

const validKey = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function publicUrlFor(key: string, origin: string, kind: PublicUrlKind = "property") {
  if (!key || !validKey.test(key)) return key;
  const base = new URL(origin).origin;
  return kind === "neighbourhood" ? `${base}/homes?district=${key}` : `${base}/${kind === "article" ? "tips-and-news" : "homes"}/${key}`;
}

export function parsePublicUrl(value: string, origin: string, kind: PublicUrlKind = "property"): { key: string; issue: "required" | "format" | "origin" | "route" | "address" | null } {
  if (!value.trim()) return { key: "", issue: "required" };
  let url: URL;
  try { url = new URL(value); } catch { return { key: "", issue: "format" }; }
  if (url.protocol !== "https:" || url.username || url.password) return { key: "", issue: "format" };
  if (url.origin !== new URL(origin).origin) return { key: "", issue: "origin" };
  let key: string;
  if (kind === "neighbourhood") {
    if (url.pathname !== "/homes" || url.hash || [...url.searchParams.keys()].some(name => name !== "district") || url.searchParams.getAll("district").length !== 1) return { key: "", issue: "route" };
    key = url.searchParams.get("district") || "";
  } else {
    const prefix = kind === "article" ? "/tips-and-news/" : "/homes/";
    if (!url.pathname.startsWith(prefix) || url.search || url.hash) return { key: "", issue: "route" };
    key = url.pathname.slice(prefix.length).replace(/\/$/, "");
  }
  if (!validKey.test(key) || key.length > 180) return { key: "", issue: "address" };
  return { key, issue: null };
}
