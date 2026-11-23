"use client";

import { Eye, GripVertical, Star, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { imageFilenameDetails, type ImageFilenames } from "@/lib/image-filenames";
import { photoMetadata, PHOTO_TEXT_LIMIT, publicPhotoFilename, type ImageMetadata, type PhotoMetadata } from "@/lib/image-metadata";
import { propertyPhotoPath } from "@/lib/property-photo-files";
import { PropertyGallery } from "./property-gallery";
import { PropertyPhotoRenameForm, PropertyPhotoRenameTools, type PhotoRenameControls } from "./property-photo-rename";
import { useSite } from "./site-context";
import { useStudioText } from "./use-studio-text";

export type PhotoCardBox = { index: number; left: number; top: number; right: number; bottom: number };

// The destination is the photo card under the pointer, including a card on another row.
// A pointer in the gap between two rows prefers the later card when both are equally close.
export function nearestPhotoIndex(pointer: { x: number; y: number }, cards: readonly PhotoCardBox[], from: number): number | null {
  let bestIndex = -1;
  let bestScore = Infinity;
  for (const card of cards) {
    if (!Number.isInteger(card.index)) continue;
    const dx = pointer.x < card.left ? card.left - pointer.x : pointer.x > card.right ? pointer.x - card.right : 0;
    const dy = pointer.y < card.top ? card.top - pointer.y : pointer.y > card.bottom ? pointer.y - card.bottom : 0;
    const centerX = (card.left + card.right) / 2;
    const centerY = (card.top + card.bottom) / 2;
    const score = (dx * dx + dy * dy) * 1_000_000 + (pointer.x - centerX) ** 2 + (pointer.y - centerY) ** 2;
    if (score < bestScore || (score === bestScore && card.index > bestIndex)) {
      bestScore = score;
      bestIndex = card.index;
    }
  }
  return bestIndex < 0 || bestIndex === from ? null : bestIndex;
}

export function PropertyPhotoGrid({ images, title, filenames, metadata, onMetadataChange, makeCover, move, remove, rename, disabled = false }: {
  images: string[]; title?: string; filenames?: ImageFilenames; makeCover: (index: number) => void;
  metadata?: ImageMetadata; onMetadataChange?: (src: string, patch: PhotoMetadata) => void;
  move?: (from: number, to: number) => void;
  rename?: PhotoRenameControls;
  remove: (index: number) => void; disabled?: boolean;
}) {
  const text = useStudioText();
  const { t } = useSite();
  const [selectedSrc, setSelectedSrc] = useState<string | undefined>(() => images[0]);
  const [renameSrc,setRenameSrc] = useState<string>();
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [orderMessage, setOrderMessage] = useState("");
  const panelId = useId(), panel = useRef<HTMLElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const focusAfterMove = useRef<{ index: number; src: string; control: "preview" | "reorder" } | null>(null);
  const dropIndexRef = useRef<number | null>(null);
  const session = useRef<{ pointerId: number; from: number; key: string; x: number; y: number; dragging: boolean } | null>(null);
  const occurrences = new Map<string, number>();
  const namedPhotos = images.map(src => {
    const occurrence = (occurrences.get(src) ?? 0) + 1;
    occurrences.set(src, occurrence);
    return { key: `${occurrence}:${src}`, src, ...imageFilenameDetails(src, filenames), storageName: propertyPhotoPath(src)?.split("/").at(-1) };
  });
  const selectedIndex = selectedSrc ? Math.max(0, images.indexOf(selectedSrc)) : 0;
  const selected = namedPhotos[selectedIndex];
  const entry = selected ? photoMetadata(selected.src, metadata) : {};
  const original = selected?.source === "original" ? publicPhotoFilename(selected.filename) : "";
  const filenameLabel = (source: string) => text(source === "original" ? "Original filename" : source === "stored" ? "Stored filename" : "Filename");
  const storageLabel = t("Current Storage filename", "Tên tệp lưu trữ hiện tại");
  const originalLabel = t("Original upload filename", "Tên tệp khi tải lên");
  const coverHint = t("Set as cover (move to first position)", "Đặt làm ảnh bìa (chuyển lên vị trí đầu tiên)");
  const reorderHelp = t("Drag or use the Up and Down arrow keys to reorder. Position 1 is the cover photo.", "Kéo hoặc dùng phím mũi tên Lên và Xuống để sắp xếp. Vị trí 1 là ảnh bìa.");
  const canReorder = !!move && images.length > 2;

  useLayoutEffect(() => {
    const target = focusAfterMove.current;
    focusAfterMove.current = null;
    if (!target || images[target.index] !== target.src) return;
    grid.current?.querySelector<HTMLButtonElement>(`[data-photo-index="${target.index}"] [data-photo-control="${target.control}"]`)?.focus({preventScroll:true});
  }, [images]);

  useEffect(() => {
    if (!draggingKey || typeof document === "undefined") return;
    const block = (event: Event) => event.preventDefault();
    const body = document.body;
    const previousUserSelect = body?.style?.userSelect;
    if (body?.style) body.style.userSelect = "none";
    if (body?.dataset) body.dataset.photoReordering = "true";
    window.addEventListener("wheel", block, { passive: false, capture: true });
    window.addEventListener("touchmove", block, { passive: false, capture: true });
    return () => {
      if (body?.style) body.style.userSelect = previousUserSelect ?? "";
      if (body?.dataset) delete body.dataset.photoReordering;
      window.removeEventListener("wheel", block, { capture: true });
      window.removeEventListener("touchmove", block, { capture: true });
    };
  }, [draggingKey]);

  function reorder(from: number, to: number, keepFocus = false) {
    if (!move || disabled || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= images.length || to >= images.length || from === to) return;
    if (keepFocus) focusAfterMove.current = { index: to, src: images[from], control: "reorder" };
    move(from, to);
    const moved = t(`Photo moved to position ${to + 1} of ${images.length}.`, `Đã chuyển ảnh đến vị trí ${to + 1} trên ${images.length}.`);
    const cover = to === 0
      ? t(" It is now the cover photo.", " Đây hiện là ảnh bìa.")
      : from === 0
        ? t(" Position 1 is now the cover photo.", " Vị trí 1 hiện là ảnh bìa.")
        : "";
    setOrderMessage(moved + cover);
  }

  function cardBoxes(): PhotoCardBox[] {
    const nodes = grid.current?.querySelectorAll<HTMLElement>("[data-photo-index]");
    if (!nodes) return [];
    return Array.from(nodes, node => {
      const rect = node.getBoundingClientRect();
      return { index: Number(node.dataset.photoIndex), left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    }).filter(card => Number.isInteger(card.index));
  }

  function nudgeEditorScroll(clientY: number) {
    const node = grid.current;
    if (!node || typeof node.closest !== "function") return;
    const scroller = node.closest(".editor-scroll-body");
    if (!scroller || !("scrollTop" in scroller) || typeof scroller.getBoundingClientRect !== "function") return;
    const bounds = scroller.getBoundingClientRect();
    const edge = 56;
    const scrollable = scroller as HTMLElement;
    if (clientY < bounds.top + edge) scrollable.scrollTop -= 14;
    else if (clientY > bounds.bottom - edge) scrollable.scrollTop += 14;
  }

  function startReorder(event: ReactPointerEvent<HTMLButtonElement>, index: number, key: string) {
    if (disabled || !move || event.button !== 0 || session.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    session.current = { pointerId: event.pointerId, from: index, key, x: event.clientX, y: event.clientY, dragging: false };
  }

  function moveReorder(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = session.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (!current.dragging) {
      if (dx * dx + dy * dy < 16) return;
      current.dragging = true;
      setDraggingKey(current.key);
    }
    event.preventDefault();
    event.stopPropagation();
    nudgeEditorScroll(event.clientY);
    const to = nearestPhotoIndex({ x: event.clientX, y: event.clientY }, cardBoxes(), current.from);
    if (dropIndexRef.current === to) return;
    dropIndexRef.current = to;
    setDropIndex(to);
    if (to !== null) setOrderMessage(t(`Moving photo. Release to place it at position ${to + 1} of ${images.length}.`, `Đang di chuyển ảnh. Thả để đặt vào vị trí ${to + 1} trên ${images.length}.`));
  }

  function finishReorder(event: ReactPointerEvent<HTMLButtonElement>, commit: boolean) {
    const current = session.current;
    if (!current || current.pointerId !== event.pointerId) return;
    session.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const to = commit && current.dragging ? dropIndexRef.current : null;
    dropIndexRef.current = null;
    setDraggingKey(null);
    setDropIndex(null);
    if (to !== null) reorder(current.from, to, true);
    else if (current.dragging) setOrderMessage(t("Reorder cancelled.", "Đã hủy sắp xếp."));
  }

  function selectPhoto(src: string) {
    setSelectedSrc(src);
    panel.current?.focus();
  }

  return <PropertyGallery images={images} metadata={metadata} title={title || t("Listing photos", "Ảnh tin đăng")} renderOpeners={showPhoto => <>
  <div ref={grid} className="editor-photo-grid" data-photo-reordering={draggingKey ? "true" : undefined}>{namedPhotos.map(({ key, src, filename, source, storageName }, index) => {
    const reorderable = canReorder;
    const photo = <img src={src} alt={onMetadataChange ? "" : text("Property photo {number}", { number: index + 1 })}/>;
    return <figure className="editor-photo-card" key={key} data-photo-index={index}
      data-photo-selected={onMetadataChange && selectedIndex === index ? "true" : undefined}
      data-photo-dragging={draggingKey === key ? "true" : undefined}
      data-photo-drop-target={dropIndex === index ? "true" : undefined}>
      <div className="editor-photo-preview">
        {onMetadataChange ? <button type="button" className="editor-photo-select" disabled={disabled} aria-controls={panelId}
          aria-pressed={selectedIndex === index} aria-label={t(`Edit photo ${index + 1}`, `Chỉnh sửa ảnh ${index + 1}`)}
          onClick={() => selectPhoto(src)}>{photo}</button> : photo}
        {dropIndex === index && <span className="editor-photo-drop-indicator" data-photo-drop-indicator="true" aria-hidden="true"/>}
        <span className="editor-photo-order">{index === 0 ? text("COVER") : index + 1}</span>
      </div>
      <div className="editor-photo-actions">
        <button type="button" data-button-variant="view" data-button-size="icon" data-photo-control="preview"
          disabled={disabled} aria-haspopup="dialog" aria-label={t(`Preview photo ${index + 1}`, `Xem trước ảnh ${index + 1}`)}
          title={t("Preview photo", "Xem trước ảnh")} onClick={event => showPhoto(index, event.currentTarget)}><Eye size={16} aria-hidden="true"/></button>
        {index > 0 && <button type="button" data-button-variant="feature" data-button-size="icon" disabled={disabled}
          aria-label={t(`Set photo ${index + 1} as cover (move to first position)`, `Đặt ảnh ${index + 1} làm ảnh bìa (chuyển lên vị trí đầu tiên)`)}
          title={coverHint} onClick={() => {
            focusAfterMove.current = { index: 0, src, control: "preview" };
            setSelectedSrc(selected?.src);
            makeCover(index);
            setOrderMessage(t("Cover photo moved to first position.", "Đã chuyển ảnh bìa lên vị trí đầu tiên."));
          }}><Star size={16} aria-hidden="true"/></button>}
        {reorderable && <button type="button" data-button-variant="reorder" data-button-size="icon" data-photo-control="reorder"
          disabled={disabled} draggable={false} aria-label={t(`Reorder photo ${index + 1}`, `Sắp xếp ảnh ${index + 1}`)}
          aria-describedby={`${panelId}-order-help`} aria-keyshortcuts="ArrowUp ArrowDown"
          title={reorderHelp} style={{ touchAction: "none", userSelect: "none", WebkitUserSelect: "none" }}
          onKeyDown={event => {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            event.preventDefault();
            event.stopPropagation?.();
            reorder(index, index + (event.key === "ArrowUp" ? -1 : 1), true);
          }}
          onPointerDown={event => startReorder(event, index, key)}
          onPointerMove={moveReorder}
          onPointerUp={event => finishReorder(event, true)}
          onPointerCancel={event => finishReorder(event, false)}
          onDragStart={event => event.preventDefault()}><GripVertical size={16} aria-hidden="true"/></button>}
        <button type="button" data-button-variant="danger" data-button-size="icon" disabled={disabled} onClick={() => {
          if (src === selected?.src) setSelectedSrc(images[index + 1] ?? images[index - 1]);
          remove(index);
        }} aria-label={text("Remove photo {number}", { number: index + 1 })}><X size={16} aria-hidden="true"/></button>
      </div>
      <figcaption className="editor-photo-filename" data-filename-source={storageName ? "stored" : source}>
        <span>{storageName ? storageLabel : filenameLabel(source)}</span><span>{storageName || filename || text("Filename unavailable")}</span>
        {storageName && source === "original" && storageName !== filename && <small className="muted">{originalLabel} · {filename}</small>}
        {rename?.savedImages.includes(src)&&storageName&&<button type="button" data-button-variant="edit" className="editor-photo-rename-trigger"
          disabled={disabled} aria-controls={panelId} aria-label={t(`Rename photo ${index+1}`,`Đổi tên ảnh ${index+1}`)}
          onClick={()=>{setSelectedSrc(src);setRenameSrc(src);}}>{t("Rename","Đổi tên")}</button>}
      </figcaption>
    </figure>;
  })}</div>
    {canReorder && <p className="sr-only" id={`${panelId}-order-help`}>{reorderHelp}</p>}
    <p className="sr-only editor-photo-order-status" role="status" aria-atomic="true">{orderMessage}</p>
    {selected && onMetadataChange && <section id={panelId} ref={panel} tabIndex={-1} aria-labelledby={`${panelId}-title`} className="editor-photo-panel">
      <div className="editor-photo-panel-header">
        <img src={selected.src} alt=""/>
        <div>
          <h3 id={`${panelId}-title`}>{t(`Photo ${selectedIndex + 1} of ${images.length}`, `Ảnh ${selectedIndex + 1} trên ${images.length}`)}</h3>
          <p className="muted">{selected.storageName ? storageLabel : filenameLabel(selected.source)}</p>
          <p className="editor-photo-current-name">{selected.storageName || selected.filename || text("Filename unavailable")}</p>
          {selected.storageName && selected.source === "original" && selected.storageName !== selected.filename &&
            <p className="muted editor-photo-current-name">{originalLabel} · {selected.filename}</p>}
          {canReorder && <div className="editor-photo-panel-actions">
            <button type="button" className="text-link" disabled={disabled || selectedIndex === 0}
              onClick={() => reorder(selectedIndex, selectedIndex - 1)}>{t("Move earlier", "Chuyển lên trước")}</button>
            <button type="button" className="text-link" disabled={disabled || selectedIndex === images.length - 1}
              onClick={() => reorder(selectedIndex, selectedIndex + 1)}>{t("Move later", "Chuyển xuống sau")}</button>
          </div>}
        </div>
      </div>
      <div className="editor-photo-fields">
        {([
          ["description_en", t("Caption · English", "Chú thích · Tiếng Anh"), "en"],
          ["description_vi", t("Caption · Vietnamese", "Chú thích · Tiếng Việt"), "vi"],
          ["alt_en", t("Alt text · English", "Mô tả thay thế · Tiếng Anh"), "en"],
          ["alt_vi", t("Alt text · Vietnamese", "Mô tả thay thế · Tiếng Việt"), "vi"]
        ] as const).map(([field, label, language]) => <label key={field}>{label}
          <textarea lang={language} rows={2} disabled={disabled} value={entry[field] || ""} maxLength={PHOTO_TEXT_LIMIT}
            onChange={event => onMetadataChange(selected.src, { [field]: event.target.value })}/>
        </label>)}
      </div>
      {original && <label className="editor-photo-filename-option">
        <input type="checkbox" disabled={disabled} checked={entry.public_filename === original}
          onChange={event => onMetadataChange(selected.src, { public_filename: event.target.checked ? original : "" })}/>
        <span>{t("Show original filename on the public listing", "Hiển thị tên tệp gốc trên tin đăng công khai")}</span>
      </label>}
      {rename&&renameSrc===selected.src&&<PropertyPhotoRenameForm key={selected.src} source={selected.src} rename={rename} disabled={disabled}
        onComplete={url=>{setSelectedSrc(url);setRenameSrc(undefined);panel.current?.focus();}} onCancel={()=>setRenameSrc(undefined)}/>}
    </section>}
    {rename&&<PropertyPhotoRenameTools rename={rename} disabled={disabled}/>}
    {namedPhotos.some(photo => photo.source === "stored") && <p className="small muted image-filename-note">{text("Older photos show their complete stored filenames. Original upload names were not recorded.")}</p>}
  </>}/>;
}
