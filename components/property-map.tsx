"use client";

import { ArrowUpRight, MapPin } from "lucide-react";
import type { Neighbourhood, Property } from "@/lib/types";
import { propertyMapLocation } from "@/lib/property-map";
import { useSite } from "./site-context";

export function PropertyMap({ property, district }: { property: Property; district?: Neighbourhood }) {
  const { t } = useSite();
  const map = propertyMapLocation(property, district);
  return <div className="property-map">
    <div className="property-map-caption">
      <span className="property-map-precision"><MapPin size={15}/>{map.exact ? t("Author-provided location", "Vị trí do người đăng cung cấp") : t("Approximate location", "Vị trí gần đúng")}</span>
      <p>{map.label}</p>
    </div>
    <iframe
      key={map.embedUrl}
      src={map.embedUrl}
      title={map.exact ? t("Map of the author-provided property location", "Bản đồ vị trí bất động sản do người đăng cung cấp") : t("Map of the approximate property area", "Bản đồ khu vực gần đúng của bất động sản")}
      width="800"
      height="360"
      loading="lazy"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
    />
    <div className="property-map-footer">
      <p className="muted small">{map.exact ? t("Location supplied by the listing author.", "Vị trí do người đăng tin cung cấp.") : t("The map shows the surrounding area. Contact the team for the exact viewing address.", "Bản đồ hiển thị khu vực lân cận. Liên hệ đội ngũ để nhận địa chỉ xem nhà chính xác.")}</p>
      <a className="text-link" href={map.externalUrl} target="_blank" rel="noreferrer">{t("Open in Google Maps", "Mở trong Google Maps")}<ArrowUpRight size={16}/></a>
    </div>
  </div>;
}
