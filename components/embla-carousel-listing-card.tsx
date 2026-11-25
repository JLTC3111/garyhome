"use client";

import { useEffect, useState, type ReactNode } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ContentImage } from "./content-image";
import Link from "./localized-link";
import { useSite } from "./site-context";

const reducedMotion = "(prefers-reduced-motion: reduce)";
const reduced = () => window.matchMedia?.(reducedMotion).matches ?? false;
const breakpoints = { [reducedMotion]: { duration: 0 } };
const initialThumbs = [0, 1, 2, 3];

export function EmblaCarouselListingCard({ photos, href, title, renderPhoto, children }: {
  photos: string[];
  href: string;
  title: string;
  renderPhoto: (src: string) => ReactNode;
  children: ReactNode;
}) {
  const { t } = useSite();
  const [selected, setSelected] = useState(0);
  const [interacted, setInteracted] = useState(false);
  const [visibleThumbs, setVisibleThumbs] = useState(initialThumbs);
  const [mainRef, main] = useEmblaCarousel({ loop: true, watchFocus: false, breakpoints });
  // Give each thumbnail a snap point even when the full strip fits in the card.
  const [thumbsRef, thumbs] = useEmblaCarousel({ align: "center", containScroll: false, breakpoints });

  useEffect(() => {
    if (!main) return;
    let dragStart: number | undefined;
    const readVisibleThumbs = () => {
      const visible = thumbs?.slidesInView?.();
      if (visible?.length) setVisibleThumbs(visible);
    };
    const sync = () => {
      const index = main.selectedScrollSnap();
      setSelected(index);
      if (thumbs && thumbs.selectedScrollSnap() !== index) thumbs.scrollTo(index, reduced());
      readVisibleThumbs();
    };
    const startThumbDrag = () => { dragStart = thumbs?.selectedScrollSnap(); };
    const finishThumbDrag = () => {
      if (!thumbs || dragStart === undefined) return;
      // Embla chooses the destination before emitting pointerUp.
      const index = thumbs.selectedScrollSnap(), jump = reduced();
      const changed = index !== dragStart;
      dragStart = undefined;
      if (jump) thumbs.scrollTo(index, true);
      if (changed && main.selectedScrollSnap() !== index) main.scrollTo(index, jump);
    };
    const stopMotion = () => { if (reduced()) main.scrollTo(main.selectedScrollSnap(), true); };
    main.on("select", sync).on("reInit", sync).on("pointerUp", stopMotion);
    thumbs?.on("reInit", sync).on("slidesInView", readVisibleThumbs).on("pointerDown", startThumbDrag).on("pointerUp", finishThumbDrag);
    sync();
    return () => {
      main.off("select", sync).off("reInit", sync).off("pointerUp", stopMotion);
      thumbs?.off("reInit", sync).off("slidesInView", readVisibleThumbs).off("pointerDown", startThumbDrag).off("pointerUp", finishThumbDrag);
    };
  }, [main, thumbs]);

  const index = Math.min(selected, photos.length - 1);
  const prepare = () => setInteracted(true);
  const select = (slide: number) => { prepare(); main?.scrollTo(slide, reduced()); };

  return (
    <div className="property-image" onPointerEnter={prepare} onPointerDown={prepare} onFocus={prepare}>
      <Link href={href} prefetch={false} tabIndex={-1} aria-hidden="true" aria-label={title} draggable={false}>
        <div className="embla-listing-viewport" ref={mainRef}>
          <div className="embla-listing-track">
            {photos.map((src, i) => {
              const distance = Math.abs(i - index);
              return <div className="embla-listing-slide" key={src+i}>{i === index || interacted && (distance < 2 || distance === photos.length - 1) ? renderPhoto(src) : null}</div>;
            })}
          </div>
        </div>
      </Link>
      {children}
      <div className="rental-card-photo-nav">
        <button type="button" onClick={()=>select((index-1+photos.length)%photos.length)} aria-label={t("Previous property photo","Ảnh bất động sản trước")}><ChevronLeft size={17}/></button>
        <button type="button" onClick={()=>select((index+1)%photos.length)} aria-label={t("Next property photo","Ảnh bất động sản tiếp theo")}><ChevronRight size={17}/></button>
      </div>
      <div className="embla-listing-footer">
        <div className="embla-listing-thumbnails" ref={thumbsRef} role="group" aria-label={t("Property photos","Ảnh bất động sản")}>
          <div className="embla-listing-track">
            {photos.map((src,i)=><button key={src+i} type="button" aria-pressed={index===i}
              aria-label={t(`Photo ${i+1} of ${photos.length}`, `Ảnh ${i+1} trên ${photos.length}`)} onClick={()=>select(i)}>
              {(visibleThumbs.includes(i) || i === index) && <ContentImage src={src} alt="" width={56} height={44} loading="lazy" draggable={false}/>}
            </button>)}
          </div>
        </div>
        <span className="rental-photo-position" aria-hidden="true">{index+1} / {photos.length}</span>
      </div>
    </div>
  );
}
