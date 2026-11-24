"use client";
import { ContentImage } from "./content-image";

import { useState } from "react";
import Link from "./localized-link";
import { Heart, BedDouble, Bath, Expand, ArrowUpRight, MapPin, ChevronLeft, ChevronRight, ImageOff, LoaderCircle } from "lucide-react";
import PulseHeart from "./react-bits/pulse-heart";
import { EmblaCarouselListingCard } from "./embla-carousel-listing-card";
import { useSite } from "./site-context";
import { listingCode, propertyTitle, rentalTermLabel, typeLabel } from "@/lib/rentals";
import type { Property } from "@/lib/types";
import { formatPriceQuote, propertyPrice } from "@/lib/property-pricing";
import { propertyMatchExcerpt } from "@/lib/property-search";
import { KeywordHighlight } from "./keyword-highlight";

type PriceProperty = Pick<Property, "price" | "price_max" | "price_vnd" | "price_vnd_max" | "currency" | "price_period">;
export function Price({property,large=false}:{property:PriceProperty;large?:boolean}) {
  const {t,language,currency,exchangeRate}=useSite();const period=property.price_period||"month",quote=propertyPrice(property,currency,exchangeRate),price=quote?formatPriceQuote(quote,language):null;
  return <span className={`price ${large?"price-large":""}`}>{price!==null?<><strong className={quote?.currency==="VND"?"price-vnd":undefined} title={quote?.approximate?t("Approximate conversion","Giá quy đổi tham khảo"):undefined}>{price}</strong>{quote?.fallback&&<small className="price-currency-fallback">{quote.currency} · {t("entered price","giá đã nhập")}</small>}<small> / {period==="night"?t("night","đêm"):period==="week"?t("week","tuần"):t("month","tháng")}</small></>:<strong className="price-request">{t("Price on request","Liên hệ giá")}</strong>}</span>;
}
export function PropertyCard({property:p,pulseFavourite=false,photoThumbnails=false,keywordTerms=[]}:{
  property:Property;pulseFavourite?:boolean;photoThumbnails?:boolean;keywordTerms?:string[];
}) {
  const {t,language,saved,toggleSaved,pendingSaved,content}=useSite();
  const [photo,setPhoto]=useState(0),[failed,setFailed]=useState<string[]>([]);
  const district=content.neighbourhoods.find(n=>n.slug===p.district_slug)?.name||p.address;
  const index=Math.min(photo,Math.max(0,p.images.length-1)),src=p.images[index];
  const title=propertyTitle(p,language,district,false);
  const highlight=(text:string)=>keywordTerms.length?<span><KeywordHighlight text={text} terms={keywordTerms}/></span>:text;
  const excerpt=keywordTerms.length?propertyMatchExcerpt(p,keywordTerms,title,district,language):"";
  const liked=saved.includes(p.id),pending=pendingSaved.includes(p.id),favouriteLabel=liked?t("Remove from favourites","Bỏ yêu thích"):t("Add to favourites","Thêm yêu thích");
  const href=`/homes/${p.slug}`;
  const picture=(src?:string)=>src&&!failed.includes(src)?<ContentImage src={src} alt="" loading="lazy" width={640} height={440} sizes="(max-width: 650px) 100vw, (max-width: 1000px) 50vw, 33vw" onError={()=>setFailed(previous=>[...previous,src])}/>:<div className="rental-photo-placeholder"><ImageOff size={30}/>{t("Photos on request","Liên hệ nhận ảnh")}</div>;
  const badges=<>
    <div className="property-badges"><span>{t("FOR RENT","CHO THUÊ")}</span><span className="property-code">{listingCode(p)}</span></div>
    {pulseFavourite?<PulseHeart liked={liked} pending={pending} disabled={pending} showCount={false} label={favouriteLabel} onChange={()=>toggleSaved(p.id)} icon={filled=><Heart size={18} fill={filled?"currentColor":"none"}/>}/>:<button type="button" data-button-variant="save" className={`save-button ${liked?"is-saved":""}`} onClick={()=>toggleSaved(p.id)} disabled={pending} aria-busy={pending} aria-label={favouriteLabel} aria-pressed={liked}>{pending?<LoaderCircle className="spin" size={18}/>:<Heart size={18} fill={liked?"currentColor":"none"}/>}</button>}
  </>;
  return <article className="property-card rental-property-card">
    {photoThumbnails&&p.images.length>1 ?
    <EmblaCarouselListingCard photos={p.images} href={href} title={title} renderPhoto={picture}>{badges}</EmblaCarouselListingCard> :
    <div className="property-image"><Link href={href} tabIndex={-1} aria-hidden="true" aria-label={title}>{picture(src)}</Link>
      {badges}
      {p.images.length>1&&<><div className="rental-card-photo-nav"><button type="button" onClick={()=>setPhoto((index-1+p.images.length)%p.images.length)} aria-label={t("Previous property photo","Ảnh bất động sản trước")}><ChevronLeft size={17}/></button><button type="button" onClick={()=>setPhoto((index+1)%p.images.length)} aria-label={t("Next property photo","Ảnh bất động sản tiếp theo")}><ChevronRight size={17}/></button></div><span className="rental-photo-position">{index+1} / {p.images.length}</span></>}
    </div>}
    <div className="property-info"><div className="property-kicker">{highlight(typeLabel(p.property_type,language))}<span>·</span>{highlight(district)}</div><h3><Link href={href}>{highlight(title)}<ArrowUpRight size={18}/></Link></h3><p className="property-address"><MapPin size={13}/>{highlight(p.address)}</p>{excerpt&&<p className="rental-card-keyword-excerpt"><KeywordHighlight text={excerpt} terms={keywordTerms}/></p>}<div className="property-specs"><span><BedDouble size={17}/>{p.bedrooms}<span className="sr-only">{t("bedrooms","phòng ngủ")}</span></span>{p.bathrooms!==null&&<span><Bath size={17}/>{p.bathrooms}<span className="sr-only">{t("bathrooms","phòng tắm")}</span></span>}{p.area_sqm!==null&&<span><Expand size={15}/>{p.area_sqm} m²</span>}</div><p className="rental-term-note">{rentalTermLabel(p.rental_term,language)}</p><div className="rental-card-bottom"><Price property={p}/></div></div>
  </article>;
}
