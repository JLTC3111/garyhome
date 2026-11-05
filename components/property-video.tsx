"use client";

import { propertyVideoUrlError } from "@/lib/property-video";
import { useSite } from "./site-context";

export function PropertyVideo({ url, title }: { url?: string | null; title?: string }) {
  const { t } = useSite();
  if (!url || propertyVideoUrlError(url)) return null;
  return <figure className="property-video">
    <video src={url} controls playsInline preload="metadata" aria-label={title || t("Property video", "Video bất động sản")}
      style={{ display: "block", width: "100%", maxHeight: "70vh", background: "#10241b" }}>
      <a href={url}>{t("Open property video", "Mở video bất động sản")}</a>
    </video>
  </figure>;
}
