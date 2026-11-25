"use client";

import { useEffect, useId, useRef, useState, type AnchorHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { ArrowRight, ArrowUpRight, ChevronDown, Compass, LayoutGrid } from "lucide-react";
import { GARY_APPS, GARY_GOALS, garyAppHref, type GaryAppId, type GaryCopy, type GaryLanguage } from "./catalogue";
import { localizedPath } from "../../lib/localized-routes";

type AnchorProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };
type SharedProps = { language: GaryLanguage; currentApp?: GaryAppId; className?: string; renderLink?: (props: AnchorProps) => ReactNode };
// Use the same platform marks as the Visa and Jobs switchers.
const appMarks: Record<GaryAppId, ReactNode> = {
  home: <>
    <path d="M5 18 20 6l15 12M9 16v19h22V16M17 35V24h6v11"/>
    <path d="M13 18h3v3h-3zm11 0h3v3h-3z"/>
  </>,
  jobs: <path d="M20 13c-5-4-11-4-16-2v22c6-2 11-1 16 2 5-3 10-4 16-2V11c-5-2-11-2-16 2Zm0 0v22M8 17l7 2m-7 4 7 2M25 7l5-5 5 5M30 3v18"/>,
  visa: <>
    <rect x="8" y="3" width="25" height="34" rx="3"/>
    <path d="M12 3v34M18 31h10M18 8h10"/>
    <circle cx="23" cy="19" r="7"/>
    <path d="M16 19h14M23 12c-4 4-4 10 0 14 4-4 4-10 0-14Z"/>
  </>,
};
const text = (copy: GaryCopy, language: GaryLanguage) => copy[language];
const copy = (language: GaryLanguage, en: string, vi: string) => language === "vi" ? vi : en;

function GaryBrandIcon({ app, size = 36 }: { app: GaryAppId; size?: number }) {
  return <svg data-gary-brand-mark={app} aria-hidden="true" focusable="false" viewBox="0 0 40 40"
    width={size} height={size} fill="none" stroke="currentColor" strokeWidth={size < 30 ? 2.4 : 1.7}
    strokeLinecap="round" strokeLinejoin="round">{appMarks[app]}</svg>;
}

function AppLink({ app, path = "/", language, currentApp, renderLink, children, ...props }: SharedProps & AnchorHTMLAttributes<HTMLAnchorElement> & { app: GaryAppId; path?: string }) {
  const external = app !== currentApp;
  const href = app === "home" && currentApp === "home" ? localizedPath(path, language) : garyAppHref(app, path, currentApp);
  const anchor: AnchorProps = { ...props, href, target: external ? "_blank" : undefined, rel: external ? "noopener noreferrer" : undefined };
  anchor.children = <>{children}{external && <span className="gary-apps-sr">{copy(language, " (opens in a new tab)", " (mở trong thẻ mới)")}</span>}</>;
  return renderLink ? renderLink(anchor) : <a {...anchor}/>;
}

export function GaryAppsDirectory({ language, currentApp, className = "", renderLink }: SharedProps) {
  const id = useId(), shared = { language, currentApp, renderLink };
  return <section className={`gary-apps-directory ${className}`} id="gary-services" aria-labelledby={id}>
    <header className="gary-apps-heading"><div><span className="gary-apps-eyebrow"><LayoutGrid size={15} aria-hidden="true"/>{copy(language, "THE GARY NETWORK", "HỆ THỐNG DỊCH VỤ GARY")}</span><h2 id={id}>{copy(language, "Your next chapter.\nA little support for every step.", "Chương mới của bạn.\nĐồng hành trên từng bước đi.")}</h2></div><p>{copy(language, "A home, a teaching role, a visa or a new place to explore. Choose the Gary site that fits your plans.", "Tìm nhà, công việc giảng dạy, hỗ trợ visa hay một nơi để khám phá. Chọn trang Gary phù hợp với kế hoạch của bạn.")}</p></header>
    <nav className="gary-apps-goals" aria-label={copy(language, "What would you like to do?", "Bạn muốn tìm dịch vụ gì?")}>
      {GARY_GOALS.map(goal => <AppLink key={goal.id} {...shared} app={goal.app} path={goal.path} className={`gary-app-${goal.app}`}>
        {goal.id === "travel" ? <Compass size={17} aria-hidden="true"/> : <GaryBrandIcon app={goal.app} size={20}/>}
        <span>{text(goal.label, language)}</span><ArrowUpRight size={14} aria-hidden="true"/>
      </AppLink>)}
    </nav>
    <div className="gary-apps-grid">{GARY_APPS.map(app => {
      const current = app.id === currentApp;
      return <article key={app.id} className={`gary-app-card gary-app-${app.id}`} data-current={current}>
        <div className="gary-app-card-top">
          <span className="gary-app-mark"><GaryBrandIcon app={app.id}/></span>
          <div className="gary-app-card-identity">
            <span className="gary-app-sector">{text(app.sector, language)}</span>
            <h3 className="gary-app-name">{app.name}</h3>
            {current ? <span className="gary-app-current">{copy(language, "This site", "Trang hiện tại")}</span> : <span className="gary-app-menu-host">{app.host}</span>}
          </div>
        </div>
        <p className="gary-app-headline">{text(app.headline, language)}</p>
        <p className="gary-app-description">{text(app.description, language)}</p>
        <ul>{app.services.map((service, index) => <li key={index}><AppLink {...shared} app={app.id} path={service.path}><span>{text(service.label, language)}</span><ArrowUpRight size={15} aria-hidden="true"/></AppLink></li>)}</ul>
        <AppLink {...shared} app={app.id} className="gary-app-visit" aria-current={current ? "true" : undefined}>
          <span>{copy(language, "Explore", "Khám phá")} {app.name}</span><ArrowRight size={16} aria-hidden="true"/>
        </AppLink>
      </article>;
    })}</div>
  </section>;
}

export function GaryAppsMenu({ language, currentApp, className = "", renderLink, onFollow, onOpen }: SharedProps & { onFollow?: () => void; onOpen?: () => void }) {
  const [open, setOpen] = useState(false), root = useRef<HTMLDetailsElement>(null), trigger = useRef<HTMLElement>(null), id = useId();
  const shared = { language, currentApp, renderLink };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("pointerdown", outside); };
  }, [open]);
  function follow() { setOpen(false); onFollow?.(); }
  function keys(event: KeyboardEvent<HTMLDetailsElement>) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const links = Array.from(root.current?.querySelectorAll<HTMLAnchorElement>("a[href]") || []), index = links.indexOf(event.target as HTMLAnchorElement);
    if (event.target === trigger.current && ["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault(); if (!open) onOpen?.(); setOpen(true); queueMicrotask(() => links[event.key === "ArrowDown" ? 0 : links.length - 1]?.focus()); return;
    }
    if (!open || index < 0) return;
    event.preventDefault(); links[event.key === "Home" ? 0 : event.key === "End" ? links.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + links.length) % links.length]?.focus();
  }
  return <details className={`gary-apps-menu ${className}`} ref={root} open={open} onToggle={event => { if (event.currentTarget.open !== open) setOpen(event.currentTarget.open); }} onKeyDown={keys} onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false); }}>
    <summary ref={trigger} aria-expanded={open} aria-controls={id} aria-label={copy(language, "Explore Gary apps and services", "Khám phá các trang và dịch vụ Gary")} onClick={event => { event.preventDefault(); if (!open) onOpen?.(); setOpen(!open); }}><LayoutGrid size={17} aria-hidden="true"/><span>{copy(language, "Other Services", "Dịch vụ khác")}</span><ChevronDown size={12} className="gary-apps-chevron" aria-hidden="true"/></summary>
    <nav className="gary-apps-menu-panel" id={id} aria-label={copy(language, "Gary websites and services", "Các trang và dịch vụ Gary")}>
      <div className="gary-apps-menu-heading"><strong>{copy(language, "Three sites. Here for your next step.", "Ba trang. Đồng hành cùng bước tiếp theo.")}</strong><p>{copy(language, "Find the right place to start.", "Tìm nơi bắt đầu phù hợp với bạn.")}</p></div>
      <ul>{GARY_APPS.map(app => {
        const current = app.id === currentApp;
        return <li key={app.id}>
          <AppLink {...shared} app={app.id} className={`gary-app-menu-item gary-app-${app.id}`} aria-current={current ? "true" : undefined} onClick={follow}>
            <span className="gary-app-mark"><GaryBrandIcon app={app.id}/></span>
            <span className="gary-app-menu-copy">
              <span className="gary-app-sector">{text(app.sector, language)}</span>
              <strong className="gary-app-name"><span>{app.name}</span>{current && <small className="gary-app-current">{copy(language, "This site", "Trang hiện tại")}</small>}</strong>
              <span className="gary-app-menu-description">{text(app.shortDescription, language)}</span>
              <small className="gary-app-menu-host">{app.host}</small>
            </span>
            <ArrowUpRight size={17} aria-hidden="true"/>
          </AppLink>
        </li>;
      })}</ul>
      <div className="gary-apps-menu-travel"><Compass size={17} aria-hidden="true"/><AppLink {...shared} app="jobs" path="/#life" onClick={follow}>{copy(language, "Travel & life in Vietnam", "Du lịch & cuộc sống tại Việt Nam")}<ArrowUpRight size={14} aria-hidden="true"/></AppLink></div>
      <AppLink {...shared} app="home" path="/services#gary-services" className="gary-apps-menu-all" onClick={follow}>{copy(language, "See all services", "Xem tất cả dịch vụ")}<ArrowRight size={16} aria-hidden="true"/></AppLink>
    </nav>
  </details>;
}
