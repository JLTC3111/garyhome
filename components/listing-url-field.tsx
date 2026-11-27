"use client";

import { useId, useRef } from "react";
import { generateListingSlug } from "@/lib/listing-url";
import { publicUrlFor } from "@/lib/public-url";
import type { Property } from "@/lib/types";
import { useSite } from "./site-context";
import { ListingCopyButton } from "./listing-copy-button";

export function ListingUrlField({ property, automatic }: { property: Property; automatic: boolean }) {
  const { content, publicOrigin, t } = useSite(), fieldId = useId(), hintId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const slug = automatic ? generateListingSlug(property, content.properties) : property.slug;
  const url = publicUrlFor(slug, publicOrigin || "https://garyhome.vn");
  return <div className="property-slug-field">
    <div className="listing-url-heading"><label htmlFor={fieldId}>{automatic ? t("Listing URL (automatic)", "Đường dẫn tin đăng (tự động)") : t("Listing URL", "Đường dẫn tin đăng")}</label>
      <ListingCopyButton value={url} label={t("Copy link", "Sao chép")} field={field}/></div>
    <textarea ref={field} id={fieldId} name="listing_url" rows={2} value={url}
      readOnly aria-describedby={hintId} placeholder={t("Add a title to generate the link.", "Nhập tiêu đề để tạo liên kết.")}/>
    <small id={hintId}>{automatic
      ? t("Generated automatically from your final listing title when you save. You do not need to enter a URL.", "Liên kết được tạo tự động từ tiêu đề cuối cùng khi bạn lưu. Bạn không cần nhập đường dẫn.")
      : t("This listing keeps its saved link when the title changes.", "Tin đăng này giữ nguyên liên kết đã lưu khi thay đổi tiêu đề.")}</small>
  </div>;
}
