"use client";
import { useSite } from "./site-context";
import { channelUrl } from "@/lib/rentals";

export function FloatingContact(){
 const {content,t,language}=useSite(),settings=content.settings;
 const whatsapp=settings.whatsapp_phone?channelUrl("whatsapp",settings.whatsapp_phone):"";
 const zalo=settings.zalo_phone?channelUrl("zalo",settings.zalo_phone):"";
 if(!whatsapp&&!zalo)return null;
 const whatsappLabel=t("Contact Gary Home on WhatsApp","Liên hệ Gary Home qua WhatsApp");
 const zaloLabel=t("Contact Gary Home on Zalo","Liên hệ Gary Home qua Zalo");
 // Keep a configured channel usable if the other is removed in Studio.
 if(!whatsapp||!zalo)return <aside className="contact-widget contact-widget-single" aria-label={t("Message Gary Home","Nhắn tin Gary Home")}><a href={whatsapp||zalo} target="_blank" rel="noreferrer" aria-label={whatsapp?whatsappLabel:zaloLabel}><img src={whatsapp?"/svg/WhatsApp.svg":"/svg/Zalo.svg"} alt="" width="32" height="32"/>{whatsapp?"WhatsApp":"Zalo"}</a></aside>;
 return <aside className="contact-widget" aria-label={t("Message Gary Home","Nhắn tin Gary Home")}>
  <picture className="contact-widget-art" aria-hidden="true">
   <source media="(max-width: 680px)" srcSet="/svg/contact-widget-03-compact.svg" width="272" height="106"/>
   <img key={language} src={language==="vi"?"/svg/contact-widget-04-chat-with-us-vi.svg":"/svg/contact-widget-04-chat-with-us.svg"} alt="" width="586" height="115" decoding="async"/>
  </picture>
  <a className="contact-widget-action contact-widget-whatsapp" href={whatsapp} target="_blank" rel="noreferrer" aria-label={whatsappLabel} title="WhatsApp"><span className="sr-only">WhatsApp</span></a>
  <a className="contact-widget-action contact-widget-zalo" href={zalo} target="_blank" rel="noreferrer" aria-label={zaloLabel} title="Zalo"><span className="sr-only">Zalo</span></a>
 </aside>;
}
