"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Globe2, X, Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "next-themes";
import { usePathname } from "next/navigation";
import { isHomeTheme, isHomeThemePath, persistHomeTheme } from "@/lib/public-theme";
import { useSite } from "./site-context";
import { CurrencySwitcher } from "./currency-switcher";
import RubberSegment from "./react-bits/rubber-segment";
import type { StudioNotificationControls } from "./studio-notifications";

export function SitePreferences({ onOpen, studio = false, triggerText, notifications }: {
  onOpen?: () => void; studio?: boolean; triggerText?: string; notifications?: StudioNotificationControls;
}) {
  const { language, setLanguage, currency, t } = useSite();
  const { theme, setTheme } = useTheme();
  const pathname = usePathname();
  const showTheme = studio || isHomeThemePath(pathname);
  const [visibility, setVisibility] = useState<"closed" | "open" | "return-focus">("closed");
  const open = visibility === "open";
  const id = useId();
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const appearance = t("Appearance", "Giao diện");
  const label = notifications ? t("Language, appearance and notifications", "Ngôn ngữ, giao diện và thông báo")
    : studio ? t("Language and appearance", "Ngôn ngữ và giao diện") : showTheme ? t("Language, currency and appearance", "Ngôn ngữ, tiền tệ và giao diện") : t("Language and currency", "Ngôn ngữ và tiền tệ");
  const heading = studio ? t("Preferences", "Tùy chọn") : showTheme ? t("Website preferences", "Tùy chọn website") : t("Language & currency", "Ngôn ngữ & tiền tệ");
  const unread = notifications?.unread ?? 0;
  const unreadLabel = unread ? ` · ${t(`${unread} unread notifications`, `${unread} thông báo chưa đọc`)}` : "";
  const summary = `${label}: ${language === "vi" ? "Tiếng Việt" : "English"}${studio ? "" : `, ${currency}`}${unreadLabel}`;
  const dismissNotifications = notifications?.dismiss;
  const dismiss = useCallback((restoreFocus = false) => {
    setVisibility(restoreFocus ? "return-focus" : "closed");
    dismissNotifications?.();
  }, [dismissNotifications]);
  const close = () => dismiss(true);

  useLayoutEffect(() => {
    if (visibility === "return-focus") trigger.current?.focus({ preventScroll: true });
  }, [visibility]);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLButtonElement>('button[aria-checked="true"]')?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) dismiss(); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [dismiss, open]);

  return <div className={studio ? "site-preferences studio-preferences" : "site-preferences"} ref={root} onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) dismiss();
  }} onKeyDown={event => {
    if (!open || event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }}>
    <button ref={trigger} type="button" className="site-preferences-trigger" title={summary} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} aria-label={summary} onClick={() => {
      if (open) dismiss();
      else { onOpen?.(); setVisibility("open"); }
    }}>
      <Globe2 size={21} aria-hidden="true"/>{triggerText && <span className="listing-tool-label">{triggerText}</span>}
      {unread > 0 && <span className="site-preferences-unread" aria-hidden="true"/>}
    </button>
    <div id={id} ref={panel} hidden={!open} inert={!open} className="site-preferences-panel" role={open ? "dialog" : undefined} aria-modal={open ? false : undefined} aria-label={label}>
      <div className="site-preferences-heading"><strong>{heading}</strong><button type="button" className="icon-button" aria-label={t("Close preferences", "Đóng tùy chọn")} onClick={close}><X size={17}/></button></div>
      <fieldset><legend>{t("Language", "Ngôn ngữ")}</legend><RubberSegment className="site-preferences-options" items={[{value:"en",label:"English",lang:"en"},{value:"vi",label:"Tiếng Việt",lang:"vi"}]} value={language} onChange={value => setLanguage(value === "vi" ? "vi" : "en")} aria-label={t("Language", "Ngôn ngữ")}/></fieldset>
      {!studio && <fieldset><legend>{t("Price currency", "Loại Tiền")}</legend><CurrencySwitcher/></fieldset>}
      {showTheme && <fieldset className="home-theme-preferences"><legend>{appearance}</legend><RubberSegment className="site-preferences-options home-theme-options" items={[
        {value:"light",label:t("Light","Sáng"),icon:<Sun size={15} aria-hidden="true"/>},
        {value:"dark",label:t("Dark","Tối"),icon:<Moon size={15} aria-hidden="true"/>},
        {value:"system",label:t("System","Hệ thống"),icon:<Monitor size={15} aria-hidden="true"/>}
      ]} value={isHomeTheme(theme) ? theme : "system"} onChange={value => {
        if (!isHomeTheme(value)) return;
        persistHomeTheme(value);
        setTheme(value);
      }} aria-label={t("Color theme","Chế độ giao diện")}/>{!studio && <p className="home-theme-hint">{t("Dark: Hanoi after dark. System follows your device.","Tối: Hà Nội về đêm. Hệ thống theo cài đặt thiết bị.")}</p>}</fieldset>}
      {notifications?.render(close)}
    </div>
  </div>;
}
