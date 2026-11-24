"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { unlocalizedPath } from "@/lib/localized-routes";
import { LatticeLoader, type LatticeLoaderProps } from "./react-bits/lattice-loader";
import { useSite } from "./site-context";
import { BackNavigation } from "./back-navigation";
import { LanguageSwitcher } from "./language-switcher";

const LATTICE_REVEAL_MS = 200;
const LATTICE_VARIANTS = {
  navigation: { pattern: "orbit", grid: 3 },
  workspace: { pattern: "ripple", grid: 4 },
  authentication: { pattern: "dots", grid: 3 },
} as const satisfies Record<string, Pick<LatticeLoaderProps, "pattern" | "grid">>;

type PageLayout = "hero" | "catalogue" | "gallery" | "form" | "article";
type SkeletonLayout = PageLayout | "cards" | "stats" | "rows";

function SkeletonLines({ count }: { count: number }) {
  return Array.from({ length: count }, (_, index) => <div className="skeleton-line" key={index}/>);
}

function ContentSkeleton({ layout }: { layout: SkeletonLayout }) {
  return <div className={`content-skeleton content-skeleton--${layout}`} aria-hidden="true">
    {(layout === "catalogue" || layout === "cards" || layout === "stats") && <>
      {layout === "catalogue" && <><SkeletonLines count={2}/><div className="skeleton-control"/></>}
      <div className="skeleton-grid">
        {[0, 1, 2].map(item => <div className="skeleton-card" key={item}>
          {layout !== "stats" && <div className="skeleton-image"/>}<SkeletonLines count={2}/>
        </div>)}
      </div>
    </>}
    {layout === "gallery" && <>
      <SkeletonLines count={2}/>
      <div className="skeleton-gallery"><div className="skeleton-image"/><div className="skeleton-image"/><div className="skeleton-image"/></div>
    </>}
    {layout === "hero" && <div className="skeleton-columns"><div><SkeletonLines count={4}/><div className="skeleton-control"/></div><div className="skeleton-image"/></div>}
    {(layout === "form" || layout === "rows") && <div className={layout === "form" ? "skeleton-columns" : undefined}>
      {layout === "form" && <div><SkeletonLines count={3}/></div>}
      <div className="skeleton-fields">{[0, 1, 2, 3].map(item => <div className="skeleton-control" key={item}/>)}</div>
    </div>}
    {layout === "article" && <SkeletonLines count={5}/>}
  </div>;
}

function useLatticeReveal() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    // Global timer: session tests replace window with a small event target.
    const timer = setTimeout(() => setShown(true), LATTICE_REVEAL_MS);
    return () => clearTimeout(timer);
  }, []);
  return shown;
}

export function DelayedLattice({ operation, label, size = "inline", skeleton }: {
  operation: keyof typeof LATTICE_VARIANTS; label: string; size?: "page" | "inline"; skeleton?: SkeletonLayout;
}) {
  const shown = useLatticeReveal();
  const page = size === "page";
  return <div className={page ? "page-loading" : "lattice-pending"}>
    <span className="sr-only" role="status">{label}</span>
    <div className="lattice-feedback" aria-hidden="true">
      {shown && <LatticeLoader {...LATTICE_VARIANTS[operation]} label={label} color="currentColor" announce={false}
        cellSize={page ? 8 : 5} gap={page ? 3 : 2} fontSize={page ? 14 : 12}/>}
    </div>
    {skeleton && <ContentSkeleton layout={skeleton}/>}
  </div>;
}

export function SessionPlaceholder({ label, connectionLabel }: { label: string; connectionLabel?: string }) {
  const { client, configured, sessionPhase, reconnect, t } = useSite();
  if (configured && connectionLabel && !client && sessionPhase === "checking") {
    return <DelayedLattice operation="authentication" label={connectionLabel}/>;
  }
  const unavailable = sessionPhase === "error" || sessionPhase === "offline";
  return <div className="session-placeholder" aria-busy={!unavailable}>
    <p role="status">{sessionPhase === "offline" ? t("Reconnect to check your session.", "Kết nối lại để kiểm tra phiên đăng nhập.")
      : unavailable ? t("We couldn’t verify your session.", "Chưa thể xác minh phiên đăng nhập.") : label}</p>
    {unavailable && <button type="button" className="button button-outline button-small" onClick={() => void reconnect()}>
      {t("Reconnect", "Kết nối lại")}
    </button>}
  </div>;
}

export function SessionGate({ label, connectionLabel }: { label: string; connectionLabel: string }) {
  return <div className="container session-gate">
    <header><BackNavigation/><LanguageSwitcher/></header>
    <SessionPlaceholder label={label} connectionLabel={connectionLabel}/>
  </div>;
}

export function PageLoading({ layout }: { layout?: PageLayout }) {
  const pathname = unlocalizedPath(usePathname() || "/");
  const { t } = useSite();
  if (!layout && /^\/(?:admin|account|auth)(?:\/|$)/.test(pathname)) {
    return <div className="container session-gate" role="status">{t("Loading page…", "Đang tải trang…")}</div>;
  }
  const view = layout ?? (pathname === "/" ? "hero"
    : pathname.startsWith("/homes/") ? "gallery"
    : ["/homes", "/saved", "/vinhomes", "/tips-and-news", "/neighbourhoods"].includes(pathname) ? "catalogue"
    : pathname === "/contact" ? "form" : "article");
  const label = view === "gallery" ? t("Loading property details…", "Đang tải thông tin bất động sản…")
    : view === "catalogue" ? t("Loading listings…", "Đang tải tin đăng…") : t("Loading page…", "Đang tải trang…");
  return <div className="container section"><DelayedLattice operation="navigation" label={label} size="page" skeleton={view}/></div>;
}
