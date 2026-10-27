"use client";
import { useEffect, useId, useRef, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import { useSite } from "./site-context";
import { channelUrl } from "@/lib/rentals";

type ChannelProps={whatsapp:string;zalo:string;whatsappLabel:string;zaloLabel:string;language:"en"|"vi"};

function ChannelLinks({whatsapp,zalo,whatsappLabel,zaloLabel,language,compact=false,onFollow}:{compact?:boolean;onFollow?:()=>void}&ChannelProps){
 if(!whatsapp||!zalo)return <a className="contact-single-link" href={whatsapp||zalo} target="_blank" rel="noreferrer" aria-label={whatsapp?whatsappLabel:zaloLabel} onClick={onFollow}><img src={whatsapp?"/svg/WhatsApp.svg":"/svg/Zalo.svg"} alt="" width="32" height="32"/><span>{whatsapp?"WhatsApp":"Zalo"}</span></a>;
 return <>
  <picture className="contact-widget-art">
   <img key={compact?"compact":language} src={compact?"/svg/contact-widget-03-transparent.svg":language==="vi"?"/svg/contact-widget-04-chat-with-us-vi.svg":"/svg/contact-widget-04-chat-with-us.svg"} alt="" width={compact?272:586} height={compact?106:115} decoding="async"/>
  </picture>
  <a className="contact-widget-action contact-widget-whatsapp" href={whatsapp} target="_blank" rel="noreferrer" aria-label={whatsappLabel} title="WhatsApp" onClick={onFollow}><span className="sr-only">WhatsApp</span></a>
  <a className="contact-widget-action contact-widget-zalo" href={zalo} target="_blank" rel="noreferrer" aria-label={zaloLabel} title="Zalo" onClick={onFollow}><span className="sr-only">Zalo</span></a>
 </>;
}

function MobileContact(props:ChannelProps){
 const {t}=useSite(),id=useId(),root=useRef<HTMLElement>(null),toggle=useRef<HTMLButtonElement>(null);
 const [open,setOpen]=useState(false);
 useEffect(()=>{
  if(!open)return;
  const media=window.matchMedia?.("(max-width: 680px)");
  function outside(event:PointerEvent){if(!root.current?.contains(event.target as Node))setOpen(false);}
  function key(event:KeyboardEvent){if(event.key==="Escape"){event.preventDefault();setOpen(false);if(!media||media.matches)toggle.current?.focus({preventScroll:true});}}
  function resize(){if(media&&!media.matches)setOpen(false);}
  document.addEventListener("pointerdown",outside);window.addEventListener("keydown",key);
  if(media?.addEventListener)media.addEventListener("change",resize);else media?.addListener?.(resize);
  return()=>{document.removeEventListener("pointerdown",outside);window.removeEventListener("keydown",key);if(media?.removeEventListener)media.removeEventListener("change",resize);else media?.removeListener?.(resize);};
 },[open]);
 function follow(){setOpen(false);toggle.current?.focus({preventScroll:true});}
 return <aside ref={root} className="mobile-contact-dock" aria-label={t("Message Gary Home","Nhắn tin Gary Home")} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setOpen(false);}}>
  <button ref={toggle} className="mobile-contact-toggle" type="button" aria-expanded={open} aria-controls={id} aria-label={open?t("Close contact options","Đóng lựa chọn liên hệ"):t("Open contact options","Mở lựa chọn liên hệ")} onClick={()=>setOpen(previous=>!previous)}>{open?<X size={25} aria-hidden="true"/>:<MessageCircle size={26} aria-hidden="true"/>}</button>
  <div id={id} className={`mobile-contact-panel ${!props.whatsapp||!props.zalo?"mobile-contact-panel-single":""}`} role="group" aria-label={t("Choose a messaging app","Chọn ứng dụng nhắn tin")} aria-hidden={!open} inert={!open} data-open={open}>
   <ChannelLinks {...props} compact onFollow={follow}/>
  </div>
 </aside>;
}

export function FloatingContact(){
 const {content,t,language}=useSite(),settings=content.settings;
 const whatsapp=settings.whatsapp_phone?channelUrl("whatsapp",settings.whatsapp_phone):"";
 const zalo=settings.zalo_phone?channelUrl("zalo",settings.zalo_phone):"";
 if(!whatsapp&&!zalo)return null;
 const whatsappLabel=t("Contact Gary Home on WhatsApp","Liên hệ Gary Home qua WhatsApp");
 const zaloLabel=t("Contact Gary Home on Zalo","Liên hệ Gary Home qua Zalo");
 const channels={whatsapp,zalo,whatsappLabel,zaloLabel,language};
 return <><aside className={`contact-widget contact-widget-desktop ${!whatsapp||!zalo?"contact-widget-single":""}`} aria-label={t("Message Gary Home","Nhắn tin Gary Home")}><ChannelLinks {...channels}/></aside><MobileContact {...channels}/></>;
}
