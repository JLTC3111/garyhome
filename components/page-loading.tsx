"use client";
import { usePathname } from "next/navigation";
import { unlocalizedPath } from "@/lib/localized-routes";
import { useSite } from "./site-context";
import { BackNavigation } from "./back-navigation";
import { LanguageSwitcher } from "./language-switcher";

type Layout = "hero" | "catalogue" | "cards" | "gallery" | "form" | "article" | "stats" | "rows";

function Lines({ count = 3 }: { count?: number }) {
  return <>{Array.from({ length: count }, (_, index) => <div className="skeleton-line" key={index}/>)}</>;
}

export function ContentSkeleton({ layout, label, count = 4 }: { layout: Layout; label: string; count?: number }) {
  return <div className={`content-skeleton content-skeleton--${layout}`} role="status" aria-busy="true">
    <span className="sr-only">{label}</span>
    <div className="skeleton-shape" aria-hidden="true">
      {(layout === "catalogue" || layout === "cards") && <>
        {layout === "catalogue" && <><Lines count={2}/><div className="skeleton-control"/></>}
        <div className="skeleton-grid">
          {[0, 1, 2].map(item => <div className="skeleton-card" key={item}><div className="skeleton-image"/><Lines count={2}/></div>)}
        </div>
      </>}
      {layout === "gallery" && <>
        <Lines count={2}/>
        <div className="skeleton-gallery"><div className="skeleton-image"/><div className="skeleton-image"/><div className="skeleton-image"/></div>
      </>}
      {layout === "hero" && <div className="skeleton-columns"><div><Lines count={4}/><div className="skeleton-control"/></div><div className="skeleton-image"/></div>}
      {layout === "form" && <div className="skeleton-columns"><div><Lines count={3}/></div><div className="skeleton-fields">
        {[0, 1, 2, 3].map(item => <div className="skeleton-control" key={item}/>)}
      </div></div>}
      {layout === "article" && <Lines count={5}/>}
      {layout === "rows" && <div className="skeleton-fields">
        {[0, 1, 2, 3].map(item => <div className="skeleton-control" key={item}/>)}
      </div>}
      {layout === "stats" && <div className="skeleton-grid">
        {Array.from({ length: count }, (_, item) => <div className="skeleton-card" key={item}><Lines count={2}/></div>)}
      </div>}
    </div>
  </div>;
}

export function SessionPlaceholder({ label }: { label: string }) {
  const { sessionPhase, reconnect, t } = useSite();
  const unavailable = sessionPhase === "error" || sessionPhase === "offline";
  return <div className="session-placeholder" aria-busy={!unavailable}>
    <p role="status">{sessionPhase === "offline" ? t("Reconnect to check your session.", "Kết nối lại để kiểm tra phiên đăng nhập.")
      : unavailable ? t("We couldn’t verify your session.", "Chưa thể xác minh phiên đăng nhập.") : label}</p>
    {unavailable && <button type="button" className="button button-outline button-small" onClick={() => void reconnect()}>
      {t("Reconnect", "Kết nối lại")}
    </button>}
  </div>;
}

export function SessionGate({ label }: { label: string }) {
  return <div className="container session-gate">
    <header><BackNavigation/><LanguageSwitcher/></header>
    <SessionPlaceholder label={label}/>
  </div>;
}

export function PageLoading({ layout }: { layout?: Layout }) {
  const pathname = unlocalizedPath(usePathname() || "/");
  const { t } = useSite();
  if (!layout && /^\/(?:admin|account|auth)(?:\/|$)/.test(pathname)) {
    return <div className="container session-gate" role="status" aria-busy="true">{t("Loading page…", "Đang tải trang…")}</div>;
  }
  const view = layout ?? (pathname === "/" ? "hero"
    : pathname.startsWith("/homes/") ? "gallery"
    : ["/homes", "/saved", "/vinhomes", "/tips-and-news", "/neighbourhoods"].includes(pathname) ? "catalogue"
    : pathname === "/contact" ? "form" : "article");
  const label = view === "gallery" ? t("Loading property details…", "Đang tải thông tin bất động sản…")
    : view === "catalogue" ? t("Loading listings…", "Đang tải tin đăng…") : t("Loading page…", "Đang tải trang…");
  return <div className="container section"><ContentSkeleton layout={view} label={label}/></div>;
}
