"use client";
import { SelectField } from "./select-field";
import { useState } from "react";
import { ArrowRight, MapPin, Building2, Wallet, Search, KeyRound, House, Check } from "lucide-react";
import { useSite } from "./site-context";
import type { Filters } from "@/lib/property-search";
import { AnimatedBackground } from "./motion-primitives/animated-background";
import { SpotlightCard } from "./react-bits/spotlight-card";

export function SearchForm({ compact=false, initial={} }: { compact?: boolean; initial?: Filters }) {
  const { t, content, language }=useSite();const [listing,setListing]=useState(initial.listing||"rent");
  return <SpotlightCard className={`search-box ${compact ? "search-compact" : ""}`}>
    <div className="search-tabs">
      <span>{t("I’M LOOKING TO", "TÔI MUỐN")}</span>
      <div className="search-mode-switch" role="group" aria-label={t("Rent or buy a home", "Thuê hoặc mua nhà")}>
        <AnimatedBackground activeValue={listing}>
          <button type="button" data-id="rent" aria-pressed={listing === "rent"} className={listing === "rent" ? "selected" : ""} onClick={() => setListing("rent")}>
            <KeyRound size={17} aria-hidden="true"/><span>{t("Rent a home", "Thuê nhà")}</span><Check className="search-mode-check" size={15} aria-hidden="true"/>
          </button>
          <button type="button" data-id="sale" aria-pressed={listing === "sale"} className={listing === "sale" ? "selected" : ""} onClick={() => setListing("sale")}>
            <House size={17} aria-hidden="true"/><span>{t("Buy a home", "Mua nhà")}</span><Check className="search-mode-check" size={15} aria-hidden="true"/>
          </button>
        </AnimatedBackground>
      </div>
    </div>
    <form action="/homes" method="get" className="search-fields">
      <input type="hidden" name="listing" value={listing}/>
      <label className="search-field">
        <span><MapPin size={16}/>{t("NEIGHBOURHOOD", "KHU VỰC")}</span>
        <SelectField name="district" defaultValue={initial.district || ""} aria-label={t("Choose neighbourhood", "Chọn khu vực")}>
          <option value="">{t("Anywhere in Hanoi", "Tất cả Hà Nội")}</option>
          {content.neighbourhoods.map(n => <option key={n.slug} value={n.slug}>{n.name}</option>)}
        </SelectField>
      </label>
      <label className="search-field">
        <span><Building2 size={16}/>{t("PROPERTY TYPE", "LOẠI NHÀ")}</span>
        <SelectField name="type" defaultValue={initial.type || ""}>
          <option value="">{t("A place that fits", "Tất cả loại nhà")}</option>
          <option value="Apartment">{t("Apartment", "Căn hộ")}</option><option value="Studio">Studio</option>
          <option value="House & Villa">{t("House & Villa", "Nhà & biệt thự")}</option>
          <option value="Office & Restaurant">{t("Office & Restaurant", "Mặt bằng kinh doanh")}</option>
        </SelectField>
      </label>
      <label className="search-field">
        <span><Wallet size={16}/>{t(listing === "rent" ? "MONTHLY BUDGET" : "BUDGET (USD)", listing === "rent" ? "NGÂN SÁCH / THÁNG" : "NGÂN SÁCH (USD)")}</span>
        <SelectField key={listing} name="max" defaultValue={(initial.listing || "rent") === listing ? initial.max || "" : ""}>
          <option value="">{t("What works for you?", "Mọi mức ngân sách")}</option>
          {(listing === "rent" ? [300, 600, 1000, 1500, 2500] : [100000, 250000, 500000, 1000000]).map(n => <option value={n} key={n}>{t("Up to", "Tối đa")} ${n.toLocaleString(language === "vi" ? "vi-VN" : "en-US")}</option>)}
        </SelectField>
      </label>
      <button className="button search-submit interactive-cta" type="submit"><Search size={18}/>{t("Find my home", "Tìm nhà")}<ArrowRight size={18}/></button>
    </form>
  </SpotlightCard>;
}
