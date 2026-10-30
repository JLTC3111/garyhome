import type { ExchangeRate, Language, PriceCurrency, Property } from "./types";
import { convertCurrency } from "./currency.ts";

type PropertyPrice = Pick<Property, "price" | "price_max" | "price_vnd" | "price_vnd_max" | "currency">;
export type PriceQuote = { min: number; max: number | null; currency: PriceCurrency; approximate: boolean; fallback: boolean };

export function recordedPropertyPrice(property: PropertyPrice, currency: PriceCurrency): PriceQuote | null {
  const min = currency === "USD" ? property.price : property.price_vnd;
  const max = currency === "USD" ? property.price_max : property.price_vnd_max;
  return min == null ? null : { min, max: max ?? null, currency, approximate: false, fallback: false };
}

export function propertyPrice(property: PropertyPrice, currency: PriceCurrency = "USD", rate?: ExchangeRate | null, fallback = true): PriceQuote | null {
  const exact = recordedPropertyPrice(property, currency);
  if (exact) return exact;
  const other = recordedPropertyPrice(property, currency === "USD" ? "VND" : "USD");
  if (!other) return null;
  const min = convertCurrency(other.min, other.currency, currency, rate);
  if (min === null) return fallback ? { ...other, fallback: true } : null;
  const precision = currency === "USD" ? 100 : 1;
  const round = (value: number) => Math.round(value * precision) / precision;
  return { min: round(min), max: other.max === null ? null : round(convertCurrency(other.max, other.currency, currency, rate)!), currency, approximate: true, fallback: false };
}

export function formatPriceQuote(price: PriceQuote, language: Language): string {
  const amount = (value: number) => value.toLocaleString(language === "vi" ? "vi-VN" : "en-US", { maximumFractionDigits: price.currency === "VND" ? 0 : 2 });
  const range = price.max !== null && price.max > price.min;
  const value = price.currency === "USD" ? "$" + amount(price.min) + (range ? "–$" + amount(price.max!) : "") : amount(price.min) + (range ? "–" + amount(price.max!) : "") + " ₫";
  return (price.approximate ? "≈ " : "") + value;
}

export function formatPropertyPrice(property: PropertyPrice, language: Language, currency: PriceCurrency = "USD", rate?: ExchangeRate | null): string | null {
  const price = propertyPrice(property, currency, rate);
  return price ? formatPriceQuote(price, language) : null;
}

export function propertyPriceOffers(property: Property, url: string) {
  const offers = (["USD", "VND"] as const).flatMap(currency => {
    const price = recordedPropertyPrice(property, currency);
    if (!price) return [];
    const range = price.max !== null && price.max > price.min;
    return [{ "@type": "Offer", ...(range ? {} : { price: price.min }), priceCurrency: currency, url,
      priceSpecification: { "@type": "UnitPriceSpecification", ...(range ? { minPrice: price.min, maxPrice: price.max } : { price: price.min }), priceCurrency: currency, unitText: property.price_period || "month" },
      ...(property.availability === "available" ? { availability: "https://schema.org/InStock" } : {}),
    }];
  });
  return offers.length ? { offers: offers.length === 1 ? offers[0] : offers } : {};
}

export function propertyPriceError(property: Pick<Property, "price" | "price_max" | "price_vnd" | "price_vnd_max">): string | null {
  for (const [min, max] of [[property.price, property.price_max], [property.price_vnd, property.price_vnd_max]]) {
    if ([min, max].some(value => value != null && (!Number.isFinite(value) || value < 0))) return "Enter valid prices of zero or more.";
    if (max != null && min == null) return "Add a From price before setting a To price.";
    if (max != null && min != null && max < min) return "The To price must be equal to or higher than the From price.";
  }
  if ([property.price_vnd, property.price_vnd_max].some(value => value != null && !Number.isInteger(value))) return "Enter VND prices in whole đồng.";
  if ([property.price, property.price_max].some(value => value != null && value > 999999999999.99) || [property.price_vnd, property.price_vnd_max].some(value => value != null && value > 999999999999999)) return "The price is too large. Check the amount and currency.";
  return null;
}
