"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Globe2, X, Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "next-themes";
import { usePathname } from "next/navigation";
import { isPublicPagePath } from "@/lib/localized-routes";
import { useSite } from "./site-context";
import { CurrencySwitcher } from "./currency-switcher";
import RubberSegment from "./react-bits/rubber-segment";

export function SitePreferences({ onOpen }: { onOpen?: () => void }) {
  const { language, setLanguage, currency, t } = useSite();
  const { theme, setTheme } = useTheme();
  const showTheme = isPublicPagePath(usePathname());
  const [themeReady, setThemeReady] = useState(false);
  useEffect(() => { setThemeReady(true); }, []);
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const label = showTheme ? t("Language, currency and appearance", "Ngôn ngữ, tiền tệ và giao diện") : t("Language and currency", "Ngôn ngữ và tiền tệ");
  const summary = `${label}: ${language === "vi" ? "Tiếng Việt" : "English"}, ${currency}`;
  const close = () => { setOpen(false); trigger.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLButtonElement>('button[aria-checked="true"]')?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("keydown", key); };
  }, [open]);

  return <div className="site-preferences" ref={root} onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button ref={trigger} type="button" className="site-preferences-trigger" title={summary} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} aria-label={summary} onClick={() => {
      if (!open) onOpen?.();
      setOpen(!open);
    }}>
      <Globe2 size={21} aria-hidden="true"/>
    </button>
    {open && <div id={id} ref={panel} className="site-preferences-panel" role="dialog" aria-modal="false" aria-label={label}>
      <div className="site-preferences-heading"><strong>{showTheme ? t("Website preferences", "Tùy chọn website") : t("Language & currency", "Ngôn ngữ & tiền tệ")}</strong><button type="button" className="icon-button" aria-label={t("Close preferences", "Đóng tùy chọn")} onClick={close}><X size={17}/></button></div>
      <fieldset><legend>{t("Language", "Ngôn ngữ")}</legend><RubberSegment className="site-preferences-options" items={[{value:"en",label:"English",lang:"en"},{value:"vi",label:"Tiếng Việt",lang:"vi"}]} value={language} onChange={value => setLanguage(value === "vi" ? "vi" : "en")} aria-label={t("Language", "Ngôn ngữ")}/></fieldset>
      <fieldset><legend>{t("Price currency", "Loại Tiền")}</legend><CurrencySwitcher/></fieldset>
      {showTheme && <fieldset className="home-theme-preferences"><legend>{t("Appearance", "Giao diện")}</legend><RubberSegment className="site-preferences-options home-theme-options" items={[
        {value:"light",label:t("Light","Sáng"),icon:<Sun size={15} aria-hidden="true"/>},
        {value:"dark",label:t("Dark","Tối"),icon:<Moon size={15} aria-hidden="true"/>},
        {value:"system",label:t("System","Hệ thống"),icon:<Monitor size={15} aria-hidden="true"/>}
      ]} value={themeReady ? theme || "system" : "system"} onChange={value => { if (["light","dark","system"].includes(value)) setTheme(value); }} aria-label={t("Color theme","Chế độ giao diện")}/><p className="home-theme-hint">{t("Dark: Hanoi after dark. System follows your device.","Tối: Hà Nội về đêm. Hệ thống theo cài đặt thiết bị.")}</p></fieldset>}
    </div>}
  </div>;
}
