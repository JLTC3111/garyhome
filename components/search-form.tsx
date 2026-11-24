"use client";

import { useDeferredValue, useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Bath, BedDouble, Building2, MapPin, MoreVertical, Search, Hash, Wallet } from "lucide-react";
import { useSite } from "./site-context";
import { SelectField } from "./select-field";
import { Disclosure } from "./motion-primitives/disclosure";
import { SpotlightCard } from "./react-bits/spotlight-card";
import { AMENITIES, amenityLabel, canonicalAmenity, propertyTitle, RENTAL_TYPES, typeLabel } from "@/lib/rentals";
import { filterProperties, propertyMatchExcerpt, propertySearchTerms, type Filters } from "@/lib/property-search";
import type { ExchangeRate, PriceCurrency, Property } from "@/lib/types";
import { convertBudget, currencyValue } from "@/lib/currency";
import { localizedPath } from "@/lib/localized-routes";
import { CurrencySwitcher } from "./currency-switcher";
import { KeywordHighlight } from "./keyword-highlight";
import Link from "./localized-link";

type Budget = { currency: PriceCurrency; min: string; max: string };

function budgetForCurrency(filters: Filters, currency: PriceCurrency, exchangeRate?: ExchangeRate|null): Budget {
  const budget = { currency: currencyValue(filters.currency), min: filters.min || "", max: filters.max || "" };
  const min=convertBudget(budget.min,budget.currency,currency,exchangeRate,"min"),max=convertBudget(budget.max,budget.currency,currency,exchangeRate,"max");
  return min===null||max===null?budget:{currency,min,max};
}
function BudgetField({ budget, onChange, advanced=false }: { budget: Budget; onChange: (next: Budget) => void; advanced?: boolean }) {
  const {t}=useSite();
  return <div className={`rental-price-field ${advanced?"rental-advanced-budget":"search-field"}`}>
    <input type="hidden" name="currency" value={budget.currency}/>
    <span><Wallet size={15}/>{t("MONTHLY BUDGET","NGÂN SÁCH THÁNG")} · {budget.currency}</span>
    <div><input name="min" type="number" min="0" step={budget.currency==="VND"?"1":"0.01"} value={budget.min}
      onChange={event=>onChange({...budget,min:event.target.value})} placeholder={t("Min","Từ")} aria-label={t("Minimum rental price in ","Giá thuê tối thiểu · ")+budget.currency}/>
    <span aria-hidden="true">—</span>
    <input name="max" type="number" min="0" step={budget.currency==="VND"?"1":"0.01"} value={budget.max}
      onChange={event=>onChange({...budget,max:event.target.value})} placeholder={t("Max","Đến")} aria-label={t("Maximum rental price in ","Giá thuê tối đa · ")+budget.currency}/></div>
  </div>;
}
type RoomFieldProps = { value: string; onChange: (value: string) => void; main?: boolean };
function BedroomField({value,onChange,main=false}:RoomFieldProps){
  const {t}=useSite();
  return <label className={main?"rental-room-choice":undefined}><span>{main&&<BedDouble size={15}/>} {main?t("BEDROOMS","PHÒNG NGỦ"):t("Bedrooms","Phòng ngủ")}</span><SelectField name="beds" value={value} onValueChange={onChange} aria-label={t("Bedrooms","Phòng ngủ")}><option value="">{t("Any","Tất cả")}</option><option value="0">Studio</option>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n}+</option>)}</SelectField></label>;
}
function BathroomField({value,onChange,main=false}:RoomFieldProps){
  const {t}=useSite();
  return <label className={main?"rental-room-choice":undefined}><span>{main&&<Bath size={15}/>} {main?t("BATHROOMS","PHÒNG TẮM"):t("Bathrooms","Phòng tắm")}</span><SelectField name="baths" value={value} onValueChange={onChange} aria-label={t("Bathrooms","Phòng tắm")}><option value="">{t("Any","Tất cả")}</option>{[1,2,3,4].map(n=><option key={n} value={n}>{n}+</option>)}</SelectField></label>;
}

function KeywordResults({ results, query, busy, id }: { results: Property[]; query: string; busy: boolean; id: string }) {
  const {t,language,content}=useSite();
  const terms=propertySearchTerms(query);
  const limit=4;
  return <section className="rental-keyword-results" id={id} aria-label={t("Keyword matches","Kết quả theo từ khóa")} aria-busy={busy}>
    <p role="status">{results.length
      ? t(`${results.length} ${results.length===1?"matching rental":"matching rentals"}`,`${results.length} nhà cho thuê phù hợp`)
      : t("No rentals match these keywords and filters.","Không có nhà cho thuê phù hợp với từ khóa và bộ lọc.")}</p>
    {results.length>0&&<ul>{results.slice(0,limit).map(property=>{
      const area=content.neighbourhoods.find(n=>n.slug===property.district_slug)?.name||property.address;
      const title=propertyTitle(property,language,area,false);
      const excerpt=propertyMatchExcerpt(property,terms,title,area,language);
      const address=property.address&&property.address!==area?`${property.address} · ${area}`:area;
      return <li key={property.id}><Link href={`/homes/${property.slug}`}>
        <strong><KeywordHighlight text={title} terms={terms}/></strong>
        {address&&<span><KeywordHighlight text={address} terms={terms}/></span>}
        {excerpt&&<span><KeywordHighlight text={excerpt} terms={terms}/></span>}
      </Link></li>;
    })}</ul>}
    {results.length>limit&&<button type="submit" className="text-link">{t("View all results","Xem tất cả kết quả")}<ArrowRight size={16} aria-hidden="true"/></button>}
  </section>;
}

export function SearchForm({compact=false,initial={},action="/homes",roomsFirst=false,savedOnly=false}:{compact?:boolean;initial?:Filters;action?:string;roomsFirst?:boolean;savedOnly?:boolean}) {
  const {t,content,language,currency="USD",exchangeRate,saved}=useSite();const id=useId(),trigger=useRef<HTMLButtonElement>(null);
  const router=useRouter(),[searching,startSearch]=useTransition(),destination=localizedPath(action,language);
  const [advanced,setAdvanced]=useState(!!(initial.amenity||(roomsFirst?(initial.min||initial.max):(initial.beds||initial.baths))));
  const [draft,setDraft]=useState<Filters>(()=>({...initial,currency:initial.min||initial.max?currencyValue(initial.currency):currency}));
  const [editedKeyword,setEditedKeyword]=useState(false);
  const deferred=useDeferredValue(draft);
  const matches=useMemo(()=>{
    if(!editedKeyword||!deferred.q?.trim())return null;
    const filters={...deferred,...budgetForCurrency(deferred,currency,exchangeRate)};
    const properties=savedOnly?content.properties.filter(property=>saved.includes(property.id)):content.properties;
    return filterProperties(properties,filters,{currency,exchangeRate,neighbourhoods:content.neighbourhoods});
  },[editedKeyword,deferred,currency,exchangeRate,savedOnly,saved,content]);
  const budget=budgetForCurrency(draft,currency,exchangeRate);
  const changeBudget=(next:Budget)=>setDraft(previous=>({...previous,...next}));
  const setFilter=(key:keyof Filters,value:string)=>setDraft(previous=>({...previous,[key]:value}));
  const amenities=useMemo(()=>[...new Set([...Object.keys(AMENITIES),...content.properties.flatMap(p=>p.amenities.map(canonicalAmenity))])],[content.properties]);
  const selected=(draft.amenity||"").split(",").filter(Boolean).map(canonicalAmenity);
  const showMatches=matches!==null&&!!draft.q?.trim();
  return <SpotlightCard className={`search-box rental-search ${compact?"rental-search-compact":""} ${roomsFirst?"rental-search-rooms-first":""}`}>
    <form action={destination} method="get" aria-labelledby={`${id}-heading`} onSubmit={event=>{
      event.preventDefault();
      if(searching)return;
      const query=new URLSearchParams();
      new FormData(event.currentTarget).forEach((value,key)=>{
        if(typeof value==="string"&&value.trim())query.append(key,value.trim());
      });
      startSearch(()=>router.push(query.size?`${destination}?${query}`:destination));
    }}>
      <div className="rental-search-heading"><h2 id={`${id}-heading`}>{t("Find Your Rental","Tìm nhà cho thuê")}</h2><button ref={trigger} type="button" className={`rental-requirements-trigger ${advanced?"active":""}`} onClick={()=>setAdvanced(!advanced)} id={`${id}-trigger`} aria-controls={`${id}-panel`} aria-expanded={advanced}><span>{t("Custom Requirements","Nhu cầu riêng")}</span><MoreVertical size={21}/></button></div>
      <input type="hidden" name="sort" value={initial.sort||""}/>
      <div className="search-fields">
        <label className="search-field rental-keyword-field">
          <span><Search size={15} aria-hidden="true"/>{t("Search by keyword","Tìm theo từ khóa")}</span>
          <input name="q" type="search" value={draft.q||""} maxLength={200}
            aria-controls={showMatches?`${id}-results`:undefined}
            onChange={event=>{setEditedKeyword(true);setFilter("q",event.target.value);}}
            placeholder={t("Street, neighbourhood or amenity","Tên đường, khu vực hoặc tiện nghi")}/>
        </label>
        {showMatches&&<KeywordResults results={matches} query={deferred.q||""} busy={draft!==deferred||searching} id={`${id}-results`}/>}
        <label className="search-field"><span><MapPin size={15}/>{t("DISTRICT / AREA","QUẬN / KHU VỰC")}</span><SelectField name="district" value={draft.district||""} onValueChange={value=>setFilter("district",value)} aria-label={t("District or area","Quận hoặc khu vực")}><option value="">{t("Anywhere in Hanoi","Tất cả Hà Nội")}</option>{content.neighbourhoods.map(n=><option key={n.slug} value={n.slug}>{n.name}</option>)}</SelectField></label>
        <label className="search-field"><span><Building2 size={15}/>{t("PROPERTY TYPE","LOẠI BẤT ĐỘNG SẢN")}</span><SelectField name="type" value={draft.type||""} onValueChange={value=>setFilter("type",value)}><option value="">{t("All property types","Tất cả loại hình")}</option>{RENTAL_TYPES.map(type=><option key={type} value={type}>{typeLabel(type,language)}</option>)}</SelectField></label>
        {roomsFirst?<div className="search-field rental-room-field"><BedroomField value={draft.beds||""} onChange={value=>setFilter("beds",value)} main/><BathroomField value={draft.baths||""} onChange={value=>setFilter("baths",value)} main/></div>:<BudgetField budget={budget} onChange={changeBudget}/>}
        <label className="search-field rental-id-field"><span><Hash size={15}/>{t("APARTMENT / POST ID","MÃ CĂN HỘ / BÀI ĐĂNG")}</span><input name="id" type="search" value={draft.id||""} onChange={event=>setFilter("id",event.target.value)} placeholder="GH-05" maxLength={80} autoComplete="off" spellCheck={false} aria-label={t("Apartment or post ID","Mã căn hộ hoặc bài đăng")}/></label>
        <button className="button search-submit" type="submit" disabled={searching}><Search size={18}/>{searching?t("Searching…","Đang tìm…"):t("Find a rental","Tìm nhà thuê")}<ArrowRight size={17}/></button>
        <span className="sr-only" role="status">{searching?t("Searching rentals…","Đang tìm nhà cho thuê…"):""}</span>
      </div>
      <div className="rental-search-secondary"><span className="rental-requirements-hint">{roomsFirst?t("Budget, pets, gym, BBQ & more in Custom Requirements","Ngân sách, thú cưng, phòng tập, BBQ… trong Nhu cầu riêng"):t("Pets, gym, BBQ, lake views & more in Custom Requirements","Thú cưng, phòng tập, BBQ, tầm nhìn hồ… trong Nhu cầu riêng")}</span><CurrencySwitcher/></div>
      <Disclosure open={advanced} id={`${id}-panel`} labelledBy={`${id}-trigger`}><div className="rental-advanced" onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();setAdvanced(false);trigger.current?.focus();}}}>
        {roomsFirst?<BudgetField budget={budget} onChange={changeBudget} advanced/>:<><BedroomField value={draft.beds||""} onChange={value=>setFilter("beds",value)}/><BathroomField value={draft.baths||""} onChange={value=>setFilter("baths",value)}/></>}
        <fieldset className="rental-amenities-filter"><legend>{t("Amenities · match all selected","Tiện nghi · có tất cả mục đã chọn")}</legend>{amenities.map(value=><label key={value}><input type="checkbox" name="amenity" value={value} checked={selected.includes(value)} onChange={event=>setFilter("amenity",(event.target.checked?[...selected,value]:selected.filter(item=>item!==value)).join(","))}/>{amenityLabel(value,language)}</label>)}</fieldset>
      </div></Disclosure>
    </form>
  </SpotlightCard>;
}
