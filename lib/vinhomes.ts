import suppliedProjects from "../data/vinhomes.json";
import type { Language } from "./types";

export type VinhomesProject = {
  slug: string; name: string; location: string[]; building: string; bedrooms: number;
  bedroomPlus?: boolean; bathrooms?: number; areaSqm?: number; rentVnd: number;
  leaseMonths?: number; depositMonths: number; paymentMonths: number; reference?: string;
  images: string[]; sourceNote: string;
};

// Keep the owner's supplied photographs and original VND rental quotes.
export const vinhomesProjects: readonly VinhomesProject[] = suppliedProjects;
export function projectSummary(project: VinhomesProject, language: Language) {
  return [
    `${project.bedrooms}${project.bedroomPlus ? "+" : ""} ${language === "vi" ? "phòng ngủ" : "bedrooms"}`,
    ...(project.bathrooms ? [`${project.bathrooms} ${language === "vi" ? "phòng tắm" : "bathrooms"}`] : []),
    ...(project.areaSqm ? [`${project.areaSqm} m²`] : []),
  ].join(" · ");
}

export function enquiryContext(service: string | null, projectSlug: string | null, language: Language): string {
  if (service === "restaurant") return language === "vi" ? "Tư vấn mở nhà hàng" : "Restaurant opening consultancy";
  if (service === "office") return language === "vi" ? "Tư vấn mở văn phòng" : "Office opening consultancy";
  const project = vinhomesProjects.find(item => item.slug === projectSlug);
  return project ? `${project.name} · ${project.building}${project.reference ? ` · ${project.reference}` : ""}` : "";
}
