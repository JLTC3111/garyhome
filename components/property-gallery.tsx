"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type TouchEvent } from "react";
import { Camera, ChevronLeft, ChevronRight, ImageOff, X } from "lucide-react";
import { galleryPhotoMetadata, type ImageMetadata } from "@/lib/image-metadata";
import { useSite } from "./site-context";
import { EmblaCarouselDetailGallery } from "./embla-carousel-detail-gallery";

function revealActiveThumbnail(strip: HTMLDivElement, behavior: ScrollBehavior) {
  if (strip.scrollWidth <= strip.clientWidth) return false;
  const active = strip.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
  if (!active) return false;

  const thumb = active.getBoundingClientRect();
  const padding = window.getComputedStyle(strip);
  const viewportLeft = strip.getBoundingClientRect().left + strip.clientLeft;
  const start = viewportLeft + Number.parseFloat(padding.paddingLeft);
  const end = viewportLeft + strip.clientWidth - Number.parseFloat(padding.paddingRight);
  const delta = thumb.left < start ? thumb.left - start : Math.max(0, thumb.right - end);
  if (Math.abs(delta) < 1) return false;
  strip.scrollBy({ left: delta, behavior });
  return true;
}

export function PropertyGallery({images,title,metadata,variant="property",renderOpeners}:{
  images:string[];title:string;metadata?:ImageMetadata;variant?:"property"|"feedback";
  renderOpeners?: (showPhoto: (index: number, opener?: HTMLElement) => void) => ReactNode;
}) {
  const feedback=variant==="feedback";
  const insideEditor=!!renderOpeners;
  const carousel=!feedback&&!insideEditor;
  const [coverPhoto,setCoverPhoto]=useState(0);
  const {t,language}=useSite();const [photo,setPhoto]=useState(0),[open,setOpen]=useState(false),[failed,setFailed]=useState<string[]>([]);
  const dialog=useRef<HTMLDialogElement>(null),restoreFocus=useRef<HTMLElement|null>(null);
  const thumbnails=useRef<HTMLDivElement>(null);
  const touch=useRef<{id:number;x:number;y:number}|null>(null);
  const hasImages=images.length>0;
  // Close before committing an empty collection, including a live CMS update.
  if(open&&!hasImages)setOpen(false);
  const index=Math.min(Math.max(0,photo),Math.max(0,images.length-1));const source=images[index];
  const coverIndex=Math.min(coverPhoto,Math.max(0,images.length-1));
  const photoInfo = (src: string, position: number) => feedback ? null :
    galleryPhotoMetadata(src, metadata, language, t(`Photo ${position+1} of ${images.length}`, `Ảnh ${position+1} trên ${images.length}`));
  const info = source ? photoInfo(source, index) : null;
  function move(step:number){setPhoto(current=>(Math.min(current,Math.max(0,images.length-1))+step+Math.max(images.length,1))%Math.max(images.length,1));}
  function close(){
    touch.current=null;
    const node=dialog.current;
    if(node?.close)node.close();
    else node?.removeAttribute("open");
    setOpen(false);
    restoreFocus.current?.focus({preventScroll:true});
  }
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
  function show(i:number,opener?:HTMLElement){const node=dialog.current;if(!node)return;restoreFocus.current=opener??(document.activeElement instanceof HTMLElement?document.activeElement:null);setPhoto(i);try{if(!node.open){if(node.showModal)node.showModal();else node.setAttribute("open","");}setOpen(true);}catch{/* A detached dialog cannot be opened. Keep the inline gallery available. */}}
  useEffect(()=>{
    if(!open||!dialog.current)return;
    const node=dialog.current;
    // The editor owns the page scroll lock while its preview is on top.
    const overflow=insideEditor?null:document.body.style.overflow;
    if(overflow!==null)document.body.style.overflow="hidden";
    return()=>{if(overflow!==null)document.body.style.overflow=overflow;if(node.open)node.close?.();};
  },[open,hasImages,insideEditor]);
  useLayoutEffect(() => {
    const strip = thumbnails.current;
    if (!open || !strip) return;
    revealActiveThumbnail(strip, "auto");
    if (!window.ResizeObserver) return;

    let width = strip.clientWidth;
    const observer = new window.ResizeObserver(() => {
      if (strip.clientWidth === width) return;
      width = strip.clientWidth;
      revealActiveThumbnail(strip, "auto");
    });
    observer.observe(strip);
    return () => observer.disconnect();
  }, [open, feedback]);
  useLayoutEffect(() => {
    const strip = thumbnails.current;
    if (!open || !strip) return;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const moved = revealActiveThumbnail(strip, reducedMotion ? "auto" : "smooth");
    // Cancel a pending smooth scroll if the selection changes before it ends.
    if (moved && !reducedMotion) return () => strip.scrollTo({ left: strip.scrollLeft, behavior: "auto" });
  }, [open, feedback, index, source, images.length]);
  function picture(src:string,alt:string,priority=false){return failed.includes(src)?<div className="photo-unavailable"><ImageOff size={28}/><span>{t("This photo is unavailable.","Ảnh này hiện chưa xem được.")}</span></div>:<img src={src} alt={alt} width={feedback?900:1200} height={feedback?1600:800} loading={priority?"eager":"lazy"} fetchPriority={priority?"high":"auto"} onError={()=>setFailed(previous=>[...new Set([...previous,src])])}/>;}
  if(!hasImages)return renderOpeners ? renderOpeners(show) : <div className="rental-gallery-empty"><ImageOff size={35}/>{t("Ask the team for property photographs.","Liên hệ đội ngũ để nhận ảnh bất động sản.")}</div>;
  const lightbox = <dialog ref={dialog} className="rental-lightbox" data-photo-caption={info ? "" : undefined} aria-label={insideEditor?t("Photo preview","Xem trước ảnh"):feedback?t("Feedback photo gallery","Thư viện ảnh phản hồi"):t("Property photo gallery","Thư viện ảnh bất động sản")} aria-modal="true" onCancel={event=>{event.preventDefault();if(insideEditor)event.stopPropagation();close();}} onClose={()=>setOpen(false)} onClick={event=>{if(event.target===event.currentTarget)close();}} onKeyDown={event=>{
      if(insideEditor)event.stopPropagation();
      if(event.key==="ArrowRight"){event.preventDefault();move(1);}if(event.key==="ArrowLeft"){event.preventDefault();move(-1);}if(event.key==="Escape"){event.preventDefault();close();}
      if(event.key==="Tab"){const nodes=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]'));const first=nodes[0],last=nodes[nodes.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
    }}>
      {(!insideEditor || open) && <><div className="rental-lightbox-top"><span>{index+1} / {images.length}</span><p>{title}</p><button autoFocus type="button" className="icon-button" onClick={close} aria-label={insideEditor?t("Close preview","Đóng xem trước"):t("Close gallery","Đóng thư viện ảnh")}><X/></button></div>
      <div className="rental-lightbox-stage" onTouchStart={insideEditor?touchStart:undefined} onTouchEnd={insideEditor?touchEnd:undefined} onTouchCancel={()=>{touch.current=null;}}>
        <button className="icon-button" type="button" aria-label={t("Previous photo","Ảnh trước")} onClick={()=>move(-1)} disabled={images.length<2}><ChevronLeft/></button>
        {carousel ? open&&<EmblaCarouselDetailGallery photos={images} selected={index} onSelect={setPhoto}
          renderPhoto={(src,i)=>picture(src,photoInfo(src,i)?.alt||`${title} · ${i+1}`,i===index)}/>
          : source&&picture(source,info?.alt||`${title} · ${index+1}`,true)}
        <button className="icon-button" type="button" aria-label={t("Next photo","Ảnh tiếp theo")} onClick={()=>move(1)} disabled={images.length<2}><ChevronRight/></button>
      </div>
      {info&&<div className="rental-lightbox-caption" role="status" aria-live="polite" aria-atomic="true" tabIndex={0}>
        <p>{info.caption}</p>
        {info.filename&&<small>{t("Original filename", "Tên tệp gốc")} · {info.filename}</small>}
      </div>}
      <div ref={feedback?undefined:thumbnails} className="rental-lightbox-thumbs">{images.map((src,i)=><button key={src+i} type="button" aria-pressed={index===i} aria-label={t(`Photo ${i+1}`,`Ảnh ${i+1}`)} onClick={()=>setPhoto(i)}>{picture(src,"")}</button>)}</div></>}
    </dialog>;
  if(renderOpeners)return <>{renderOpeners(show)}{lightbox}</>;
  return <div className={feedback?"rental-gallery rental-gallery-feedback":"rental-gallery"}>
    <div className="rental-gallery-grid" data-single-photo={carousel&&images.length===1?true:undefined}>
      {carousel?<EmblaCarouselDetailGallery photos={images} selected={coverIndex} onSelect={setCoverPhoto} renderPhoto={(src,i)=>
        <button type="button" className="rental-gallery-cover" tabIndex={i===coverIndex?0:-1}
          aria-label={t("Open property gallery","Mở thư viện ảnh")} onClick={()=>show(i)} onKeyDown={event=>{
            if(images.length<2||(event.key!=="ArrowLeft"&&event.key!=="ArrowRight"))return;
            event.preventDefault();
            const step=event.key==="ArrowRight"?1:-1;
            const next=(i+step+images.length)%images.length;
            const track=event.currentTarget.closest(".embla-detail-track");
            setCoverPhoto(next);
            track?.querySelectorAll<HTMLButtonElement>(".rental-gallery-cover")[next]?.focus({preventScroll:true});
          }}>{picture(src,photoInfo(src,i)?.alt||title,i===0)}</button>}/>
        : <button type="button" className="rental-gallery-cover" onClick={()=>show(0)} aria-label={t("Open feedback photos","Mở ảnh phản hồi")}>{picture(images[0],title,true)}</button>}
      <div className="rental-gallery-side">{images.slice(1,3).map((src,i)=><button key={src+i} type="button" onClick={()=>show(i+1)} aria-label={t(`View photo ${i+2}`,`Xem ảnh ${i+2}`)}>{picture(src,photoInfo(src,i+1)?.alt||`${title} · ${i+2}`)}</button>)}</div>
      <button className="button rental-gallery-count" type="button" onClick={()=>show(coverIndex)}><Camera size={17}/>{t("View all photos","Xem tất cả ảnh")} · {images.length}</button>
    </div>
    <div className="rental-inline-thumbs" aria-label={feedback?t("Feedback photos","Ảnh phản hồi"):t("Property photos","Ảnh bất động sản")}>{images.map((src,i)=><button key={src+i} type="button" onClick={()=>show(i)} aria-label={t(`Open photo ${i+1}`,`Mở ảnh ${i+1}`)}>{picture(src,"")}</button>)}</div>
    {lightbox}
  </div>;
}
