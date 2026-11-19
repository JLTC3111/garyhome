"use client";

import { Eye, X } from "lucide-react";
import { imageFilenameDetails, type ImageFilenames } from "@/lib/image-filenames";
import { photoMetadata, PHOTO_TEXT_LIMIT, publicPhotoFilename, type ImageMetadata, type PhotoMetadata } from "@/lib/image-metadata";
import { useSite } from "./site-context";
import { useStudioText } from "./use-studio-text";

export function PropertyPhotoGrid({ images, filenames, metadata, onMetadataChange, makeCover, remove, disabled = false }: {
  images: string[]; filenames?: ImageFilenames; makeCover: (index: number) => void;
  metadata?: ImageMetadata; onMetadataChange?: (src: string, patch: PhotoMetadata) => void;
  remove: (index: number) => void; disabled?: boolean;
}) {
  const text = useStudioText();
  const { t } = useSite();
  const namedPhotos = images.map(src => ({ src, ...imageFilenameDetails(src, filenames) }));
  return <><div className="editor-photo-grid">{namedPhotos.map(({ src, filename, source }, index) => {
    const entry = photoMetadata(src, metadata);
    const original = source === "original" ? publicPhotoFilename(filename) : "";
    return <figure className="editor-photo-card" key={`${index}-${src}`}>
      <div className="editor-photo-preview">
        <img src={src} alt={text("Property photo {number}", { number: index + 1 })}/>
        <span className="editor-photo-order">{index === 0 ? text("COVER") : index + 1}</span>
        <div className="editor-photo-actions">
          {index > 0 && <button type="button" disabled={disabled} onClick={() => makeCover(index)} aria-label={text("Make photo {number} cover", { number: index + 1 })}><Eye size={13}/></button>}
          <button type="button" disabled={disabled} onClick={() => remove(index)} aria-label={text("Remove photo {number}", { number: index + 1 })}><X size={14}/></button>
        </div>
      </div>
      <figcaption className="editor-photo-filename" data-filename-source={source}>
        <span>{text(source === "original" ? "Original filename" : source === "stored" ? "Stored filename" : "Filename")}</span><span>{filename || text("Filename unavailable")}</span>
        {onMetadataChange && <details className="editor-photo-text">
          <summary>{t("Public caption and alt text", "Chú thích và mô tả ảnh công khai")}</summary>
          {([
            ["description_en", t("Caption · English", "Chú thích · Tiếng Anh")],
            ["description_vi", t("Caption · Vietnamese", "Chú thích · Tiếng Việt")],
            ["alt_en", t("Alt text · English", "Mô tả thay thế · Tiếng Anh")],
            ["alt_vi", t("Alt text · Vietnamese", "Mô tả thay thế · Tiếng Việt")]
          ] as const).map(([field, label]) => <label key={field}>{label}
            <input disabled={disabled} value={entry[field] || ""} maxLength={PHOTO_TEXT_LIMIT} onChange={event => onMetadataChange(src, { [field]: event.target.value })}/>
          </label>)}
          {original && <label className="editor-photo-filename-option"><input type="checkbox" disabled={disabled} checked={entry.public_filename === original}
            onChange={event => onMetadataChange(src, { public_filename: event.target.checked ? original : "" })}/>
            {t("Show original filename on the public listing", "Hiển thị tên tệp gốc trên tin đăng công khai")}
          </label>}
        </details>}
      </figcaption>
    </figure>;
  })}</div>{namedPhotos.some(photo => photo.source === "stored") && <p className="small muted image-filename-note">{text("Older photos show their complete stored filenames. Original upload names were not recorded.")}</p>}</>;
}
