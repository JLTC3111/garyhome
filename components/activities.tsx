"use client";
import { ContentImage } from "./content-image";
import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Images, MessageSquare, Users } from "lucide-react";
import { useSite } from "./site-context";
import { PublishedFeedback } from "./published-feedback";
import type { PublicFeedback } from "@/lib/submissions";
import { PropertyGallery } from "./property-gallery";
import { ListingAuthorCard } from "./listing-author";
import type { SiteActivity } from "@/lib/types";
export function Activities({initialCategory,full=false,reviews=[],reviewsUnavailable=false}:{initialCategory?:SiteActivity["category"];full?:boolean;reviews?:PublicFeedback[];reviewsUnavailable?:boolean}){
  const {t,content,language}=useSite();const [selected,setSelected]=useState<SiteActivity["category"]>(initialCategory||"customers"),[photoLimit,setPhotoLimit]=useState(6);
  const items=(content.activities||[]).filter(a=>a.published&&a.category===selected).sort((a,b)=>a.sort_order-b.sort_order);
  const photos=items.filter(a=>a.media_kind==="photo");
  const title=t("Our activities","Hoạt động của chúng tôi");
  return <section className={`section container rental-activities ${full?"activities-full":""}`} id="our-activities"><div className="section-heading"><div><div className="eyebrow">GARY HOME</div>{full?<h1>{title}</h1>:<h2>{title}</h2>}<p>{t("Customers, feedback and the people behind Gary Home.","Khách hàng, phản hồi và đội ngũ Gary Home.")}</p></div>{!full&&<Link className="text-link" href="/activities">{t("View activities","Xem hoạt động")}<ArrowUpRight size={17}/></Link>}</div><div className="activity-tabs" role="group" aria-label={t("Activity categories","Danh mục hoạt động")}>{[["customers",t("Customers","Khách hàng"),Users],["feedback",t("Feedback","Phản hồi"),MessageSquare],["team",t("Our team","Đội ngũ"),Users]].map(([value,label,Icon])=>{const Symbol=Icon as typeof Users;return <button type="button" key={value as string} aria-pressed={selected===value} onClick={()=>{setSelected(value as SiteActivity["category"]);setPhotoLimit(6);}}><Symbol size={17}/>{label as string}</button>;})}</div>
    {selected!=="feedback"&&photos.length>0?<div className={`activity-photo-grid ${selected==="team"?"activity-team-gallery":""}`}>{photos.slice(0,full?photos.length:photoLimit).map(item=><figure key={item.id}><ContentImage src={item.image_url} alt={language==="vi"?item.caption_vi:item.caption_en} width={selected==="team"?1212:500} height={selected==="team"?1216:360} sizes={selected==="team"?"(max-width: 700px) 100vw, 820px":"(max-width: 600px) 50vw, (max-width: 1000px) 33vw, 25vw"} loading="lazy"/><figcaption>{language==="vi"?item.caption_vi:item.caption_en}</figcaption></figure>)}</div>:selected!=="feedback"?<div className="activity-empty"><Images size={30}/><h3>{t("More moments to share soon.","Những khoảnh khắc mới sẽ sớm được chia sẻ.")}</h3><p>{t("Get in touch with Gary Home for personal support.","Liên hệ Gary Home để được hỗ trợ trực tiếp.")}</p><Link className="text-link" href="/contact">{t("Contact us","Liên hệ")}<ArrowUpRight size={16}/></Link></div>:null}
    {selected!=="feedback"&&!full&&photos.length>photoLimit&&<button className="button button-outline activity-show-more" type="button" onClick={()=>setPhotoLimit(n=>n+6)}>{t("Show more photos","Xem thêm ảnh")} · {photos.length-photoLimit}</button>}
    {selected==="feedback"&&<PublishedFeedback initialReviews={reviews} unavailable={reviewsUnavailable} compact={!full}/>}
    {selected==="feedback"&&<div className="feedback-screenshots"><h3>{t("Feedback photos","Ảnh phản hồi")}</h3>{items.length?<PropertyGallery variant="feedback" images={items.map(a=>a.image_url)} title={t("Customer feedback","Phản hồi khách hàng")}/>:<p>{t("Feedback screenshots will appear here when shared with permission.","Ảnh chụp phản hồi sẽ xuất hiện tại đây khi được phép chia sẻ.")}</p>}</div>}
    {selected==="team"&&!photos.length&&<div className="activity-team-contact"><ListingAuthorCard/></div>}
  </section>;
}
