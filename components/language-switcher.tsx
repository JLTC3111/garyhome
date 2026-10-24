"use client";

import { Globe2 } from "lucide-react";
import { useSite } from "./site-context";

export function LanguageSwitcher({ light = false, className = "" }: { light?: boolean; className?: string }) {
  const { language, setLanguage, t } = useSite();
  const label = t("Language: English. Switch to Vietnamese", "Ngôn ngữ: Tiếng Việt. Chuyển sang tiếng Anh");

  return (
    <button
      type="button"
      className={[`language-toggle${light ? " language-toggle-light" : ""}`,className].filter(Boolean).join(" ")}
      onClick={() => setLanguage(language === "en" ? "vi" : "en")}
      aria-label={label}
      title={t("Switch to Tiếng Việt", "Chuyển sang tiếng Anh")}
    >
      <Globe2 size={14} aria-hidden="true" />
      {language === "vi" ? "VN" : "EN"}
    </button>
  );
}
