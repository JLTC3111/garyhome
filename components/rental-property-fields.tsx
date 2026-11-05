"use client";

import { useEffect } from "react";
import { useSite } from "./site-context";
import { SelectField } from "./select-field";
import { propertyTitle } from "@/lib/rentals";
import { CURRENT_STAFF_AUTHOR, defaultListingAuthorId } from "@/lib/listing-author-default";
import type { Property } from "@/lib/types";
import { PropertyListingIdField } from "./property-listing-id-field";

export function RentalPropertyFields({ property: p, patch, isNew = false }: {
  property: Property; isNew?: boolean; patch: (key: keyof Property, value: unknown) => void;
}) {
  const { t, language, content, user, staffProfile } = useSite();
  const authors = content.authors || [], ownAuthor = authors.find(author => author.staff_user_id === user?.id);
  const defaultAuthor = defaultListingAuthorId(authors, user?.id);
  const authorId = isNew && p.author_id === undefined ? defaultAuthor : p.author_id || "";
  const selectedAuthor = authors.find(author => author.id === authorId);
  const ownName = staffProfile?.display_name || user?.email || t("Your staff profile", "Hồ sơ nhân viên của bạn");
  useEffect(() => {
    if (isNew && p.author_id === undefined) patch("author_id", defaultAuthor);
  }, [isNew, p.id, p.author_id, defaultAuthor, patch]);

  return <>
    <div className="editor-section-title">{t("Rental details & listing contact", "Thời hạn thuê & chuyên viên phụ trách")}</div>
    <PropertyListingIdField property={p} patch={patch} isNew={isNew}/>
    <div className="form-row">
      <label>{t("Rental duration", "Thời hạn thuê")}<SelectField value={p.rental_term || "on_request"} onValueChange={value => patch("rental_term", value)}>
        <option value="on_request">{t("Confirm with the team", "Xác nhận với đội ngũ")}</option>
        <option value="short">{t("Short-term", "Ngắn hạn")}</option>
        <option value="long">{t("Long-term", "Dài hạn")}</option>
        <option value="both">{t("Short & long-term", "Ngắn & dài hạn")}</option>
      </SelectField></label>
      <label>{t("Price period", "Đơn vị giá thuê")}<SelectField value={p.price_period || "month"} onValueChange={value => patch("price_period", value)}>
        <option value="month">{t("Per month", "Mỗi tháng")}</option>
        <option value="week">{t("Per week", "Mỗi tuần")}</option>
        <option value="night">{t("Per night", "Mỗi đêm")}</option>
      </SelectField></label>
    </div>
    <label>{t("Listing author", "Chuyên viên phụ trách")}<SelectField name="author_id" value={authorId} onValueChange={value => patch("author_id", value || null)}>
      {user && (!ownAuthor || authorId === CURRENT_STAFF_AUTHOR) && <option value={CURRENT_STAFF_AUTHOR}>{ownName} · {t("You", "Bạn")}</option>}
      <option value="">{t("Gary Home company contact", "Liên hệ chung Gary Home")}</option>
      {authors.map(author => <option key={author.id} value={author.id}>{author.display_name}{author.staff_user_id === user?.id ? ` · ${t("You", "Bạn")}` : ""}{!author.published ? ` · ${t("draft", "bản nháp")}` : ""}</option>)}
    </SelectField>
      <small>{t("The person responsible for this listing. New listings select you automatically; you can choose another team member or the company contact.", "Người phụ trách tin đăng này. Tin mới tự động chọn bạn; bạn có thể đổi sang thành viên khác hoặc liên hệ chung của công ty.")}</small>
      {selectedAuthor && !selectedAuthor.published && <small>{t("This contact profile is still a draft. Its publication setting is unchanged.", "Hồ sơ liên hệ này vẫn là bản nháp. Trạng thái hiển thị của hồ sơ được giữ nguyên.")}</small>}
    </label>
    <div className="editor-section-title">{t("Location & furnishings (optional)", "Vị trí & nội thất (không bắt buộc)")}</div>
    <p className="form-info">{t("These details appear in the Location & Nearby and Furnishings & Facilities sections of the public listing. Add nearby places, transport, furniture and included services here. Leave them blank if the overview and checked amenities already cover everything.", "Thông tin này hiển thị trong mục Vị trí & Khu vực lân cận và Nội thất & Tiện nghi trên trang tin công khai. Bạn có thể thêm địa điểm gần nhà, giao thông, đồ nội thất và dịch vụ đi kèm. Có thể để trống nếu phần tổng quan và tiện nghi đã chọn đã đủ thông tin.")}</p>
    {([
      ["location_en", t("Location & Nearby · English", "Vị trí & Khu vực lân cận · Tiếng Anh")],
      ["location_vi", t("Location & Nearby · Vietnamese", "Vị trí & Khu vực lân cận · Tiếng Việt")],
      ["furnishings_en", t("Furnishings & Facilities · English", "Nội thất & Tiện nghi · Tiếng Anh")],
      ["furnishings_vi", t("Furnishings & Facilities · Vietnamese", "Nội thất & Tiện nghi · Tiếng Việt")],
    ] as const).map(([key, label]) => <label key={key}>{label}<textarea rows={4} maxLength={8000} value={p[key] || ""} onChange={event => patch(key, event.target.value)}/></label>)}
    <div className="form-info"><strong>{t("Listing title preview", "Xem trước tiêu đề tin đăng")}</strong><p>{propertyTitle(p, language, content.neighbourhoods.find(neighbourhood => neighbourhood.slug === p.district_slug)?.name)}</p></div>
  </>;
}
