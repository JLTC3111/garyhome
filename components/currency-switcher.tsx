"use client";

import { useSite } from "./site-context";
import { EXCHANGE_RATE_SOURCE, VIETCOMBANK_RATE_SOURCE, usableExchangeRate } from "@/lib/currency";

export function CurrencySwitcher({ className = "" }: { className?: string }) {
  const { currency, setCurrency, t } = useSite();
  return <div className={`currency-switcher ${className}`} role="group" aria-label={t("Listing price currency", "Tiền tệ giá thuê")}>
    {(["USD", "VND"] as const).map(value => <button type="button" key={value} aria-pressed={currency === value} onClick={() => setCurrency(value)}>{value}</button>)}
  </div>;
}

export function CurrencyNotice() {
  const { exchangeRate, language, t } = useSite();
  if (!usableExchangeRate(exchangeRate)) return null;
  const date = new Date(exchangeRate.updatedAt).toLocaleDateString(language === "vi" ? "vi-VN" : "en-GB", { timeZone: "Asia/Ho_Chi_Minh" });
  const bank = exchangeRate.provider === "vietcombank";
  return <p className="currency-notice">{t("Prices marked ≈ are approximate conversions.", "Giá có dấu ≈ là giá quy đổi tham khảo.")} <span>{t("Rate updated", "Tỷ giá cập nhật")} {date} · </span><a href={bank ? VIETCOMBANK_RATE_SOURCE : EXCHANGE_RATE_SOURCE} target="_blank" rel="noreferrer">{bank ? t("Vietcombank · USD selling rate", "Vietcombank · Tỷ giá bán USD") : t("Rates by ExchangeRate-API", "Tỷ giá từ ExchangeRate-API")}</a></p>;
}
