"use client";

import { useId, useState } from "react";
import { ArrowRight, Building2, ChevronDown, MapPin, Search, SlidersHorizontal, Wallet } from "lucide-react";
import { useSite } from "./site-context";
import { SelectField } from "./select-field";
import { Disclosure } from "./motion-primitives/disclosure";
import { SpotlightCard } from "./react-bits/spotlight-card";
import { AMENITIES, amenityLabel, RENTAL_TYPES, typeLabel } from "@/lib/rentals";
import type { Filters } from "@/lib/property-search";

export function SearchForm({compact=false,initial={},action="/homes"}:{compact?:boolean;initial?:Filters;action?:string}) {
  const {t,content,language}=useSite();const id=useId();
  const [advanced,setAdvanced]=useState(!!(initial.q||initial.id||initial.beds||initial.baths||initial.amenity));
  const [period,setPeriod]=useState(initial.period||"month");
  const amenities=[...new Set([...Object.keys(AMENITIES),...content.properties.flatMap(p=>p.amenities)])];
  return <SpotlightCard className={`search-box rental-search ${compact?"rental-search-compact":""}`}>
    <form action={action} method="get">
      <input type="hidden" name="sort" value={initial.sort||""}/>
      <div className="search-fields">
        <label className="search-field"><span><MapPin size={15}/>{t("DISTRICT / AREA","QUẬN / KHU VỰC")}</span><SelectField name="district" defaultValue={initial.district||""} aria-label={t("District or area","Quận hoặc khu vực")}><option value="">{t("Anywhere in Hanoi","Tất cả Hà Nội")}</option>{content.neighbourhoods.map(n=><option key={n.slug} value={n.slug}>{n.name}</option>)}</SelectField></label>
        <label className="search-field"><span><Building2 size={15}/>{t("PROPERTY TYPE","LOẠI BẤT ĐỘNG SẢN")}</span><SelectField name="type" defaultValue={initial.type||""}><option value="">{t("All property types","Tất cả loại hình")}</option>{RENTAL_TYPES.map(type=><option key={type} value={type}>{typeLabel(type,language)}</option>)}</SelectField></label>
        <div className="search-field rental-price-field"><span><Wallet size={15}/>{t("BUDGET · USD","NGÂN SÁCH · USD")}</span><div><input name="min" type="number" min="0" step="any" defaultValue={initial.min||""} placeholder={t("Min","Từ")} aria-label={t("Minimum rental price in USD","Giá thuê tối thiểu (USD)")}/><span>—</span><input name="max" type="number" min="0" step="any" defaultValue={initial.max||""} placeholder={t("Max","Đến")} aria-label={t("Maximum rental price in USD","Giá thuê tối đa (USD)")}/></div></div>
        <button className="button search-submit" type="submit"><Search size={18}/>{t("Find a rental","Tìm nhà thuê")}<ArrowRight size={17}/></button>
      </div>
      <div className="rental-search-secondary"><button type="button" className="text-link" onClick={()=>setAdvanced(!advanced)} id={`${id}-trigger`} aria-controls={`${id}-panel`} aria-expanded={advanced}><SlidersHorizontal size={16}/>{t("Beds, baths, property ID & amenities","Phòng ngủ, phòng tắm, mã tin & tiện nghi")}<ChevronDown size={15}/></button><label>{t("Prices per","Giá theo")}<SelectField name="period" value={period} onValueChange={setPeriod}><option value="month">{t("Month","Tháng")}</option><option value="week">{t("Week","Tuần")}</option><option value="night">{t("Night","Đêm")}</option></SelectField></label></div>
      <Disclosure open={advanced} id={`${id}-panel`} labelledBy={`${id}-trigger`}><div className="rental-advanced">
        <label>{t("Bedrooms","Phòng ngủ")}<SelectField name="beds" defaultValue={initial.beds||""}><option value="">{t("Any","Tất cả")}</option><option value="0">Studio</option>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n}+</option>)}</SelectField></label>
        <label>{t("Bathrooms","Phòng tắm")}<SelectField name="baths" defaultValue={initial.baths||""}><option value="">{t("Any","Tất cả")}</option>{[1,2,3,4].map(n=><option key={n} value={n}>{n}+</option>)}</SelectField></label>
        <label>{t("Property ID","Mã bất động sản")}<input name="id" defaultValue={initial.id||""} placeholder="GH-000001" maxLength={80}/></label>
        <label>{t("Keyword / street","Từ khóa / tên đường")}<input name="q" defaultValue={initial.q||""} placeholder={t("A street or property detail","Tên đường hoặc đặc điểm nhà")} maxLength={200}/></label>
        <fieldset className="rental-amenities-filter"><legend>{t("Amenities · match all selected","Tiện nghi · có tất cả mục đã chọn")}</legend>{amenities.map(value=><label key={value}><input type="checkbox" name="amenity" value={value} defaultChecked={(initial.amenity||"").split(",").includes(value)}/>{amenityLabel(value,language)}</label>)}</fieldset>
      </div></Disclosure>
    </form>
  </SpotlightCard>;
}
