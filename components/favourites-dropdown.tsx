"use client";
import { useEffect, useId, useRef, useState } from "react";
import Link from "./localized-link";
import { ArrowUpRight, ChevronDown, Heart, Trash2, X } from "lucide-react";
import { useSite } from "./site-context";
import { isPublicRental, listingCode, propertyTitle } from "@/lib/rentals";
import { Price } from "./property-card";
import { readSavedPublicProperties } from "@/lib/public-content";
import { request } from "@/lib/requests";
import type { Property } from "@/lib/types";
export function FavouritesDropdown({onOpen}:{onOpen?:()=>void}){
 const {t,language,saved,toggleSaved,pendingSaved,content,user,savedError,publicClient}=useSite();const [open,setOpen]=useState(false),id=useId();
 const [savedRows,setSavedRows]=useState<Property[]>([]);
 const [lookup,setLookup]=useState<"idle"|"loading"|"failed">("idle");
 const root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null);
 const publishedHere=new Map(content.properties.map(row=>[row.id,row]));
 const properties=[...new Map([...savedRows,...publishedHere.values()].map(row=>[row.id,row])).values()]
  .filter(p=>saved.includes(p.id)&&isPublicRental(p));
 const ids=saved.join(",");
 useEffect(()=>{
  if(!open||!publicClient||!ids)return;
  const controller=new AbortController();
  queueMicrotask(()=>{
   if(controller.signal.aborted)return;
   setLookup("loading");setSavedRows([]);
   void request(signal=>readSavedPublicProperties(publicClient,ids.split(","),AbortSignal.any([signal,controller.signal])))
     .then(rows=>{if(!controller.signal.aborted){setSavedRows(rows);setLookup("idle");}})
     .catch(()=>{if(!controller.signal.aborted)setLookup("failed");});
  });
  return()=>controller.abort();
 },[open,ids,publicClient]);
 function close(focus=false){setOpen(false);if(focus)trigger.current?.focus();}
 useEffect(()=>{
  if(!open)return;
  panel.current?.querySelector<HTMLElement>('button,a')?.focus();
  function key(event:KeyboardEvent){if(event.key==="Escape"){event.stopPropagation();setOpen(false);trigger.current?.focus();}}
  function outside(event:PointerEvent){if(!root.current?.contains(event.target as Node))setOpen(false);}
  window.addEventListener("keydown",key);document.addEventListener("pointerdown",outside);
  return()=>{window.removeEventListener("keydown",key);document.removeEventListener("pointerdown",outside);};
 },[open]);
 return <div className="favourites-dropdown" ref={root} onBlur={event=>{if(event.relatedTarget&&!event.currentTarget.contains(event.relatedTarget as Node))close();}}><button type="button" className="favourites-trigger" ref={trigger} aria-haspopup="dialog" aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>{if(!open)onOpen?.();setOpen(!open);}}>{user&&<Heart size={15}/>}<span>{t("My Favourites","Nhà yêu thích")}</span><strong>{saved.length}</strong><ChevronDown size={12}/></button><div hidden={!open} inert={!open} className="favourites-panel" role={open ? "dialog" : undefined} aria-modal={open ? false : undefined} aria-label={t("My favourite rentals","Nhà cho thuê yêu thích")} id={id} ref={panel}><header><h2>{t("My Favourites","Nhà yêu thích")}</h2><button type="button" className="icon-button" aria-label={t("Close favourites","Đóng danh sách yêu thích")} onClick={()=>close(true)}><X size={18}/></button></header>{savedError&&<p role="alert">{savedError}</p>}{lookup==="loading"&&<p role="status">{t("Loading saved homes…","Đang tải nhà đã lưu…")}</p>}{lookup==="failed"&&<p role="alert">{t("Couldn’t load all saved homes. Try reopening this list.","Không tải được toàn bộ nhà đã lưu. Hãy thử mở lại danh sách.")}</p>}{properties.length?<ul>{properties.map(p=><li key={p.id}>{p.images[0]&&<img src={p.images[0]} alt="" width="72" height="62"/>}<div><small>{listingCode(p)}</small><Link href={`/homes/${p.slug}`} onClick={()=>close()}>{propertyTitle(p,language,content.neighbourhoods.find(n=>n.slug===p.district_slug)?.name,false)}</Link><Price property={p}/></div><button className="icon-button" type="button" disabled={pendingSaved.includes(p.id)} aria-label={t(`Remove ${listingCode(p)} from favourites`,`Bỏ ${listingCode(p)} khỏi yêu thích`)} onClick={()=>{toggleSaved(p.id);panel.current?.querySelector<HTMLElement>('header button')?.focus();}}><Trash2 size={16}/></button></li>)}</ul>:<p className="favourites-empty">{t("Save a property using its heart button. Your favourites will appear here.","Nhấn trái tim trên tin đăng để lưu. Nhà yêu thích sẽ xuất hiện tại đây.")}</p>}{lookup==="idle"&&saved.length>properties.length&&<p className="favourites-unavailable">{t("Some saved properties are no longer available.","Một số bất động sản đã lưu không còn được hiển thị.")}</p>}<footer><Link className="text-link" href="/saved" onClick={()=>close()}>{t("View my favourites","Xem nhà yêu thích")}<ArrowUpRight size={15}/></Link>{!user&&<Link href="/account" onClick={()=>close()}>{t("Sign in to sync","Đăng nhập để đồng bộ")}</Link>}</footer></div></div>;
}
