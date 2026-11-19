"use client";

import { useEffect, useRef, useState, type TouchEvent } from "react";
import { Camera, ChevronLeft, ChevronRight, ImageOff, X } from "lucide-react";
import { galleryPhotoMetadata, type ImageMetadata } from "@/lib/image-metadata";
import { useSite } from "./site-context";

export function PropertyGallery({images,title,metadata,variant="property"}:{images:string[];title:string;metadata?:ImageMetadata;variant?:"property"|"feedback"}) {
  const feedback=variant==="feedback";
  const {t,language}=useSite();const [photo,setPhoto]=useState(0),[open,setOpen]=useState(false),[failed,setFailed]=useState<string[]>([]);
  const dialog=useRef<HTMLDialogElement>(null),restoreFocus=useRef<HTMLElement|null>(null);
  const touch=useRef<{id:number;x:number;y:number}|null>(null);
  const hasImages=images.length>0;
  // Close before committing an empty collection, including a live CMS update.
  if(open&&!hasImages)setOpen(false);
  const index=Math.min(Math.max(0,photo),Math.max(0,images.length-1));const source=images[index];
  const info = !feedback && source ? galleryPhotoMetadata(source,metadata,language,t(`Photo ${index+1} of ${images.length}`,`Ảnh ${index+1} trên ${images.length}`)) : null;
  function move(step:number){setPhoto(current=>(Math.min(current,Math.max(0,images.length-1))+step+Math.max(images.length,1))%Math.max(images.length,1));}
  function close(){touch.current=null;dialog.current?.close();setOpen(false);restoreFocus.current?.focus();}
  function touchStart(event:TouchEvent<HTMLDivElement>){
    touch.current=null;
    if (event.touches.length!==1 || images.length<2 || (event.target as Element).closest("button") || (window.visualViewport?.scale ?? 1)>1) return;
    const point=event.touches[0];
    touch.current={id:point.identifier,x:point.clientX,y:point.clientY};
  }
  function touchEnd(event:TouchEvent<HTMLDivElement>){
    const start=touch.current;
    touch.current=null;
    if(!start || event.touches.length || (window.visualViewport?.scale ?? 1)>1)return;
    const point=Array.from(event.changedTouches).find(value=>value.identifier===start.id);
    if(!point)return;
    const dx=point.clientX-start.x,dy=point.clientY-start.y;
    if(Math.abs(dx)>=48 && Math.abs(dx)>Math.abs(dy)*1.4)move(dx<0?1:-1);
  }
  function show(i:number){const node=dialog.current;if(!node)return;restoreFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setPhoto(i);try{if(!node.open){if(node.showModal)node.showModal();else node.setAttribute("open","");}setOpen(true);}catch{/* A detached dialog cannot be opened. Keep the inline gallery available. */}}
  useEffect(()=>{
    if(!open||!dialog.current)return;
    const node=dialog.current,overflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    return()=>{document.body.style.overflow=overflow;if(node.open)node.close?.();};
  },[open,hasImages]);
  function picture(src:string,alt:string,priority=false){return failed.includes(src)?<div className="photo-unavailable"><ImageOff size={28}/><span>{t("This photo is unavailable.","Ảnh này hiện chưa xem được.")}</span></div>:<img src={src} alt={alt} width={feedback?900:1200} height={feedback?1600:800} loading={priority?"eager":"lazy"} fetchPriority={priority?"high":"auto"} onError={()=>setFailed(previous=>[...new Set([...previous,src])])}/>;}
  if(!images.length)return <div className="rental-gallery-empty"><ImageOff size={35}/>{t("Ask the team for property photographs.","Liên hệ đội ngũ để nhận ảnh bất động sản.")}</div>;
  return <div className={feedback?"rental-gallery rental-gallery-feedback":"rental-gallery"}>
    <div className="rental-gallery-grid"><button type="button" className="rental-gallery-cover" onClick={()=>show(0)} aria-label={feedback?t("Open feedback photos","Mở ảnh phản hồi"):t("Open property gallery","Mở thư viện ảnh")}>{picture(images[0],title,true)}</button><div className="rental-gallery-side">{images.slice(1,3).map((src,i)=><button key={src+i} type="button" onClick={()=>show(i+1)} aria-label={t(`View photo ${i+2}`,`Xem ảnh ${i+2}`)}>{picture(src,`${title} · ${i+2}`)}</button>)}</div><button className="button rental-gallery-count" type="button" onClick={()=>show(0)}><Camera size={17}/>{t("View all photos","Xem tất cả ảnh")} · {images.length}</button></div>
    <div className="rental-inline-thumbs" aria-label={feedback?t("Feedback photos","Ảnh phản hồi"):t("Property photos","Ảnh bất động sản")}>{images.map((src,i)=><button key={src+i} type="button" onClick={()=>show(i)} aria-label={t(`Open photo ${i+1}`,`Mở ảnh ${i+1}`)}>{picture(src,"")}</button>)}</div>
    <dialog ref={dialog} className="rental-lightbox" data-photo-caption={info ? "" : undefined} aria-label={feedback?t("Feedback photo gallery","Thư viện ảnh phản hồi"):t("Property photo gallery","Thư viện ảnh bất động sản")} aria-modal="true" onCancel={event=>{event.preventDefault();close();}} onClose={()=>setOpen(false)} onClick={event=>{if(event.target===event.currentTarget)close();}} onKeyDown={event=>{
      if(event.key==="ArrowRight"){event.preventDefault();move(1);}if(event.key==="ArrowLeft"){event.preventDefault();move(-1);}if(event.key==="Escape"){event.preventDefault();close();}
      if(event.key==="Tab"){const nodes=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]'));const first=nodes[0],last=nodes[nodes.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
    }}>
      <div className="rental-lightbox-top"><span>{index+1} / {images.length}</span><p>{title}</p><button autoFocus type="button" className="icon-button" onClick={close} aria-label={t("Close gallery","Đóng thư viện ảnh")}><X/></button></div>
      <div className="rental-lightbox-stage" onTouchStart={feedback?undefined:touchStart} onTouchEnd={feedback?undefined:touchEnd} onTouchCancel={()=>{touch.current=null;}}><button className="icon-button" type="button" aria-label={t("Previous photo","Ảnh trước")} onClick={()=>move(-1)} disabled={images.length<2}><ChevronLeft/></button>{source&&picture(source,info?.alt||`${title} · ${index+1}`,true)}<button className="icon-button" type="button" aria-label={t("Next photo","Ảnh tiếp theo")} onClick={()=>move(1)} disabled={images.length<2}><ChevronRight/></button></div>
      {info&&<div className="rental-lightbox-caption" role="status" aria-live="polite" aria-atomic="true" tabIndex={0}>
        <p>{info.caption}</p>
        {info.filename&&<small>{t("Original filename", "Tên tệp gốc")} · {info.filename}</small>}
      </div>}
      <div className="rental-lightbox-thumbs">{images.map((src,i)=><button key={src+i} type="button" aria-pressed={index===i} aria-label={t(`Photo ${i+1}`,`Ảnh ${i+1}`)} onClick={()=>setPhoto(i)}>{picture(src,"")}</button>)}</div>
    </dialog>
  </div>;
}
