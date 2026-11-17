"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";

const STORAGE_KEY = "gary-home-studio-sidebar";
const MIN_WIDTH = 248;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 272;

type Text = (message: string) => string;

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

export function StudioShell({ children, text }: { children: ReactNode; text: Text }) {
  const shell = useRef<HTMLDivElement>(null);
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
  const [dock, setDock] = useState<HTMLElement | null>(null);

  function remember(nextWidth = widthRef.current, nextCollapsed = collapsedRef.current, nextCustom = customRef.current) {
    widthRef.current = nextWidth;
    collapsedRef.current = nextCollapsed;
    customRef.current = nextCustom;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...(nextCustom ? { width: nextWidth } : {}), collapsed: nextCollapsed }));
    } catch { /* Preference storage is optional. */ }
  }

  useLayoutEffect(() => {
    setDock(shell.current?.querySelector<HTMLElement>("#staff-sidebar") ?? null);
    const saved = readSidebar();
    let nextWidth = saved.width;
    if (!saved.custom) {
      const measured = Math.round(shell.current?.querySelector<HTMLElement>("#staff-sidebar")?.getBoundingClientRect().width || 0);
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
      setNarrow(window.matchMedia("(max-width: 680px)").matches);
      if (!customRef.current && !collapsedRef.current) {
        const measured = Math.round(shell.current?.querySelector<HTMLElement>("#staff-sidebar")?.getBoundingClientRect().width || 0);
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
    const measured = Math.round(shell.current?.querySelector<HTMLElement>("#staff-sidebar")?.getBoundingClientRect().width || widthRef.current);
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
    const measured = Math.round(shell.current?.querySelector<HTMLElement>("#staff-sidebar")?.getBoundingClientRect().width || widthRef.current);
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
  const style = custom && !collapsed && !narrow ? { "--studio-sidebar-width": `${shown}px` } as CSSProperties : undefined;
  const controls = <>
    {!collapsed && <button type="button" className="admin-sidebar-resize" role="separator" aria-orientation="vertical" aria-label={text("Resize sidebar")} aria-valuemin={MIN_WIDTH} aria-valuemax={limit} aria-valuenow={shown} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onKeyDown={onResizeKey} onDoubleClick={resetWidth}/>}
    <button type="button" className="admin-sidebar-collapse" aria-controls="staff-sidebar" aria-expanded={!collapsed} onClick={toggle}>
      {collapsed ? <ChevronRight size={16} aria-hidden="true"/> : <ChevronLeft size={16} aria-hidden="true"/>}
      <span className="sr-only">{text(collapsed ? "Expand sidebar" : "Collapse sidebar")}</span>
    </button>
  </>;
  return <div ref={shell} className="admin-shell" data-sidebar={collapsed ? "collapsed" : undefined} data-sidebar-resizing={resizing ? "true" : undefined} style={style}>
    {children}
    {dock && createPortal(controls, dock)}
  </div>;
}
