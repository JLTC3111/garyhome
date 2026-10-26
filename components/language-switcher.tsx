"use client";

import { useSite } from "./site-context";
import SquishSwitch from "./react-bits/squish-switch";

export function LanguageSwitcher({ light = false, className = "" }: { light?: boolean; className?: string }) {
  const { language, setLanguage, t } = useSite();
  const label = t("Language: English. Switch to Vietnamese", "Ngôn ngữ: Tiếng Việt. Chuyển sang tiếng Anh");

  return (
    <SquishSwitch
      className={[`language-toggle${light ? " language-toggle-light" : ""}`,className].filter(Boolean).join(" ")}
      checked={language === "vi"}
      onChange={checked => setLanguage(checked ? "vi" : "en")}
      label={label}
      title={t("Switch to Tiếng Việt", "Chuyển sang tiếng Anh")}
      width={76} height={38} radius={19} speed={50} stretch={36}
      hoverScale={1.035} colorDuration={320}
    />
  );
}
