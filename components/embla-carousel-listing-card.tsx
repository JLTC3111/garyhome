"use client";

import { useEffect, useState, type ReactNode } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ContentImage } from "./content-image";
import Link from "./localized-link";
import { useSite } from "./site-context";

const reducedMotion = "(prefers-reduced-motion: reduce)";
const reduced = () => window.matchMedia?.(reducedMotion).matches ?? false;
const breakpoints = { [reducedMotion]: { duration: 0, dragFree: false } };

export function EmblaCarouselListingCard({ photos, href, title, renderPhoto, children }: {
  photos: string[];
  href: string;
  title: string;
  renderPhoto: (src: string) => ReactNode;
  children: ReactNode;
}) {
  const { t } = useSite();
  const [selected, setSelected] = useState(0);
  const [mainRef, main] = useEmblaCarousel({ loop: true, watchFocus: false, breakpoints });
  const [thumbsRef, thumbs] = useEmblaCarousel({ containScroll: "keepSnaps", dragFree: true, breakpoints });

  useEffect(() => {
    if (!main) return;
    const sync = () => {
      const index = main.selectedScrollSnap();
      setSelected(index);
      thumbs?.scrollTo(index, reduced());
    };
    const stopMotion = () => { if (reduced()) main.scrollTo(main.selectedScrollSnap(), true); };
    const stopThumbMotion = () => { if (thumbs && reduced()) thumbs.scrollTo(thumbs.selectedScrollSnap(), true); };
    main.on("select", sync).on("reInit", sync).on("pointerUp", stopMotion);
    thumbs?.on("reInit", sync).on("pointerUp", stopThumbMotion);
    sync();
    return () => {
      main.off("select", sync).off("reInit", sync).off("pointerUp", stopMotion);
      thumbs?.off("reInit", sync).off("pointerUp", stopThumbMotion);
    };
  }, [main, thumbs]);

  const index = Math.min(selected, photos.length - 1);
  const select = (slide: number) => main?.scrollTo(slide, reduced());

  return <>
    <div className="property-image">
      <Link href={href} tabIndex={-1} aria-hidden="true" aria-label={title}>
        <div className="embla-listing-viewport" ref={mainRef}>
          <div className="embla-listing-track">
            {photos.map((src, i) => <div className="embla-listing-slide" key={src+i}>{renderPhoto(src)}</div>)}
          </div>
        </div>
      </Link>
      {children}
      <div className="rental-card-photo-nav">
        <button type="button" onClick={()=>select((index-1+photos.length)%photos.length)} aria-label={t("Previous property photo","Ảnh bất động sản trước")}><ChevronLeft size={17}/></button>
        <button type="button" onClick={()=>select((index+1)%photos.length)} aria-label={t("Next property photo","Ảnh bất động sản tiếp theo")}><ChevronRight size={17}/></button>
      </div>
      <span className="rental-photo-position" aria-hidden="true">{index+1} / {photos.length}</span>
    </div>
    <div className="embla-listing-thumbnails" ref={thumbsRef} role="group" aria-label={t("Property photos","Ảnh bất động sản")}>
      <div className="embla-listing-track">
        {photos.map((src,i)=><button key={src+i} type="button" aria-pressed={index===i}
          aria-label={t(`Photo ${i+1} of ${photos.length}`, `Ảnh ${i+1} trên ${photos.length}`)} onClick={()=>select(i)}>
          <ContentImage src={src} alt="" width={96} height={64} sizes="56px" loading="lazy"/>
        </button>)}
      </div>
    </div>
  </>;
}
