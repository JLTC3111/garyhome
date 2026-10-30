"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Globe2, X } from "lucide-react";
import { useSite } from "./site-context";
import { CurrencySwitcher } from "./currency-switcher";

export function SitePreferences({ onOpen }: { onOpen?: () => void }) {
  const { language, setLanguage, currency, t } = useSite();
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const label = t("Language and currency", "Ngôn ngữ và tiền tệ");
  const summary = `${label}: ${language === "vi" ? "Tiếng Việt" : "English"}, ${currency}`;
  const close = () => { setOpen(false); trigger.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus();
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
      <div className="site-preferences-heading"><strong>{t("Language & currency", "Ngôn ngữ & tiền tệ")}</strong><button type="button" className="icon-button" aria-label={t("Close preferences", "Đóng tùy chọn")} onClick={close}><X size={17}/></button></div>
      <fieldset><legend>{t("Language", "Ngôn ngữ")}</legend><div className="site-preferences-options">
        {([ ["en", "English"], ["vi", "Tiếng Việt"] ] as const).map(([value, name]) => <button key={value} lang={value} type="button" aria-pressed={language === value} onClick={() => setLanguage(value)}>{name}{language === value && <Check size={15} aria-hidden="true"/>}</button>)}
      </div></fieldset>
      <fieldset><legend>{t("Price currency", "Tiền tệ giá thuê")}</legend><CurrencySwitcher/></fieldset>
    </div>}
  </div>;
}
