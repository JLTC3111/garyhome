"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { uploadListingFile, type ListingUploadProgress } from "@/lib/listing-file-upload";
import { imageOriginalFilename } from "@/lib/image-filenames";
import { ListingUploadStatus } from "./listing-upload-status";
import { Upload, X } from "lucide-react";
import { LISTING_VIDEO_BUCKET, propertyVideoUrlError, validatePropertyVideoFile } from "@/lib/property-video";
import type { Property } from "@/lib/types";
import { useSite } from "./site-context";
import { useStudioText } from "./use-studio-text";
import { PropertyVideo } from "./property-video";

function videoUploadError(caught: unknown): string {
  const issue = caught && typeof caught === "object" ? caught as { message?: string; status?: number } : {};
  if (issue.status === 401) return "Your sign-in expired. Reconnect and try uploading again.";
  if (issue.status === 403) return "Your account does not have permission to upload videos. Ask a team owner to check your staff access.";
  if (issue.status === 413) return "The video must be smaller than 50 MB.";
  const message = issue.message || "";
  if (message.startsWith("No upload progress for 120 seconds.") || /^(?:Your |Reconnect |Choose |The video |This file |Couldn’t confirm|MP4 )/.test(message)) return message;
  return "Couldn’t upload the video. Check your connection and retry. Your draft is still open.";
}

export function PropertyVideoField({ property, onChange, onUploadingChange, disabled = false }: {
  property: Pick<Property, "id" | "video_url">; disabled?: boolean; onChange: (url: string | null) => void; onUploadingChange?: (uploading: boolean) => void;
}) {
  const { editorTask, user, demo } = useSite(), text = useStudioText();
  const [upload, setUpload] = useState<{ id: string; busy: boolean }>({ id: property.id, busy: false });
  const [issue, setIssue] = useState<{ id: string; message: string }>({ id: property.id, message: "" });
  const lifecycle = useRef({ alive: true }), operation = useRef(0), propertyId = useRef(property.id);
  const uploadCallback = useRef(onUploadingChange);
  const controller = useRef<AbortController | null>(null);
  const paths = useRef(new WeakMap<File, string>());
  const [progress, setProgress] = useState<ListingUploadProgress | null>(null);
  const [selected, setSelected] = useState<File | null>(null);
  useLayoutEffect(() => { propertyId.current = property.id; uploadCallback.current = onUploadingChange; }, [property.id, onUploadingChange]);
  useEffect(() => {
    const state = { alive: true }; lifecycle.current = state;
    return () => { state.alive = false; controller.current?.abort(); uploadCallback.current?.(false); };
  }, [property.id]);
  const busy = upload.id === property.id && upload.busy;
  const error = issue.id === property.id ? issue.message : "";

  async function uploadVideo(file: File) {
    if (busy || disabled || !user || demo) return;
    const ticket = ++operation.current, id = property.id, ownerId = user.id, lifetime = lifecycle.current;
    const current = () => lifetime.alive && operation.current === ticket && propertyId.current === id;
    const cancellation = new AbortController(); controller.current = cancellation;
    setSelected(file); setProgress(null); setUpload({ id, busy: true }); setIssue({ id, message: "" }); uploadCallback.current?.(true);
    try {
      const validationError = await validatePropertyVideoFile(file);
      if (validationError) throw new Error(validationError);
      if (!current()) return;
      let path = paths.current.get(file);
      if (!path) { path = `${ownerId}/${id}/${crypto.randomUUID()}.mp4`; paths.current.set(file, path); }
      const url = await editorTask((db, signal) => uploadListingFile({
        client: db, file, bucket: LISTING_VIDEO_BUCKET, path, contentType: "video/mp4", originalFilename: imageOriginalFilename(file.name),
        signal: AbortSignal.any([signal, cancellation.signal]),
        onProgress: value => { if (current() && !cancellation.signal.aborted) setProgress(value); },
      }), null);
      if (propertyVideoUrlError(url)) throw new Error("Couldn’t confirm the uploaded video. Reconnect and try again.");
      paths.current.delete(file);
      if (current()) onChange(url);
    } catch (caught) {
      if (current() && !cancellation.signal.aborted) setIssue({ id, message: videoUploadError(caught) });
    } finally {
      if (current()) { setProgress(null); setUpload({ id, busy: false }); uploadCallback.current?.(false); }
    }
  }

  return <div className="property-video-field">
    <div className="editor-section-title">{text("Property video (optional)")}</div>
    <p className="form-info">{text("Add one MP4 video smaller than 50 MB. Uploading a new video replaces the current video when you save the listing.")}</p>
    {property.video_url && <><PropertyVideo url={property.video_url}/><button className="button button-outline button-small" type="button" disabled={busy || disabled}
      onClick={() => { onChange(null); setIssue({ id: property.id, message: "" }); }}><X size={15}/>{text("Remove video")}</button></>}
    <label className="upload-label"><Upload size={18}/>{busy ? text("Uploading video…") : property.video_url ? text("Replace MP4 video") : text("Upload MP4 video")}
      <input key={property.id} name="property_video" type="file" accept="video/mp4,.mp4" disabled={busy || disabled || demo || !user}
        onChange={event => {
          const files = Array.from(event.target.files || []); event.target.value = "";
          if (files.length > 1) { setIssue({ id: property.id, message: "Choose only one MP4 video for this listing." }); return; }
          if (files[0]) void uploadVideo(files[0]);
        }}/>
    </label>
    {(demo || !user) && <small>{text("Sign in to the connected workspace to upload a video.")}</small>}
    {busy && selected && <p className="image-upload-filename" role="status">{text("Uploading {filename}", { filename: imageOriginalFilename(selected.name) })}</p>}
    {busy && progress && <ListingUploadStatus progress={progress} filename={selected?.name || ""} cancel={() => controller.current?.abort()}/>}
    {!busy && error && selected && <button type="button" className="button button-outline button-small" disabled={disabled} onClick={() => void uploadVideo(selected)}>{text("Retry upload")}</button>}
    {error && <p className="form-error" role="alert">{text(error)}</p>}
  </div>;
}
