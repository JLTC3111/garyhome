import type { SupabaseClient } from "@supabase/supabase-js";
import { browserBackendConfig } from "./browser-client";
import { HELP_BUCKET, helpFileType } from "./portal-help";

export function helpUploadEndpoint(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("upload_connection");
  const hosted = url.hostname.match(/^([a-z0-9]+)\.supabase\.co$/);
  return hosted ? `https://${hosted[1]}.storage.supabase.co/storage/v1/upload/resumable` : `${url.origin}/storage/v1/upload/resumable`;
}

// TUS retries resume acknowledged chunks; database writes are not replayed.
// Fingerprints stay in memory, so another account never inherits upload URLs.
export async function uploadHelpFile({ client, userId, file, path, signal, onProgress }: {
  client: SupabaseClient; userId: string; file: File; path: string; signal: AbortSignal; onProgress: (value: number) => void;
}) {
  helpFileType(file); signal.throwIfAborted();
  const config = browserBackendConfig(client); if (!config) throw new Error("upload_connection");
  const { Upload } = await import("tus-js-client"); signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown) => { if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener("abort", cancel); if (error) reject(error); else resolve(); };
    const cancel = () => { void upload.abort().catch(() => {}); finish(new DOMException("Upload cancelled", "AbortError")); };
    const upload = new Upload(file, {
      endpoint: helpUploadEndpoint(config.url), chunkSize: 6 * 1024 * 1024, retryDelays: [0, 1500, 3000, 5000],
      uploadDataDuringCreation: true, storeFingerprintForResuming: false, removeFingerprintOnSuccess: true,
      metadata: { bucketName: HELP_BUCKET, objectName: path, contentType: file.type, cacheControl: "3600" },
      onBeforeRequest: async request => {
        signal.throwIfAborted();
        const { data, error } = await client.auth.getSession();
        signal.throwIfAborted();
        if (error || data.session?.user.id !== userId) throw new Error("session_changed");
        request.setHeader("authorization", `Bearer ${data.session.access_token}`);
        request.setHeader("apikey", config.publishableKey);
        const transport = request.getUnderlyingObject();
        if (typeof XMLHttpRequest !== "undefined" && transport instanceof XMLHttpRequest) transport.timeout = 90000;
      },
      onProgress: (done, total) => { if (!settled) onProgress(total ? Math.min(99, Math.round(done / total * 100)) : 0); },
      onError: () => finish(new Error("upload_connection")), onSuccess: () => { if (!settled) { onProgress(100); finish(); } },
    });
    const timer = setTimeout(() => { void upload.abort().catch(() => {}); finish(new Error("upload_connection")); }, 10 * 60 * 1000);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel(); else upload.start();
  });
}
