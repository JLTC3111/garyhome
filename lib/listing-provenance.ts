export type ListingCreationRecord = { property_id: string; created_at: string; actor_name: string | null };

export function listingCreationTime(value: string, language: "en" | "vi") {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const locale = language === "vi" ? "vi-VN" : "en-GB";
  return {
    iso: date.toISOString(),
    date: new Intl.DateTimeFormat(locale, { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" }).format(date),
    time: new Intl.DateTimeFormat(locale, { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date),
  };
}
