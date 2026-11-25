"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useSite } from "./site-context";

const reducedMotion = "(prefers-reduced-motion: reduce)";
const narrowGallery = "(max-width: 860px)";
const visibleRailPhotos = 2;
const prefersReducedMotion = () => window.matchMedia?.(reducedMotion).matches ?? false;
const canDrag = (event: MouseEvent | TouchEvent) => (window.visualViewport?.scale ?? 1) <= 1 &&
  (!("touches" in event) || event.touches.length === 1);

type DetailGalleryProps = {
  photos: string[];
  selected: number;
  onSelect: (index: number) => void;
  renderPhoto: (photo: string, index: number) => ReactNode;
};

export function EmblaCarouselDetailGallery({ photos, selected, onSelect, renderPhoto }: DetailGalleryProps) {
  const startIndex = useRef(selected);
  const [viewport, api] = useEmblaCarousel({
    startIndex: startIndex.current,
    dragFree: true,
    watchFocus: false,
    watchDrag: (embla, event) => embla.slideNodes().length > 1 && canDrag(event),
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
    api.on("pointerDown", startDrag).on("pointerUp", finishDrag).on("settle", snapAfterDrag).on("select", select);
    return () => {
      api.off("pointerDown", startDrag).off("pointerUp", finishDrag).off("settle", snapAfterDrag).off("select", select);
    };
  }, [api, onSelect]);

  useLayoutEffect(() => {
    if (!api) return;
    const syncSelection = () => {
      if (api.selectedScrollSnap() !== selected) api.scrollTo(selected, true);
    };
    if (api.selectedScrollSnap() !== selected) api.scrollTo(selected, prefersReducedMotion());
    api.on("reInit", syncSelection);
    return () => { api.off("reInit", syncSelection); };
  }, [api, selected]);

  return <div className="embla-detail-viewport" ref={viewport}>
    <div className="embla-detail-track">
      {photos.map((photo, index) => <div className="embla-detail-slide" key={photo+index}
        aria-hidden={index!==selected}>{renderPhoto(photo, index)}</div>)}
    </div>
  </div>;
}

export function EmblaDetailPhotoRail({ photos, selected, onSelect, renderPhoto }: DetailGalleryProps) {
  const { t } = useSite();
  const viewportId = useId();
  const railPhotos = photos.slice(1);
  const lastSnap = Math.max(0, railPhotos.length - visibleRailPhotos);
  const [snap, setSnap] = useState(0);
  const firstVisible = Math.min(snap, lastSnap);
  const [viewport, api] = useEmblaCarousel({
    axis: "y",
    align: "start",
    containScroll: "trimSnaps",
    slidesToScroll: 1,
    active: lastSnap > 0,
    watchFocus: false,
    watchDrag: (_, event) => canDrag(event),
    breakpoints: { [narrowGallery]: { active: false }, [reducedMotion]: { duration: 0 } },
  });

  useEffect(() => {
    if (!api) return;
    let dragStart: number | null = null;
    const update = () => setSnap(api.selectedScrollSnap());
    const startDrag = () => { dragStart = api.selectedScrollSnap(); };
    const finishDrag = () => {
      if (dragStart === null) return;
      const target = api.selectedScrollSnap();
      const next = Math.min(dragStart + 1, Math.max(dragStart - 1, target));
      dragStart = null;
      const jump = prefersReducedMotion();
      if (target !== next || jump) api.scrollTo(next, jump);
    };
    update();
    api.on("select", update).on("reInit", update).on("pointerDown", startDrag).on("pointerUp", finishDrag);
    return () => {
      api.off("select", update).off("reInit", update).off("pointerDown", startDrag).off("pointerUp", finishDrag);
    };
  }, [api]);

  const canGoUp = !!api?.canScrollPrev();
  const canGoDown = !!api?.canScrollNext();
  function scrollByPhoto(step: -1 | 1) {
    if (api && (step < 0 ? canGoUp : canGoDown)) api.scrollTo(api.selectedScrollSnap() + step, prefersReducedMotion());
  }
  return <div className="rental-gallery-side embla-detail-rail" role="group" aria-label={t("Side photos", "Ảnh bên cạnh")}
    data-single-photo={railPhotos.length === 1 ? "" : undefined} data-draggable={lastSnap > 0 ? "" : undefined}>
    <div id={viewportId} className="embla-detail-rail-viewport" ref={viewport}>
      <div className="embla-detail-rail-track">
        {railPhotos.map((photo, railIndex) => {
          const index = railIndex + 1;
          const visible = railIndex >= firstVisible && railIndex < firstVisible + visibleRailPhotos;
          return <div className="embla-detail-rail-slide" key={photo + index} inert={!visible}>
            <button type="button" aria-pressed={selected === index}
              aria-label={t(`Show photo ${index + 1}`, `Hiển thị ảnh ${index + 1}`)}
              onClick={() => onSelect(index)}>{renderPhoto(photo, index)}</button>
          </div>;
        })}
      </div>
    </div>
    {lastSnap > 0 && <div className="embla-detail-rail-controls" onKeyDown={event => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      scrollByPhoto(event.key === "ArrowUp" ? -1 : 1);
    }}>
      <button type="button" aria-controls={viewportId} aria-disabled={!canGoUp}
        aria-label={t("Scroll side photos up", "Cuộn ảnh bên cạnh lên")}
        onClick={() => scrollByPhoto(-1)}><ChevronUp size={17} aria-hidden="true"/></button>
      <button type="button" aria-controls={viewportId} aria-disabled={!canGoDown}
        aria-label={t("Scroll side photos down", "Cuộn ảnh bên cạnh xuống")}
        onClick={() => scrollByPhoto(1)}><ChevronDown size={17} aria-hidden="true"/></button>
    </div>}
  </div>;
}
