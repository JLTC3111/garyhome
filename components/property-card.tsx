"use client";
import { ContentImage } from "./content-image";

import { useState } from "react";
import Link from "next/link";
import { Heart, BedDouble, Bath, Expand, ArrowUpRight, MapPin, ChevronLeft, ChevronRight, ImageOff, LoaderCircle } from "lucide-react";
import { useSite } from "./site-context";
import { listingCode, propertyTitle, rentalTermLabel, typeLabel } from "@/lib/rentals";
import type { Property } from "@/lib/types";

export function Price({property,large=false}:{property:Property;large?:boolean}) {
  const {t,language}=useSite();const period=property.price_period||"month";
  return <span className={`price ${large?"price-large":""}`}>{property.price!==null?<><strong>{property.currency==="USD"?"$":property.currency+" "}{property.price.toLocaleString(language==="vi"?"vi-VN":"en-US")}</strong><small> / {period==="night"?t("night","đêm"):period==="week"?t("week","tuần"):t("month","tháng")}</small></>:<strong className="price-request">{t("Price on request","Liên hệ giá")}</strong>}</span>;
}
export function PropertyCard({property:p}:{property:Property}) {
  const {t,language,saved,toggleSaved,pendingSaved,content}=useSite();
  const [photo,setPhoto]=useState(0),[failed,setFailed]=useState<string[]>([]);
  const district=content.neighbourhoods.find(n=>n.slug===p.district_slug)?.name||p.address;
  const index=Math.min(photo,Math.max(0,p.images.length-1)),src=p.images[index];
  const title=propertyTitle(p,language,district,false);
  return <article className="property-card rental-property-card">
    <div className="property-image"><Link href={`/homes/${p.slug}`} tabIndex={-1} aria-hidden="true">{src&&!failed.includes(src)?<ContentImage src={src} alt="" loading="lazy" width={640} height={440} sizes="(max-width: 650px) 100vw, (max-width: 1000px) 50vw, 33vw" onError={()=>setFailed(previous=>[...previous,src])}/>:<div className="rental-photo-placeholder"><ImageOff size={30}/>{t("Photos on request","Liên hệ nhận ảnh")}</div>}</Link>
      <div className="property-badges"><span>{t("FOR RENT","CHO THUÊ")}</span><span className="property-code">{listingCode(p)}</span></div>
      <button type="button" className={`save-button ${saved.includes(p.id)?"is-saved":""}`} onClick={()=>toggleSaved(p.id)} disabled={pendingSaved.includes(p.id)} aria-busy={pendingSaved.includes(p.id)} aria-label={saved.includes(p.id)?t("Remove from favourites","Bỏ yêu thích"):t("Add to favourites","Thêm yêu thích")} aria-pressed={saved.includes(p.id)}>{pendingSaved.includes(p.id)?<LoaderCircle className="spin" size={18}/>:<Heart size={18} fill={saved.includes(p.id)?"currentColor":"none"}/>}</button>
      {p.images.length>1&&<><div className="rental-card-photo-nav"><button type="button" onClick={()=>setPhoto((index-1+p.images.length)%p.images.length)} aria-label={t("Previous property photo","Ảnh bất động sản trước")}><ChevronLeft size={17}/></button><button type="button" onClick={()=>setPhoto((index+1)%p.images.length)} aria-label={t("Next property photo","Ảnh bất động sản tiếp theo")}><ChevronRight size={17}/></button></div><span className="rental-photo-position">{index+1} / {p.images.length}</span></>}
    </div>
    <div className="property-info"><div className="property-kicker">{typeLabel(p.property_type,language)}<span>·</span>{district}</div><h3><Link href={`/homes/${p.slug}`}>{title}<ArrowUpRight size={18}/></Link></h3><p className="property-address"><MapPin size={13}/>{p.address}</p><div className="property-specs"><span><BedDouble size={17}/>{p.bedrooms}<span className="sr-only">{t("bedrooms","phòng ngủ")}</span></span>{p.bathrooms!==null&&<span><Bath size={17}/>{p.bathrooms}<span className="sr-only">{t("bathrooms","phòng tắm")}</span></span>}{p.area_sqm!==null&&<span><Expand size={15}/>{p.area_sqm} m²</span>}</div><p className="rental-term-note">{rentalTermLabel(p.rental_term,language)}</p><div className="rental-card-bottom"><Price property={p}/></div></div>
  </article>;
}
