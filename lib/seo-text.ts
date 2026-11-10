import { propertyTitle } from "./rentals";
import type { Language, Property } from "./types";

// Pure helpers shared by the Metadata API and draft previews.
export function siteDescription(language: Language) {
  return language === "vi"
    ? "Căn hộ dịch vụ và bất động sản cho thuê tại Hà Nội. Khám phá tin đăng thực tế và đặt lịch xem nhà cùng Gary Home."
    : "Serviced apartments and property rentals in Hanoi. Browse real listings and arrange a viewing with Gary Home.";
}
export function propertySeoText(property: Property, language: Language, area?: string) {
  const title = propertyTitle(property, language, area) + " | Gary Home";
  const description = ((language === "vi" ? property.overview_vi || property.description_vi : property.overview_en || property.description_en) || title).replace(/\s+/g, " ").slice(0, 200);
  return { title, description };
}
