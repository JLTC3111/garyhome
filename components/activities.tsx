"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Images, MessageSquare, Users } from "lucide-react";
import { useSite } from "./site-context";
import { PropertyGallery } from "./property-gallery";
import { ListingAuthorCard } from "./listing-author";
import type { SiteActivity } from "@/lib/types";
export function Activities({initialCategory,full=false}:{initialCategory?:SiteActivity["category"];full?:boolean}){
  const {t,content,language}=useSite();const [selected,setSelected]=useState<SiteActivity["category"]>(initialCategory||"customers"),[photoLimit,setPhotoLimit]=useState(6);
  const items=(content.activities||[]).filter(a=>a.published&&a.category===selected).sort((a,b)=>a.sort_order-b.sort_order);
  const photos=items.filter(a=>a.media_kind==="photo"),screens=items.filter(a=>a.media_kind==="screenshot");
  const title=t("Our activities","Hoạt động của chúng tôi");
  return <section className={`section container rental-activities ${full?"activities-full":""}`} id="our-activities"><div className="section-heading"><div><div className="eyebrow">GARY HOME</div>{full?<h1>{title}</h1>:<h2>{title}</h2>}<p>{t("Customers, feedback and the people behind Gary Home.","Khách hàng, phản hồi và đội ngũ Gary Home.")}</p></div>{!full&&<Link className="text-link" href="/activities">{t("View activities","Xem hoạt động")}<ArrowUpRight size={17}/></Link>}</div><div className="activity-tabs" role="group" aria-label={t("Activity categories","Danh mục hoạt động")}>{[["customers",t("Customers","Khách hàng"),Users],["feedback",t("Feedback","Phản hồi"),MessageSquare],["team",t("Our team","Đội ngũ"),Users]].map(([value,label,Icon])=>{const Symbol=Icon as typeof Users;return <button type="button" key={value as string} aria-pressed={selected===value} onClick={()=>{setSelected(value as SiteActivity["category"]);setPhotoLimit(6);}}><Symbol size={17}/>{label as string}</button>;})}</div>
    {photos.length>0?<div className="activity-photo-grid">{photos.slice(0,full?photos.length:photoLimit).map(item=><figure key={item.id}><img src={item.image_url} alt={language==="vi"?item.caption_vi:item.caption_en} width="500" height="360" loading="lazy"/><figcaption>{language==="vi"?item.caption_vi:item.caption_en}</figcaption></figure>)}</div>:selected!=="feedback"?<div className="activity-empty"><Images size={30}/><h3>{t("More moments to share soon.","Những khoảnh khắc mới sẽ sớm được chia sẻ.")}</h3><p>{t("Get in touch with Gary Home for personal support.","Liên hệ Gary Home để được hỗ trợ trực tiếp.")}</p><Link className="text-link" href="/contact">{t("Contact us","Liên hệ")}<ArrowUpRight size={16}/></Link></div>:null}
    {!full&&photos.length>photoLimit&&<button className="button button-outline activity-show-more" type="button" onClick={()=>setPhotoLimit(n=>n+6)}>{t("Show more photos","Xem thêm ảnh")} · {photos.length-photoLimit}</button>}
    {selected==="feedback"&&<div className="feedback-screenshots"><h3>{t("Feedback screenshots","Ảnh chụp phản hồi")}</h3>{screens.length?<PropertyGallery images={screens.map(a=>a.image_url)} title={t("Customer feedback","Phản hồi khách hàng")}/>:<p>{t("Feedback screenshots will appear here when shared with permission.","Ảnh chụp phản hồi sẽ xuất hiện tại đây khi được phép chia sẻ.")}</p>}</div>}
    {selected==="team"&&<div className="activity-team-contact"><ListingAuthorCard/></div>}
  </section>;
}
