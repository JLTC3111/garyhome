import type { SupabaseClient } from "@supabase/supabase-js";
import { browserBackendConfig } from "./browser-client";

// This measures silence, not the total time allowed to upload a file.
export const LISTING_UPLOAD_IDLE_MS = 120000;
export type ListingUploadProgress = { bytes: number; total: number; percent: number; startedAt: number; lastActivityAt: number; retrying: boolean };
export type ListingUploadOptions = { signal?: AbortSignal; onProgress?: (progress: ListingUploadProgress) => void };

const resumes = new WeakMap<Blob, Map<string, { url: string; at: number }>>();
export function listingUploadEndpoint(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("Connect Supabase before uploading.");
  const hosted = url.hostname.match(/^([a-z0-9]+)\.supabase\.co$/);
  return hosted ? `https://${hosted[1]}.storage.supabase.co/storage/v1/upload/resumable` : `${url.origin}/storage/v1/upload/resumable`;
}

// TUS resumes acknowledged chunks after a network interruption. Upload URLs
// remain in this tab's memory and are scoped to both the file and signed-in user.
export async function uploadListingFile({ client, file, resumeKey = file, bucket, path, contentType, originalFilename, signal, onProgress }: {
  client: SupabaseClient; file: Blob; resumeKey?: Blob; bucket: string; path: string; contentType: string; originalFilename: string;
} & ListingUploadOptions): Promise<string> {
  signal?.throwIfAborted();
  const config = browserBackendConfig(client);
  if (!config) throw new Error("Connect Supabase before uploading.");
  const { data, error } = await client.auth.getSession();
  signal?.throwIfAborted();
  const userId = data.session?.user.id;
  if (error || !userId || !data.session?.access_token) throw new Error("Your sign-in expired. Reconnect and try uploading again.");
  const { Upload } = await import("tus-js-client");
  signal?.throwIfAborted();
  const key = `${config.url}/${userId}/${bucket}/${path}`;
  const previous = resumes.get(resumeKey)?.get(key);
  const state: ListingUploadProgress = { bytes: 0, total: file.size, percent: 0, startedAt: Date.now(), lastActivityAt: Date.now(), retrying: false };
  return new Promise<string>((resolve, reject) => {
    let settled = false, timer: ReturnType<typeof setTimeout>;
    const publish = () => { if (!settled) onProgress?.({ ...state }); };
    const remember = () => {
      if (!upload.url) return;
      let entries = resumes.get(resumeKey);
      if (!entries) { entries = new Map(); resumes.set(resumeKey, entries); }
      entries.set(key, { url: upload.url, at: Date.now() });
    };
    const finish = (issue?: unknown) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener("abort", cancel);
      if (issue) { remember(); reject(issue); }
      else { resumes.get(resumeKey)?.delete(key); resolve(client.storage.from(bucket).getPublicUrl(path).data.publicUrl); }
    };
    const cancel = () => { void upload.abort().catch(() => {}); finish(new DOMException("Upload cancelled", "AbortError")); };
    const activity = () => {
      if (settled) return;
      state.lastActivityAt = Date.now(); clearTimeout(timer);
      timer = setTimeout(() => {
        void upload.abort().catch(() => {});
        finish(new Error("No upload progress for 120 seconds. Check your connection and retry. Your uploaded photos are still here."));
      }, LISTING_UPLOAD_IDLE_MS);
    };
    const upload = new Upload(file, {
      endpoint: listingUploadEndpoint(config.url),
      ...(previous && Date.now() - previous.at < 23 * 60 * 60 * 1000 ? { uploadUrl: previous.url } : {}),
      chunkSize: 6 * 1024 * 1024, retryDelays: [0, 1000, 3000, 5000, 10000],
      uploadDataDuringCreation: true, storeFingerprintForResuming: false, removeFingerprintOnSuccess: true,
      metadata: { bucketName: bucket, objectName: path, contentType, cacheControl: "31536000", metadata: JSON.stringify({ original_filename: originalFilename }) },
      onBeforeRequest: async request => {
        signal?.throwIfAborted();
        if (settled) throw new DOMException("Upload cancelled", "AbortError");
        const { data: current, error: authError } = await client.auth.getSession();
        signal?.throwIfAborted();
        if (settled) throw new DOMException("Upload cancelled", "AbortError");
        if (authError || !current.session?.access_token || current.session.user.id !== userId) throw new Error("Your account changed. Sign in again before continuing.");
        request.setHeader("authorization", `Bearer ${current.session.access_token}`);
        request.setHeader("apikey", config.publishableKey);
        // Progress events reset the inactivity watchdog; a slow chunk has no
        // arbitrary overall request deadline.
        const transport = request.getUnderlyingObject();
        if (typeof XMLHttpRequest !== "undefined" && transport instanceof XMLHttpRequest) transport.timeout = 0;
        activity(); publish();
      },
      onAfterResponse: () => { activity(); remember(); publish(); },
      onProgress: (bytes, total) => {
        if (bytes > state.bytes) activity();
        state.bytes = bytes; state.total = total; state.percent = total ? Math.min(99, Math.floor(bytes / total * 100)) : 0;
        state.retrying = false; publish();
      },
      onShouldRetry: (issue, attempt, options) => {
        if (settled) return false;
        const status = issue.originalResponse?.getStatus();
        if (status && status >= 400 && status < 500 && ![408, 409, 423, 429].includes(status)) return false;
        state.retrying = true; publish();
        return attempt < (options.retryDelays?.length || 0);
      },
      onError: issue => {
        const status = "originalResponse" in issue ? issue.originalResponse?.getStatus() : undefined;
        finish(Object.assign(new Error(issue.message), { status }));
      },
      onSuccess: () => { state.bytes = file.size; state.percent = 100; publish(); finish(); },
    });
    activity(); publish(); signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel(); else upload.start();
  });
}
