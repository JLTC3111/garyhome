"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { RefreshCw, X } from "lucide-react";
import { SitePreferences } from "./site-preferences";
import { useOverlayExit } from "./motion-primitives/overlay-exit";
import { useSite } from "./site-context";
import { useStudioText } from "./use-studio-text";
import { attachEditorWorkspace } from "../shared/editor-workspace/index.js";

/** Home keeps its full-height right drawer around the current form content. */
export function EditorModal({ title, subtitle, close, children, workspaceKey = "content", closeDisabled = false, resizable = false, contentClassName = "" }: {
  title: string; subtitle: string; close: () => void; children: ReactNode; workspaceKey?: string; closeDisabled?: boolean; resizable?: boolean; contentClassName?: string;
}) {
  const text = useStudioText(), { language, sessionPhase, reconnect } = useSite();
  const dock = useRef<HTMLDivElement>(null), overlay = useRef<HTMLDivElement>(null), languageRef = useRef(language), titleId = useId();
  const exiting = useOverlayExit(overlay);
  // Capture before the commit-phase Close autofocus moves focus into the editor.
  const opener = useRef<HTMLElement | null>(typeof document !== "undefined" && typeof HTMLElement !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  languageRef.current = language;
  const workspace = useRef<ReturnType<typeof attachEditorWorkspace> | null>(null);
  useEffect(() => {
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const element = dock.current;
    if (element) workspace.current = attachEditorWorkspace(element, {key:`gary-home:${workspaceKey}`,language:()=>languageRef.current,header:element.querySelector<HTMLElement>(".gw-editor-header")!,body:element.querySelector<HTMLElement>(".gw-editor-body")!,anchor:"right",presentation:"drawer",resizeEdges:["w"],defaultWidth:workspaceKey==="property"?1120:740});
    return () => { workspace.current?.destroy(); workspace.current = null; document.body.style.overflow = old; if (opener.current?.isConnected) opener.current.focus(); };
  }, [workspaceKey]);
  useEffect(() => { workspace.current?.refresh(); }, [language]);
  const requestClose = () => { if (!closeDisabled && !exiting) close(); };
  return <div className="editor-overlay" ref={overlay} data-ui-exiting={exiting || undefined} onClick={event => { if (event.currentTarget === event.target) requestClose(); }}>
    <div ref={dock} inert={exiting} className="editor-dock editor-dock--resizable" role="dialog" aria-modal="true" aria-labelledby={titleId}
      onKeyDown={event => {
        if (event.key === "Escape") { event.stopPropagation(); requestClose(); }
        if (event.key !== "Tab") return;
        const nodes = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]')).filter(node => node.getClientRects().length > 0);
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      {resizable && <div className="editor-flowing-edge" aria-hidden="true"/>}
      <section className={`editor-drawer ${contentClassName}`}><header className="gw-editor-header"><div><div className="eyebrow">{subtitle}</div><h2 id={titleId}>{title}</h2></div>
        <div className="editor-toolbar gw-editor-controls">{["offline", "error"].includes(sessionPhase) && <button type="button" className="icon-button" aria-label={text("Reconnect")} title={text("Reconnect")} onClick={() => void reconnect()}><RefreshCw size={17}/></button>}
          <SitePreferences studio/><button autoFocus type="button" className="icon-button" disabled={closeDisabled} onClick={requestClose} aria-label={text("Close editor")}><X/></button>
        </div></header><div className="gw-editor-body editor-scroll-body">{children}</div></section>
    </div>
  </div>;
}
