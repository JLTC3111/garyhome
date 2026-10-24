"use client";
import { Mail, Phone, UserRound } from "lucide-react";
import { useSite } from "./site-context";
import { channelUrl, listingCode } from "@/lib/rentals";
import type { Property } from "@/lib/types";
export function ListingAuthorCard({property}:{property?:Property}) {
  const {content,t,language}=useSite();
  const author=(content.authors||[]).find(a=>a.id===property?.author_id&&a.published);
  const phone=author?.phone||content.settings.contact_phone,email=author?.email||content.settings.contact_email;
  const whatsapp=author?.whatsapp_phone||content.settings.whatsapp_phone||"",zalo=author?.zalo_phone||content.settings.zalo_phone||"";
  const message=property?`${t("I’m interested in property","Tôi quan tâm bất động sản")} ${listingCode(property)}`:"";
  return <section className="listing-author-card" aria-label={t("Listing contact","Liên hệ phụ trách tin đăng")}><h2>{t("Your listing contact","Liên hệ chuyên viên")}</h2><div className="listing-author-person">{author?.portrait_url?<img src={author.portrait_url} alt={author.display_name} width="100" height="120"/>:<span className="author-portrait-placeholder" aria-label={t("Portrait not yet provided","Chưa có ảnh chân dung")}><UserRound size={43}/></span>}<div><h3>{author?.display_name||"Gary Home"}</h3>{(!author||author.is_placeholder)&&<small>{t("Team contact · profile pending","Liên hệ chung · hồ sơ đang cập nhật")}</small>}<a className="author-hotline" href={`tel:${phone.replace(/[^+\d]/g,"")}`}><Phone size={16}/>{phone}</a></div></div>{author&&(language==="vi"?author.bio_vi:author.bio_en)&&<p>{language==="vi"?author.bio_vi:author.bio_en}</p>}<div className="author-channels">{whatsapp&&<a href={channelUrl("whatsapp",whatsapp,message)} target="_blank" rel="noreferrer" className="whatsapp-link"><img className="messaging-brand-icon" src="/svg/WhatsApp.svg" alt="" width="22" height="22"/>WhatsApp</a>}{zalo&&<a href={channelUrl("zalo",zalo)} target="_blank" rel="noreferrer" className="zalo-link"><img className="messaging-brand-icon" src="/svg/Zalo.svg" alt="" width="22" height="22"/>Zalo</a>}<a href={`mailto:${email}${property?`?subject=${encodeURIComponent(message)}`:""}`}><Mail size={16}/>{t("Email","Email")}</a></div><a className="author-email" href={`mailto:${email}`}>{email}</a></section>;
}
export { FloatingContact } from "./floating-contact";
