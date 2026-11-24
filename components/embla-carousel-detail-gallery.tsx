"use client";

import { useEffect, useRef, type ReactNode } from "react";
import useEmblaCarousel from "embla-carousel-react";

const reducedMotion = "(prefers-reduced-motion: reduce)";
const prefersReducedMotion = () => window.matchMedia?.(reducedMotion).matches ?? false;

export function EmblaCarouselDetailGallery({ photos, selected, onSelect, renderPhoto }: {
  photos: string[];
  selected: number;
  onSelect: (index: number) => void;
  renderPhoto: (photo: string, index: number) => ReactNode;
}) {
  const startIndex = useRef(selected);
  const [viewport, api] = useEmblaCarousel({
    startIndex: startIndex.current,
    dragFree: true,
    watchFocus: false,
    watchDrag: (embla, event) => embla.slideNodes().length > 1 &&
      (window.visualViewport?.scale ?? 1) <= 1 &&
      (!("touches" in event) || event.touches.length === 1),
    breakpoints: { [reducedMotion]: { dragFree: false, duration: 0 } },
  });

  useEffect(() => {
    if (!api) return;
    let dragged = false;
    const startDrag = () => { dragged = true; };
    const snapAfterDrag = () => {
      if (!dragged) return;
      dragged = false;
      // Embla 8 has free momentum and snap points as separate public APIs.
      const progress = api.scrollProgress();
      const snaps = api.scrollSnapList();
      let nearest = 0;
      for (let index = 1; index < snaps.length; index++) {
        if (Math.abs(snaps[index] - progress) < Math.abs(snaps[nearest] - progress)) nearest = index;
      }
      api.scrollTo(nearest, prefersReducedMotion());
    };
    const finishDrag = () => {
      if (!prefersReducedMotion()) return;
      dragged = false;
      api.scrollTo(api.selectedScrollSnap(), true);
    };
    const select = () => onSelect(api.selectedScrollSnap());
    api.on("pointerDown", startDrag).on("pointerUp", finishDrag).on("settle", snapAfterDrag).on("select", select).on("reInit", select);
    return () => {
      api.off("pointerDown", startDrag).off("pointerUp", finishDrag).off("settle", snapAfterDrag).off("select", select).off("reInit", select);
    };
  }, [api, onSelect]);

  useEffect(() => {
    if (api && api.selectedScrollSnap() !== selected) {
      api.scrollTo(selected, prefersReducedMotion());
    }
  }, [api, selected]);

  return <div className="embla-detail-viewport" ref={viewport}>
    <div className="embla-detail-track">
      {photos.map((photo, index) => <div className="embla-detail-slide" key={photo+index}
        aria-hidden={index!==selected}>{renderPhoto(photo, index)}</div>)}
    </div>
  </div>;
}
