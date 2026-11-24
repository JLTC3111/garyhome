import type { ExchangeRate, PriceCurrency, Property } from "./types";
import { propertyPrice } from "./property-pricing.ts";

export type ListingPriceSort = "" | "low" | "high";

type PricedListing = Pick<Property, "status" | "price" | "price_max" | "price_vnd" | "price_vnd_max" | "currency" | "price_period">;

export function listingPriceBound(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const amount = Number(trimmed);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function monthlyListing(property: PricedListing) {
  return (property.price_period ?? "month") === "month";
}

function priceRank(property: PricedListing, currency: PriceCurrency, rate?: ExchangeRate | null) {
  const quote = propertyPrice(property, currency, rate, false);
  if (!quote) return { group: 2, amount: 0 };
  return { group: monthlyListing(property) ? 0 : 1, amount: quote.min };
}

function matchesMonthlyRange(property: PricedListing, currency: PriceCurrency, rate: ExchangeRate | null | undefined, minimum: number | null, maximum: number | null) {
  if (minimum === null && maximum === null) return true;
  if (!monthlyListing(property)) return false;
  const quote = propertyPrice(property, currency, rate, false);
  if (!quote) return false;
  const low = quote.min;
  const high = quote.max ?? quote.min;
  return (minimum === null || high >= minimum) && (maximum === null || low <= maximum);
}

export function filterStudioListings<T extends PricedListing>(
  properties: readonly T[],
  options: {
    query: string;
    status: string;
    priceSort: ListingPriceSort;
    priceMin?: string;
    priceMax?: string;
    currency?: PriceCurrency;
    exchangeRate?: ExchangeRate | null;
    text: (property: T) => string;
  },
): T[] {
  const query = options.query.toLowerCase();
  const currency = options.currency ?? "USD";
  const minimum = listingPriceBound(options.priceMin ?? "");
  const maximum = listingPriceBound(options.priceMax ?? "");
  const matched = properties.filter(property =>
    (!options.status || property.status === options.status) &&
    options.text(property).toLowerCase().includes(query) &&
    matchesMonthlyRange(property, currency, options.exchangeRate, minimum, maximum)
  );
  if (options.priceSort !== "low" && options.priceSort !== "high") return matched;
  return matched.slice().sort((left, right) => {
    const a = priceRank(left, currency, options.exchangeRate);
    const b = priceRank(right, currency, options.exchangeRate);
    if (a.group !== b.group) return a.group - b.group;
    const delta = a.amount - b.amount;
    return options.priceSort === "low" ? delta : -delta;
  });
}
