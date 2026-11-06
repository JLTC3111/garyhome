"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { GripVertical, Maximize2, Minimize2, RefreshCw, X } from "lucide-react";
import { LanguageSwitcher } from "./language-switcher";
import { useSite } from "./site-context";
import { useStudioText } from "./use-studio-text";

export function editorWidth(width: number, viewport: number) {
  const maximum = Math.max(0, viewport - 24);
  return Math.min(maximum, Math.max(Math.min(640, maximum), width));
}

export function EditorModal({ title, subtitle, close, children, resizable = false }: {
  title: string; subtitle: string; close: () => void; children: ReactNode; resizable?: boolean;
}) {
  const viewport = useSyncExternalStore(callback => { window.addEventListener("resize", callback); return () => window.removeEventListener("resize", callback); }, () => window.innerWidth || 1200, () => 1200);
  const text = useStudioText(), { sessionPhase, reconnect } = useSite();
  const [width, setWidth] = useState<number | null>(null), [fullScreen, setFullScreen] = useState(false);
  const dock = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; width: number; cursor: string; select: string } | null>(null);
  const stopDrag = () => {
    if (!drag.current) return;
    document.body.style.cursor = drag.current.cursor; document.body.style.userSelect = drag.current.select; drag.current = null;
  };
  useEffect(() => {
    const old = document.body.style.overflow, focused = document.activeElement;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = old; stopDrag(); if (focused instanceof HTMLElement && focused.isConnected) focused.focus(); };
  }, []);
  useEffect(() => {
    const resize = () => setWidth(current => current === null ? null : editorWidth(current, window.innerWidth));
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  return <div className="editor-overlay" onClick={event => { if (event.currentTarget === event.target) close(); }}>
    <div ref={dock} className={`editor-dock${resizable ? " editor-dock--resizable" : ""}${fullScreen ? " editor-dock--fullscreen" : ""}`}
      style={width === null ? undefined : { "--editor-width": `${width}px` } as CSSProperties}
      role="dialog" aria-modal="true" aria-labelledby="editor-title"
      onKeyDown={event => {
        if (event.key === "Escape") { event.stopPropagation(); close(); }
        if (event.key !== "Tab") return;
        const nodes = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]')).filter(node => node.getClientRects().length > 0);
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      {resizable && !fullScreen && <><div className="editor-flowing-edge" aria-hidden="true"/>
        <button type="button" role="separator" aria-orientation="vertical" aria-label={text("Resize listing editor")}
          aria-valuemin={Math.min(640, viewport - 24)} aria-valuemax={viewport - 24} aria-valuenow={editorWidth(width ?? 1120, viewport)}
          aria-valuetext={text("Drag to resize, or use the left and right arrow keys")}
          className="editor-resize-handle" title={text("Drag to resize, or use the left and right arrow keys")}
          onPointerDown={event => {
            if (event.button !== 0) return;
            event.preventDefault(); event.currentTarget.focus();
            drag.current = { x: event.clientX, width: dock.current?.getBoundingClientRect().width ?? 1120, cursor: document.body.style.cursor, select: document.body.style.userSelect };
            document.body.style.cursor = "ew-resize"; document.body.style.userSelect = "none"; event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => { if (drag.current) setWidth(editorWidth(drag.current.width + drag.current.x - event.clientX, window.innerWidth)); }}
          onPointerUp={event => { stopDrag(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
          onPointerCancel={stopDrag} onLostPointerCapture={stopDrag}
          onKeyDown={event => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const current = dock.current?.getBoundingClientRect().width ?? 1120, step = event.shiftKey ? 64 : 32;
            setWidth(editorWidth(event.key === "Home" ? 640 : event.key === "End" ? window.innerWidth - 24 : current + (event.key === "ArrowLeft" ? step : -step), window.innerWidth));
          }}><GripVertical size={18}/></button></>}
      <section className="editor-drawer"><header><div><div className="eyebrow">{subtitle}</div><h2 id="editor-title">{title}</h2></div>
        <div className="editor-toolbar">{["offline", "error"].includes(sessionPhase) && <button type="button" className="icon-button" aria-label={text("Reconnect")} title={text("Reconnect")} onClick={() => void reconnect()}><RefreshCw size={17}/></button>}
          <LanguageSwitcher/>{resizable && <button type="button" className="icon-button editor-expand-button" aria-label={text(fullScreen ? "Exit full screen" : "Full-screen editor")} title={text(fullScreen ? "Exit full screen" : "Full-screen editor")} aria-pressed={fullScreen} onClick={() => { stopDrag(); setFullScreen(value => !value); }}>{fullScreen ? <Minimize2 size={19}/> : <Maximize2 size={19}/>}</button>}
          <button autoFocus type="button" className="icon-button" onClick={close} aria-label={text("Close editor")}><X/></button>
        </div></header>{children}</section>
    </div>
  </div>;
}
