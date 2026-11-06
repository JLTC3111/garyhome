"use client";

import { Eye, X } from "lucide-react";
import { imageFilenameDetails, type ImageFilenames } from "@/lib/image-filenames";
import { useStudioText } from "./use-studio-text";

export function PropertyPhotoGrid({ images, filenames, makeCover, remove, disabled = false }: {
  images: string[]; filenames?: ImageFilenames; makeCover: (index: number) => void;
  remove: (index: number) => void; disabled?: boolean;
}) {
  const text = useStudioText();
  const namedPhotos = images.map(src => ({ src, ...imageFilenameDetails(src, filenames) }));
  return <><div className="editor-photo-grid">{namedPhotos.map(({ src, filename, source }, index) => {
    return <figure className="editor-photo-card" key={`${index}-${src}`}>
      <div className="editor-photo-preview">
        <img src={src} alt={text("Property photo {number}", { number: index + 1 })}/>
        <span className="editor-photo-order">{index === 0 ? text("COVER") : index + 1}</span>
        <div className="editor-photo-actions">
          {index > 0 && <button type="button" disabled={disabled} onClick={() => makeCover(index)} aria-label={text("Make photo {number} cover", { number: index + 1 })}><Eye size={13}/></button>}
          <button type="button" disabled={disabled} onClick={() => remove(index)} aria-label={text("Remove photo {number}", { number: index + 1 })}><X size={14}/></button>
        </div>
      </div>
      <figcaption className="editor-photo-filename" data-filename-source={source}><span>{text(source === "original" ? "Original filename" : source === "stored" ? "Stored filename" : "Filename")}</span><span>{filename || text("Filename unavailable")}</span></figcaption>
    </figure>;
  })}</div>{namedPhotos.some(photo => photo.source === "stored") && <p className="small muted image-filename-note">{text("Older photos show their complete stored filenames. Original upload names were not recorded.")}</p>}</>;
}
