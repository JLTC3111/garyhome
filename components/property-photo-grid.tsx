"use client";

import { Eye, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { imageFilenameDetails, type ImageFilenames } from "@/lib/image-filenames";
import { photoMetadata, PHOTO_TEXT_LIMIT, publicPhotoFilename, type ImageMetadata, type PhotoMetadata } from "@/lib/image-metadata";
import { useSite } from "./site-context";
import { useStudioText } from "./use-studio-text";

export function PropertyPhotoGrid({ images, filenames, metadata, onMetadataChange, makeCover, move, remove, disabled = false }: {
  images: string[]; filenames?: ImageFilenames; makeCover: (index: number) => void;
  metadata?: ImageMetadata; onMetadataChange?: (src: string, patch: PhotoMetadata) => void;
  move?: (from: number, to: number) => void;
  remove: (index: number) => void; disabled?: boolean;
}) {
  const text = useStudioText();
  const { t } = useSite();
  const [selectedSrc, setSelectedSrc] = useState<string | undefined>(() => images[0]);
  const panelId = useId(), panel = useRef<HTMLElement>(null);
  const namedPhotos = images.map(src => ({ src, ...imageFilenameDetails(src, filenames) }));
  const selectedIndex = selectedSrc ? Math.max(0, images.indexOf(selectedSrc)) : 0;
  const selected = namedPhotos[selectedIndex];
  const entry = selected ? photoMetadata(selected.src, metadata) : {};
  const original = selected?.source === "original" ? publicPhotoFilename(selected.filename) : "";
  const filenameLabel = (source: string) => text(source === "original" ? "Original filename" : source === "stored" ? "Stored filename" : "Filename");

  return <><div className="editor-photo-grid">{namedPhotos.map(({ src, filename, source }, index) => {
    const photo = <img src={src} alt={onMetadataChange ? "" : text("Property photo {number}", { number: index + 1 })}/>;
    return <figure className="editor-photo-card" key={`${index}-${src}`} data-photo-selected={onMetadataChange && selectedIndex === index ? "true" : undefined}>
      <div className="editor-photo-preview">
        {onMetadataChange ? <button type="button" className="editor-photo-select" disabled={disabled} aria-controls={panelId}
          aria-pressed={selectedIndex === index} aria-label={t(`Edit photo ${index + 1}`, `Chỉnh sửa ảnh ${index + 1}`)}
          onClick={() => { setSelectedSrc(src); panel.current?.focus(); }}>{photo}</button> : photo}
        <span className="editor-photo-order">{index === 0 ? text("COVER") : index + 1}</span>
        <div className="editor-photo-actions">
          {index > 0 && <button type="button" disabled={disabled} onClick={() => { setSelectedSrc(selected?.src); makeCover(index); }} aria-label={text("Make photo {number} cover", { number: index + 1 })}><Eye size={13}/></button>}
          <button type="button" disabled={disabled} onClick={() => {
            if (src === selected?.src) setSelectedSrc(images[index + 1] ?? images[index - 1]);
            remove(index);
          }} aria-label={text("Remove photo {number}", { number: index + 1 })}><X size={14}/></button>
        </div>
      </div>
      <figcaption className="editor-photo-filename" data-filename-source={source}>
        <span>{filenameLabel(source)}</span><span>{filename || text("Filename unavailable")}</span>
      </figcaption>
    </figure>;
  })}</div>
    {selected && onMetadataChange && <section id={panelId} ref={panel} tabIndex={-1} aria-labelledby={`${panelId}-title`} className="editor-photo-panel">
      <div className="editor-photo-panel-header">
        <img src={selected.src} alt=""/>
        <div>
          <h3 id={`${panelId}-title`}>{t(`Photo ${selectedIndex + 1} of ${images.length}`, `Ảnh ${selectedIndex + 1} trên ${images.length}`)}</h3>
          <p className="muted">{filenameLabel(selected.source)}</p>
          <p>{selected.filename || text("Filename unavailable")}</p>
          {move && images.length > 1 && <div className="editor-photo-panel-actions">
            <button type="button" className="text-link" disabled={disabled || selectedIndex === 0}
              onClick={() => { setSelectedSrc(selected.src); move(selectedIndex, selectedIndex - 1); }}>{t("Move earlier", "Chuyển lên trước")}</button>
            <button type="button" className="text-link" disabled={disabled || selectedIndex === images.length - 1}
              onClick={() => { setSelectedSrc(selected.src); move(selectedIndex, selectedIndex + 1); }}>{t("Move later", "Chuyển xuống sau")}</button>
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
    </section>}
    {namedPhotos.some(photo => photo.source === "stored") && <p className="small muted image-filename-note">{text("Older photos show their complete stored filenames. Original upload names were not recorded.")}</p>}
  </>;
}
