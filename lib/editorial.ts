import supplied from "../data/editorial.json" with { type: "json" };
import type { Language } from "./types";
export type EditorialKind = "news" | "tip";
export type EditorialSection = { heading_en: string; heading_vi: string; body_en: string; body_vi: string };
export type EditorialArticle = {
  id: string; slug: string; kind: EditorialKind; title_en: string; title_vi: string;
  summary_en: string; summary_vi: string; category_en: string; category_vi: string;
  image_url: string; sections: EditorialSection[]; sources: { title: string; url: string }[];
  status: "draft" | "published"; published_on: string | null; created_at: string; updated_at: string;
};
export const editorialSeed = supplied as EditorialArticle[];
export function publicArticles(rows: readonly EditorialArticle[] = editorialSeed) {
  return rows.filter(row => row.status === "published").toSorted((a, b) => (b.published_on || b.created_at).localeCompare(a.published_on || a.created_at));
}
export function articleText(row: EditorialArticle, field: "title" | "summary" | "category", language: Language) {
  return row[`${field}_${language === "vi" ? "vi" : "en"}`];
}
export function editorialView(row: EditorialArticle) {
  return { slug: row.slug, title: [row.title_en, row.title_vi] as const, summary: [row.summary_en, row.summary_vi] as const,
    sections: row.sections.map(s => ({ title: [s.heading_en, s.heading_vi] as const,
      items: Array.from({length: Math.max(s.body_en.split(/\n\s*\n/).length, s.body_vi.split(/\n\s*\n/).length)}, (_, i) => [s.body_en.split(/\n\s*\n/)[i] || "", s.body_vi.split(/\n\s*\n/)[i] || ""] as const) })),
    ...(row.image_url ? {image:row.image_url} : {}),
    ...(row.kind === "news" ? { category: [row.category_en, row.category_vi] as const, image: row.image_url, published: row.published_on || "", sources: row.sources } : { sources: row.sources }),
  };
}
export function validEditorialUrl(value: string, local = false) {
  if (!value) return true;
  if (local && /^\/(?!\/)/.test(value) && !/[\\\s]/.test(value)) return true;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !!url.hostname; } catch { return false; }
}
export function editorialIssue(row: EditorialArticle): "slug" | "image" | "sources" | "publish" | null {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(row.slug) || row.slug.length > 180) return "slug";
  if (!validEditorialUrl(row.image_url, true)) return "image";
  if (row.sources.some(s => !s.title.trim() || !s.url || !validEditorialUrl(s.url))) return "sources";
  if (row.status === "published" && (![row.title_en, row.title_vi, row.summary_en, row.summary_vi].every(s => s.trim()) || !row.sections.length
    || row.sections.some(s => ![s.heading_en, s.heading_vi, s.body_en, s.body_vi].every(text => text.trim()))
    || row.kind === "news" && (!row.image_url || !row.published_on))) return "publish";
  return null;
}
