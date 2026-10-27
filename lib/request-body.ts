import { request as boundedRequest } from "./requests.ts";

export class BodyReadError extends Error {
  readonly status: 400 | 413;
  constructor(status: 400 | 413) { super(status === 413 ? "Request body too large." : "Invalid JSON body."); this.name = "BodyReadError"; this.status = status; }
}

// Enforce the byte limit while reading: Content-Length may be absent or wrong.
// Cancel oversized/stalled streams before buffering or parsing the entire body.
export async function readJsonBody(input: Request, maxBytes: number, timeoutMs = 10000): Promise<unknown> {
  if (input.signal.aborted) { void input.body?.cancel().catch(() => {}); input.signal.throwIfAborted(); }
  if (Number(input.headers.get("content-length")) > maxBytes) {
    void input.body?.cancel().catch(() => {});
    throw new BodyReadError(413);
  }
  return boundedRequest(async deadline => {
    const signal = AbortSignal.any([deadline, input.signal]); signal.throwIfAborted();
    if (!input.body) throw new BodyReadError(400);
    const reader = input.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      for (;;) {
        const { done, value } = await reader.read(); signal.throwIfAborted();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { cancel(); throw new BodyReadError(413); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
      catch { throw new BodyReadError(400); }
    } finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
  }, timeoutMs);
}
