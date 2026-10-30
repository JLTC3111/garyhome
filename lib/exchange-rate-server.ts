import type { ExchangeRate } from "./types";
import { usableExchangeRate } from "./currency.ts";
import { request } from "./requests.ts";

// Fixed, official HTTPS endpoints only. No visitor data or credentials are forwarded.
const VCB_ENDPOINT = "https://portal.vietcombank.com.vn/Usercontrols/TVPortal.TyGia/pXML.aspx";
const BACKUP_ENDPOINT = "https://open.er-api.com/v6/latest/USD";
const REFRESH_MS = 5 * 60 * 1000;

export function parseExchangeRate(value: unknown, now = Date.now()): ExchangeRate | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>, rates = data.rates as Record<string, unknown> | undefined;
  if (data.result !== "success" || data.base_code !== "USD" || rates?.USD !== 1 || typeof rates.VND !== "number" || typeof data.time_last_update_unix !== "number" || typeof data.time_next_update_unix !== "number") return null;
  const updated = data.time_last_update_unix * 1000, next = data.time_next_update_unix * 1000;
  if (!Number.isFinite(updated) || !Number.isFinite(next) || Math.abs(updated) > 8.64e15 || Math.abs(next) > 8.64e15) return null;
  const rate: ExchangeRate = { usdToVnd: rates.VND, updatedAt: new Date(updated).toISOString(), nextUpdateAt: new Date(next).toISOString(), provider: "exchange-rate-api", basis: "reference" };
  return usableExchangeRate(rate, now) ? rate : null;
}

export function parseVietcombankRate(xml: string, now = Date.now()): ExchangeRate | null {
  // Parse only this feed's flat timestamp and USD quote. No XML entities, DTDs or external resources.
  if (xml.length > 65536 || /<!DOCTYPE|<!ENTITY/i.test(xml) || !/<ExrateList\s*>/.test(xml) || !/<\/ExrateList\s*>/.test(xml)) return null;
  const date = xml.match(/<DateTime>\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(AM|PM)\s*<\/DateTime>/i);
  if (!date) return null;
  const [, mm, dd, yyyy, hh, minute, second, period] = date;
  const month = Number(mm), day = Number(dd), year = Number(yyyy), hour = Number(hh);
  if (hour < 1 || hour > 12 || Number(minute) > 59 || Number(second) > 59) return null;
  const localHour = hour % 12 + (period.toUpperCase() === "PM" ? 12 : 0);
  const local = new Date(Date.UTC(year, month - 1, day, localHour, Number(minute), Number(second)));
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day) return null;
  const updated = local.getTime() - 7 * 60 * 60 * 1000; // The published bank timestamp is Vietnam time.
  const quotes: number[] = [];
  for (const row of xml.matchAll(/<Exrate\b([^<>]*)\/\s*>/g)) {
    const attrs = [...row[1].matchAll(/\b(CurrencyCode|Sell)\s*=\s*(["'])([^"']*)\2/g)];
    const codes = attrs.filter(attr => attr[1] === "CurrencyCode"), sells = attrs.filter(attr => attr[1] === "Sell");
    if (codes.length !== 1 || codes[0][3] !== "USD") continue;
    if (sells.length !== 1 || !/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(sells[0][3])) return null;
    quotes.push(Number(sells[0][3].replaceAll(",", "")));
  }
  if (quotes.length !== 1) return null;
  const rate: ExchangeRate = { usdToVnd: quotes[0], updatedAt: new Date(updated).toISOString(), nextUpdateAt: new Date(updated + REFRESH_MS).toISOString(), provider: "vietcombank", basis: "sell" };
  return usableExchangeRate(rate, now) ? rate : null;
}

async function readRateResponse(response: Response, kind: "xml" | "json"): Promise<string> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!response.ok || !(kind === "xml" ? /(?:text|application)\/xml\b/.test(contentType) : contentType.includes("application/json")) || Number(response.headers.get("content-length")) > 65536 || !response.body) throw new Error("Invalid " + kind + " rate response (HTTP " + response.status + ")");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let bytes = 0, text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 65536) { await reader.cancel(); throw new Error("Rate response too large"); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

export function createExchangeRateLoader(fetcher?: typeof fetch, now = Date.now, timeoutMs = 3000) {
  let cached: ExchangeRate | null = null, retryAt = 0;
  let lastFailure: string | null = null;
  let flight: Promise<ExchangeRate | null> | null = null;
  const available = () => usableExchangeRate(cached, now()) ? cached : null;
  async function load(): Promise<ExchangeRate | null> {
    if (now() < retryAt) return available();
    if (flight) return flight;
    flight = (async () => {
      const failures: string[] = [];
      for (const provider of [{ url: VCB_ENDPOINT, kind: "xml", cacheSeconds: 300 }, { url: BACKUP_ENDPOINT, kind: "json", cacheSeconds: 86400 }] as const) {
        try {
          const candidate = await request(async signal => {
            // Cloudflare does not implement redirect:"error". Manual mode plus the HTTP
            // status check rejects redirects without following them on either runtime.
            const response = await (fetcher ?? fetch)(provider.url, { headers: { Accept: provider.kind === "xml" ? "application/xml, text/xml" : "application/json" }, credentials: "omit", redirect: "manual", signal, next: { revalidate: provider.cacheSeconds } });
            const body = await readRateResponse(response, provider.kind);
            return provider.kind === "xml" ? parseVietcombankRate(body, now()) : parseExchangeRate(JSON.parse(body), now());
          }, timeoutMs);
          if (!candidate) throw new Error("Invalid exchange-rate data");
          cached = candidate; lastFailure = null; retryAt = now() + REFRESH_MS;
          return available();
        } catch (error) {
          failures.push(provider.kind + ": " + (error instanceof Error ? error.name + ": " + error.message : "Request failed"));
        }
      }
      lastFailure = failures.join("; ");
      // Respect the bank's one-request-per-five-minutes guidance, including outages.
      retryAt = now() + REFRESH_MS;
      return available();
    })();
    try { return await flight; } finally { flight = null; }
  };
  return Object.assign(load, { diagnostics: () => lastFailure });
}

export const getExchangeRate = createExchangeRateLoader();
