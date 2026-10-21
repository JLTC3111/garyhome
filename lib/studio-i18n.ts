import translations from "@/data/studio-vi.json";
import type { Language } from "./types";

const labels: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  scheduled: "Viewing scheduled",
  closed: "Closed",
  published: "Published",
  draft: "Draft",
  archived: "Archived",
  viewing: "Viewing request",
  general: "General enquiry",
  landlord: "Landlord enquiry",
};

export function studioText(message: string, language: Language, values: Record<string, string | number> = {}) {
  const english = Object.hasOwn(labels, message) ? labels[message] : message;
  const translated = language === "vi" && Object.hasOwn(translations, english)
    ? (translations as Record<string, string>)[english]
    : english;
  return translated.replace(/\{(\w+)\}/g, (placeholder, key: string) => Object.hasOwn(values, key) ? String(values[key]) : placeholder);
}
