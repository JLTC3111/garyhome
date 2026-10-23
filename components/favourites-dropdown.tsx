"use client";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronDown, Heart, Trash2, X } from "lucide-react";
import { useSite } from "./site-context";
import { isPublicRental, listingCode, propertyTitle } from "@/lib/rentals";
import { Price } from "./property-card";
export function FavouritesDropdown({onOpen}:{onOpen?:()=>void}){
 const {t,language,saved,toggleSaved,pendingSaved,content,user,savedError}=useSite();const [open,setOpen]=useState(false),id=useId();
 const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null);
 const properties=content.properties.filter(p=>saved.includes(p.id)&&isPublicRental(p));
 function close(focus=false){setOpen(false);if(focus)trigger.current?.focus();}
 useEffect(()=>{
  if(!open)return;
  panel.current?.querySelector<HTMLElement>('button,a')?.focus();
  function key(event:KeyboardEvent){if(event.key==="Escape"){event.stopPropagation();setOpen(false);trigger.current?.focus();}}
  function outside(event:PointerEvent){if(!root.current?.contains(event.target as Node))setOpen(false);}
  window.addEventListener("keydown",key);document.addEventListener("pointerdown",outside);
  return()=>{window.removeEventListener("keydown",key);document.removeEventListener("pointerdown",outside);};
 },[open]);
 return <div className="favourites-dropdown" ref={root} onBlur={event=>{if(event.relatedTarget&&!event.currentTarget.contains(event.relatedTarget as Node))close();}}><button type="button" className="favourites-trigger" ref={trigger} aria-haspopup="dialog" aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>{if(!open)onOpen?.();setOpen(!open);}}>{user&&<Heart size={15}/>}<span>{t("My Favourites","Nhà yêu thích")}</span><strong>{saved.length}</strong><ChevronDown size={12}/></button>{open&&<div className="favourites-panel" role="dialog" aria-modal="false" aria-label={t("My favourite rentals","Nhà cho thuê yêu thích")} id={id} ref={panel}><header><h2>{t("My Favourites","Nhà yêu thích")}</h2><button type="button" className="icon-button" aria-label={t("Close favourites","Đóng danh sách yêu thích")} onClick={()=>close(true)}><X size={18}/></button></header>{savedError&&<p role="alert">{savedError}</p>}{properties.length?<ul>{properties.map(p=><li key={p.id}>{p.images[0]&&<img src={p.images[0]} alt="" width="72" height="62"/>}<div><small>{listingCode(p)}</small><Link href={`/homes/${p.slug}`} onClick={()=>close()}>{propertyTitle(p,language,content.neighbourhoods.find(n=>n.slug===p.district_slug)?.name,false)}</Link><Price property={p}/></div><button className="icon-button" type="button" disabled={pendingSaved.includes(p.id)} aria-label={t(`Remove ${listingCode(p)} from favourites`,`Bỏ ${listingCode(p)} khỏi yêu thích`)} onClick={()=>{toggleSaved(p.id);panel.current?.querySelector<HTMLElement>('header button')?.focus();}}><Trash2 size={16}/></button></li>)}</ul>:<p className="favourites-empty">{t("Save a property using its heart button. Your favourites will appear here.","Nhấn trái tim trên tin đăng để lưu. Nhà yêu thích sẽ xuất hiện tại đây.")}</p>}{saved.length>properties.length&&<p className="favourites-unavailable">{t("Some saved properties are no longer available.","Một số bất động sản đã lưu không còn được hiển thị.")}</p>}<footer><Link className="text-link" href="/saved" onClick={()=>close()}>{t("View my favourites","Xem nhà yêu thích")}<ArrowUpRight size={15}/></Link>{!user&&<Link href="/account" onClick={()=>close()}>{t("Sign in to sync","Đăng nhập để đồng bộ")}</Link>}</footer></div>}</div>;
}
