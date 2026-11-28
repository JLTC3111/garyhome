"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ChevronLeft, Menu, X } from "lucide-react";

const STORAGE_KEY = "gary-home-studio-sidebar";
const MIN_WIDTH = 248;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 272;

type Text = (message: string) => string;
const PHONE = "(max-width: 680px)";

function maxWidth() {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - 480));
}

function clampWidth(width: number) {
  return Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(width)));
}

function readSidebar() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { width: DEFAULT_WIDTH, collapsed: false, custom: false };
    const saved = JSON.parse(raw) as { width?: unknown; collapsed?: unknown };
    const storedWidth = saved.width;
    const custom = typeof storedWidth === "number" && Number.isFinite(storedWidth);
    return { width: custom ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(storedWidth))) : DEFAULT_WIDTH, collapsed: saved.collapsed === true, custom };
  } catch {
    return { width: DEFAULT_WIDTH, collapsed: false, custom: false };
  }
}

export function StudioShell({ children, sidebar, text }: {
  children: (navigation: { trigger: ReactNode; open: boolean; mobile: boolean }) => ReactNode;
  sidebar: (navigation: { closeNavigation: () => void; compact: boolean; mobile: boolean }) => ReactNode;
  text: Text;
}) {
  const dock = useRef<HTMLElement>(null);
  const navigationTrigger = useRef<HTMLButtonElement>(null), navigationClose = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const widthRef = useRef(DEFAULT_WIDTH);
  const customRef = useRef(false);
  const collapsedRef = useRef(false);
  const dragOrigin = useRef({ x: 0, width: DEFAULT_WIDTH });
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [custom, setCustom] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [limit, setLimit] = useState(MAX_WIDTH);
  const [narrow, setNarrow] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navigationOpen = narrow && drawerOpen;

  function remember(nextWidth = widthRef.current, nextCollapsed = collapsedRef.current, nextCustom = customRef.current) {
    widthRef.current = nextWidth;
    collapsedRef.current = nextCollapsed;
    customRef.current = nextCustom;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...(nextCustom ? { width: nextWidth } : {}), collapsed: nextCollapsed }));
    } catch { /* Preference storage is optional. */ }
  }

  useLayoutEffect(() => {
    const phone = window.matchMedia(PHONE);
    const saved = readSidebar();
    let nextWidth = saved.width;
    if (!saved.custom && !phone.matches) {
      const measured = Math.round(dock.current?.getBoundingClientRect().width || 0);
      if (measured >= MIN_WIDTH) nextWidth = measured;
    }
    widthRef.current = nextWidth;
    customRef.current = saved.custom;
    collapsedRef.current = saved.collapsed;
    setWidth(nextWidth);
    setCustom(saved.custom);
    setCollapsed(saved.collapsed);
    const syncLimit = () => {
      setLimit(maxWidth());
      setNarrow(phone.matches);
      if (phone.matches) return;
      setDrawerOpen(false);
      if (!customRef.current && !collapsedRef.current) {
        const measured = Math.round(dock.current?.getBoundingClientRect().width || 0);
        if (measured >= MIN_WIDTH && measured !== widthRef.current) {
          widthRef.current = measured;
          setWidth(measured);
        }
      }
    };
    syncLimit();
    window.addEventListener("resize", syncLimit);
    return () => window.removeEventListener("resize", syncLimit);
  }, []);

  useLayoutEffect(() => {
    if (navigationOpen) navigationClose.current?.focus({ preventScroll: true });
    else if (narrow && wasOpen.current) navigationTrigger.current?.focus({ preventScroll: true });
    wasOpen.current = navigationOpen;
  }, [narrow, navigationOpen]);

  function closeNavigation() { setDrawerOpen(false); }

  function onNavigationKey(event: ReactKeyboardEvent<HTMLElement>) {
    // Profile controls can be portaled out of the sidebar.
    if (!navigationOpen || !event.currentTarget.contains(event.target as Node)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeNavigation();
    }
    if (event.key !== "Tab") return;
    const nodes = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),[tabindex="0"]'
    )).filter(node => node.tabIndex >= 0 && !node.closest("[inert],[hidden]") && node.getClientRects().length);
    const first = nodes[0], last = nodes.at(-1);
    if (event.shiftKey ? document.activeElement !== first : document.activeElement !== last) return;
    event.preventDefault();
    (event.shiftKey ? last : first)?.focus();
  }

  function toggle() {
    const next = !collapsedRef.current;
    setCollapsed(next);
    remember(widthRef.current, next, customRef.current);
  }

  function resizeTo(next: number, persist: boolean) {
    const value = clampWidth(next);
    widthRef.current = value;
    customRef.current = true;
    collapsedRef.current = false;
    setWidth(value);
    setCustom(true);
    setCollapsed(false);
    if (persist) remember(value, false, true);
    return value;
  }

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const measured = Math.round(dock.current?.getBoundingClientRect().width || widthRef.current);
    event.currentTarget.setPointerCapture(event.pointerId);
    dragOrigin.current = { x: event.clientX, width: measured };
    widthRef.current = measured;
    setWidth(measured);
    setResizing(true);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    resizeTo(dragOrigin.current.width + event.clientX - dragOrigin.current.x, false);
  }

  function onPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (Math.abs(event.clientX - dragOrigin.current.x) >= 3) resizeTo(dragOrigin.current.width + event.clientX - dragOrigin.current.x, true);
    setResizing(false);
  }

  function onResizeKey(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const step = event.shiftKey ? 32 : 16;
    const measured = Math.round(dock.current?.getBoundingClientRect().width || widthRef.current);
    const current = measured >= MIN_WIDTH ? measured : widthRef.current;
    const next = event.key === "ArrowLeft" ? current - step : event.key === "ArrowRight" ? current + step : event.key === "Home" ? MIN_WIDTH : event.key === "End" ? maxWidth() : null;
    if (next === null) return;
    event.preventDefault();
    resizeTo(next, true);
  }

  function resetWidth() {
    widthRef.current = DEFAULT_WIDTH;
    customRef.current = false;
    collapsedRef.current = false;
    setWidth(DEFAULT_WIDTH);
    setCustom(false);
    setCollapsed(false);
    remember(DEFAULT_WIDTH, false, false);
  }

  const shown = Math.min(width, limit);
  const compact = collapsed && !narrow;
  const style = custom && !collapsed && !narrow ? { "--studio-sidebar-width": `${shown}px` } as CSSProperties : undefined;
  const controls = <>
    {!collapsed && <button type="button" className="admin-sidebar-resize" role="separator" aria-orientation="vertical" aria-label={text("Resize sidebar")} aria-valuemin={MIN_WIDTH} aria-valuemax={limit} aria-valuenow={shown} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onKeyDown={onResizeKey} onDoubleClick={resetWidth}/>}
    <button type="button" className="admin-sidebar-collapse" aria-controls="staff-sidebar" aria-expanded={!collapsed} onClick={toggle}>
      <ChevronLeft size={16} aria-hidden="true"/>
      <span className="sr-only">{text(collapsed ? "Expand sidebar" : "Collapse sidebar")}</span>
    </button>
  </>;
  const trigger = <button ref={navigationTrigger} type="button" className="admin-navigation-toggle" aria-label={text("Open staff navigation")}
    aria-haspopup="dialog" aria-controls="staff-sidebar" aria-expanded={navigationOpen} onClick={() => setDrawerOpen(true)}><Menu size={21} aria-hidden="true"/></button>;
  return <div className="admin-shell" data-sidebar={compact ? "collapsed" : undefined} data-sidebar-resizing={resizing ? "true" : undefined}
    data-navigation-open={navigationOpen || undefined} style={style}>
    <div className="admin-navigation-scrim" aria-hidden="true" onClick={closeNavigation}/>
    <aside ref={dock} className="admin-sidebar" id="staff-sidebar" inert={narrow && !navigationOpen} role={narrow ? "dialog" : undefined}
      aria-label={narrow ? text("Staff navigation") : undefined} aria-modal={navigationOpen || undefined} onKeyDown={onNavigationKey}>
      <button ref={navigationClose} type="button" className="admin-navigation-close" aria-label={text("Close staff navigation")} onClick={closeNavigation}><X size={21} aria-hidden="true"/></button>
      {sidebar({ closeNavigation, compact, mobile: narrow })}
      {!narrow && controls}
    </aside>
    {children({ trigger, open: navigationOpen, mobile: narrow })}
  </div>;
}
