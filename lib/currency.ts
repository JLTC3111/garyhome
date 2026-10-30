import type { ExchangeRate, PriceCurrency } from "./types";

export const CURRENCY_COOKIE = "gary-currency";
export const EXCHANGE_RATE_SOURCE = "https://www.exchangerate-api.com";
export const VIETCOMBANK_RATE_SOURCE = "https://www.vietcombank.com.vn/KHCN/Cong-cu-tien-ich/Ty-gia";
export const MAX_RATE_AGE_MS = 72 * 60 * 60 * 1000;

export function currencyValue(value: unknown): PriceCurrency { return value === "VND" ? "VND" : "USD"; }

export function persistCurrency(currency: PriceCurrency) {
  try { localStorage.setItem(CURRENCY_COOKIE, currency); } catch { /* Storage is optional. */ }
  try { document.cookie = `${CURRENCY_COOKIE}=${currency}; Path=/; Max-Age=31536000; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`; } catch { /* Cookies are optional. */ }
}

export function usableExchangeRate(rate: ExchangeRate | null | undefined, now = Date.now()): rate is ExchangeRate {
  if (!rate || !Number.isFinite(rate.usdToVnd) || rate.usdToVnd < 1000 || rate.usdToVnd > 1000000) return false;
  const updated = Date.parse(rate.updatedAt), next = Date.parse(rate.nextUpdateAt);
  return Number.isFinite(updated) && updated <= now + 300000 && now - updated <= MAX_RATE_AGE_MS && Number.isFinite(next) && next > updated;
}

export function convertCurrency(value: number, from: PriceCurrency, to: PriceCurrency, rate?: ExchangeRate | null): number | null {
  if (from === to) return value;
  if (!usableExchangeRate(rate)) return null;
  return to === "VND" ? value * rate.usdToVnd : value / rate.usdToVnd;
}

export function convertBudget(value: string, from: PriceCurrency, to: PriceCurrency, rate: ExchangeRate | null | undefined, bound: "min" | "max"): string | null {
  if (value === "" || from === to) return value;
  const converted = convertCurrency(Number(value), from, to, rate);
  if (converted === null || !Number.isFinite(converted)) return null;
  const precision = to === "USD" ? 100 : 1;
  return String((bound === "min" ? Math.floor(converted * precision) : Math.ceil(converted * precision)) / precision);
}
