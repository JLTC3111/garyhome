export class RequestTimeoutError extends Error {
  constructor() {
    super("The request timed out. It may have reached the server. Check the current data before trying again.");
    this.name = "RequestTimeoutError";
  }
}

// Bound the entire operation, including SDK token acquisition and response bodies.
// Aborting a write does not guarantee that the server did not commit it. Never replay it here.
export async function request<T>(operation: (signal: AbortSignal) => PromiseLike<T>, timeoutMs = 20000): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new RequestTimeoutError());
          controller.abort();
        }, timeoutMs);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

// Our SDK calls return small JSON responses. Buffer them within the deadline so
// a connection that stalls after response headers cannot strand auth initialization.
export function fetchWithDeadline(input: RequestInfo | URL, init?: RequestInit, timeoutMs = 15000): Promise<Response> {
  return request(async signal => {
    const upstream = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const combined = upstream ? AbortSignal.any([signal, upstream]) : signal;
    const response = await fetch(input, { ...init, signal: combined });
    const body = await response.arrayBuffer();
    return new Response([204, 205, 304].includes(response.status) ? null : body, {
      status: response.status, statusText: response.statusText, headers: response.headers,
    });
  }, timeoutMs);
}
