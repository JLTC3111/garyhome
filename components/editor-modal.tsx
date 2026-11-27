"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Ellipsis, RefreshCw, X } from "lucide-react";
import { ListingCopyButton } from "./listing-copy-button";
import { SitePreferences } from "./site-preferences";
import { useOverlayExit } from "./motion-primitives/overlay-exit";
import { useSite } from "./site-context";
import { useStudioText } from "./use-studio-text";
import { attachEditorWorkspace } from "../shared/editor-workspace/index.js";

const COMPACT_EDITOR = "(max-width: 768px)";

/** Home keeps its full-height right drawer around the current form content. */
export function EditorModal({ title, subtitle, close, children, workspaceKey = "content", closeDisabled = false, resizable = false, contentClassName = "", listingCode }: {
  title: string; subtitle: string; close: () => void; children: ReactNode; workspaceKey?: string; closeDisabled?: boolean; resizable?: boolean; contentClassName?: string; listingCode?: string | null;
}) {
  const text = useStudioText(), { language, sessionPhase, reconnect, t } = useSite();
  const dock = useRef<HTMLDivElement>(null), overlay = useRef<HTMLDivElement>(null), languageRef = useRef(language), titleId = useId();
  const closeButton = useRef<HTMLButtonElement>(null);
  const listingDrawer = workspaceKey === "property";
  const heading = listingDrawer && !title.trim() ? t("New listing", "Tin đăng mới") : title;
  const [entered, setEntered] = useState(false);
  const exiting = useOverlayExit(listingDrawer ? dock : overlay, listingDrawer ? "transform" : "opacity");
  // Capture before the commit-phase Close autofocus moves focus into the editor.
  const opener = useRef<HTMLElement | null>(typeof document !== "undefined" && typeof HTMLElement !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const workspace = useRef<ReturnType<typeof attachEditorWorkspace> | null>(null);
  useLayoutEffect(() => { languageRef.current = language; }, [language]);
  useLayoutEffect(() => {
    const node = dock.current;
    const view = node?.ownerDocument?.defaultView;
    if (!listingDrawer || !node || !view) return;
    // Commit the offscreen transform before changing it on the next frame.
    node.getBoundingClientRect();
    closeButton.current?.focus({ preventScroll: true });
    const frame = view.requestAnimationFrame(() => setEntered(true));
    return () => view.cancelAnimationFrame(frame);
  }, [listingDrawer]);
  useEffect(() => {
    const old = document.body.style.overflow;
    const restoreFocusTo = opener.current;
    document.body.style.overflow = "hidden";
    const element = dock.current;
    if (element) workspace.current = attachEditorWorkspace(element, {key:`gary-home:${workspaceKey}`,language:()=>languageRef.current,header:element.querySelector<HTMLElement>(".gw-editor-header")!,body:element.querySelector<HTMLElement>(".gw-editor-body")!,anchor:"right",presentation:"drawer",resizeEdges:["w"],defaultWidth:workspaceKey==="property"?1120:740});
    return () => { workspace.current?.destroy(); workspace.current = null; document.body.style.overflow = old; if (restoreFocusTo?.isConnected) restoreFocusTo.focus({ preventScroll: true }); };
  }, [workspaceKey]);
  useEffect(() => { workspace.current?.refresh(); }, [language]);
  useEffect(() => {
    const node = dock.current, view = node?.ownerDocument.defaultView, viewport = view?.visualViewport;
    if (!listingDrawer || !node || !view || !viewport) return;
    const compact = view.matchMedia(COMPACT_EDITOR);
    const body = node.querySelector<HTMLElement>(".editor-scroll-body");
    const followViewport = () => {
      const offset = compact.matches && viewport.scale === 1 ? viewport.offsetTop : 0;
      node.style.setProperty("--listing-viewport-top", `${offset}px`);
    };
    const fitKeyboard = () => {
      followViewport();
      const keyboard = compact.matches && viewport.scale === 1 && view.innerHeight - viewport.height > 100;
      node.toggleAttribute("data-listing-keyboard", keyboard);
      const focused = node.ownerDocument.activeElement;
      if (!keyboard || !body || !focused || !body.contains(focused) || !focused.matches('input:not([readonly]), textarea:not([readonly])')) return;
      const field = focused.getBoundingClientRect(), visible = body.getBoundingClientRect();
      if (field.top < visible.top + 8) body.scrollTop += field.top - visible.top - 8;
      else if (field.bottom > visible.bottom - 8) body.scrollTop += Math.min(field.bottom - visible.bottom + 8, field.top - visible.top - 8);
    };
    fitKeyboard();
    viewport.addEventListener("scroll", followViewport);
    viewport.addEventListener("resize", fitKeyboard);
    view.addEventListener("resize", fitKeyboard);
    node.addEventListener("focusin", fitKeyboard);
    return () => {
      viewport.removeEventListener("scroll", followViewport);
      viewport.removeEventListener("resize", fitKeyboard);
      view.removeEventListener("resize", fitKeyboard);
      node.removeEventListener("focusin", fitKeyboard);
    };
  }, [listingDrawer]);
  const requestClose = () => { if (!closeDisabled && !exiting) close(); };
  const secondaryActions = <>{["offline", "error"].includes(sessionPhase) && <button type="button" className="icon-button listing-reconnect" aria-label={text("Reconnect")} title={text("Reconnect")} onClick={() => void reconnect()}><RefreshCw size={17}/>{listingDrawer && <span className="listing-tool-label">{text("Reconnect")}</span>}</button>}
    <SitePreferences studio triggerText={listingDrawer ? t("Preferences", "Tùy chọn") : undefined}/></>;
  return <div className="editor-overlay" ref={overlay} data-listing-drawer={listingDrawer || undefined} data-listing-entered={listingDrawer && entered || undefined} data-ui-exiting={exiting || undefined} onClick={event => { if (event.currentTarget === event.target) requestClose(); }}>
    <div ref={dock} inert={exiting} className="editor-dock editor-dock--resizable" role="dialog" aria-modal="true" aria-labelledby={titleId}
      onKeyDown={event => {
        if (event.key === "Escape") { event.stopPropagation(); requestClose(); }
        if (event.key !== "Tab") return;
        const nodes = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], summary, [tabindex="0"]')).filter(node => node.tabIndex >= 0 && !node.closest("[inert],[hidden]") && node.getClientRects().length > 0);
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      {resizable && <div className="editor-flowing-edge" aria-hidden="true"/>}
      <section className={`editor-drawer ${contentClassName}`}><header className="gw-editor-header"><div><div className="eyebrow">{subtitle}{listingDrawer && listingCode && <span className="listing-editor-code"> · <b>{listingCode}</b></span>}</div><h2 id={titleId}>{heading}</h2></div>
        <div className="editor-toolbar gw-editor-controls">{listingDrawer ? <ListingEditorTools title={title}>{secondaryActions}</ListingEditorTools> : secondaryActions}
          <button ref={closeButton} autoFocus={!listingDrawer} type="button" className="icon-button" disabled={closeDisabled} onClick={requestClose} aria-label={text("Close editor")}><X/></button>
        </div></header><div className="gw-editor-body editor-scroll-body">{children}</div></section>
    </div>
  </div>;
}

function ListingEditorTools({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useSite();
  const [open, setOpen] = useState(false);
  const id = useId();
  const tools = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const node = tools.current;
    if (!open || !node) return;
    const outside = (event: PointerEvent) => { if (!node.contains(event.target as Node)) setOpen(false); };
    const media = node.ownerDocument.defaultView?.matchMedia(COMPACT_EDITOR);
    const resize = () => { if (!media?.matches) setOpen(false); };
    node.ownerDocument.addEventListener("pointerdown", outside);
    media?.addEventListener("change", resize);
    return () => {
      node.ownerDocument.removeEventListener("pointerdown", outside);
      media?.removeEventListener("change", resize);
    };
  }, [open]);
  const label = t("Full title", "Tiêu đề đầy đủ");
  return <div className="listing-editor-tools" ref={tools} onBlur={event => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={event => {
    if (!open || event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }}>
    <button ref={trigger} type="button" className="icon-button listing-editor-tools-toggle" aria-label={t("More actions", "Thao tác khác")}
      aria-controls={id} aria-expanded={open} onClick={() => setOpen(previous => !previous)}><Ellipsis size={21} aria-hidden="true"/></button>
    <div id={id} className="listing-editor-tools-panel" data-open={open || undefined}>
      {title.trim() && <details className="listing-title-inspector"><summary>{label}<ChevronDown size={16} aria-hidden="true"/></summary>
        <textarea ref={field} className="listing-title-value" value={title} readOnly rows={3} aria-label={label}/>
        <ListingCopyButton value={title} label={t("Copy title", "Sao chép tiêu đề")} field={field}/>
      </details>}
      {children}
    </div>
  </div>;
}
