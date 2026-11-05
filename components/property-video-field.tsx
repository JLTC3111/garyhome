"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import { LISTING_VIDEO_BUCKET, propertyVideoUrlError, validatePropertyVideoFile } from "@/lib/property-video";
import type { Property } from "@/lib/types";
import { useSite } from "./site-context";
import { useStudioText } from "./use-studio-text";
import { PropertyVideo } from "./property-video";

export function PropertyVideoField({ property, onChange, onUploadingChange, disabled = false }: {
  property: Pick<Property, "id" | "video_url">; disabled?: boolean; onChange: (url: string | null) => void; onUploadingChange?: (uploading: boolean) => void;
}) {
  const { editorTask, user, demo } = useSite(), text = useStudioText();
  const [upload, setUpload] = useState<{ id: string; busy: boolean }>({ id: property.id, busy: false });
  const [issue, setIssue] = useState<{ id: string; message: string }>({ id: property.id, message: "" });
  const lifecycle = useRef({ alive: true }), operation = useRef(0), propertyId = useRef(property.id);
  const uploadCallback = useRef(onUploadingChange);
  useLayoutEffect(() => { propertyId.current = property.id; uploadCallback.current = onUploadingChange; }, [property.id, onUploadingChange]);
  useEffect(() => {
    const state = { alive: true }; lifecycle.current = state;
    return () => { state.alive = false; uploadCallback.current?.(false); };
  }, [property.id]);
  const busy = upload.id === property.id && upload.busy;
  const error = issue.id === property.id ? issue.message : "";

  async function uploadVideo(file: File) {
    if (busy || disabled || !user || demo) return;
    const ticket = ++operation.current, id = property.id, ownerId = user.id, lifetime = lifecycle.current;
    const current = () => lifetime.alive && operation.current === ticket && propertyId.current === id;
    setUpload({ id, busy: true }); setIssue({ id, message: "" }); uploadCallback.current?.(true);
    try {
      const validationError = await validatePropertyVideoFile(file);
      if (validationError) throw new Error(validationError);
      if (!current()) return;
      const path = `${ownerId}/${id}/${crypto.randomUUID()}.mp4`;
      const url = await editorTask(async (db, signal) => {
        signal.throwIfAborted();
        const storage = db.storage.from(LISTING_VIDEO_BUCKET);
        const result = await storage.upload(path, file, { upsert: false, contentType: "video/mp4", cacheControl: "31536000" });
        if (result.error) throw new Error("Couldn’t upload the video. Check your connection and try again.");
        signal.throwIfAborted();
        return storage.getPublicUrl(path).data.publicUrl;
      });
      if (propertyVideoUrlError(url)) throw new Error("Couldn’t confirm the uploaded video. Reconnect and try again.");
      if (current()) onChange(url);
    } catch (caught) {
      if (current()) setIssue({ id, message: caught instanceof Error ? caught.message : "Couldn’t upload the video. Check your connection and try again." });
    } finally {
      if (current()) { setUpload({ id, busy: false }); uploadCallback.current?.(false); }
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
    {error && <p className="form-error" role="alert">{text(error)}</p>}
  </div>;
}
