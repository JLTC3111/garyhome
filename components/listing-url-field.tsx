"use client";

import { useId } from "react";
import { generateListingSlug } from "@/lib/listing-url";
import { publicUrlFor } from "@/lib/public-url";
import type { Property } from "@/lib/types";
import { useSite } from "./site-context";

export function ListingUrlField({ property, automatic }: { property: Property; automatic: boolean }) {
  const { content, publicOrigin, t } = useSite(), hintId = useId();
  const slug = automatic ? generateListingSlug(property, content.properties) : property.slug;
  return <label className="property-slug-field">{automatic ? t("Listing URL (automatic)", "Đường dẫn tin đăng (tự động)") : t("Listing URL", "Đường dẫn tin đăng")}
    <input name="listing_url" type="url" value={publicUrlFor(slug, publicOrigin || "https://garyhome.vn")}
      readOnly aria-describedby={hintId} placeholder={t("Add a title to generate the link.", "Nhập tiêu đề để tạo liên kết.")}/>
    <small id={hintId}>{automatic
      ? t("Generated automatically from your final listing title when you save. You do not need to enter a URL.", "Liên kết được tạo tự động từ tiêu đề cuối cùng khi bạn lưu. Bạn không cần nhập đường dẫn.")
      : t("This listing keeps its saved link when the title changes.", "Tin đăng này giữ nguyên liên kết đã lưu khi thay đổi tiêu đề.")}</small>
  </label>;
}
