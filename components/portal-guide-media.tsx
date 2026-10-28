"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Download, ExternalLink, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useSite } from "./site-context";
import { HELP_BUCKET, HELP_FILE_TYPES, helpFileSize, type HelpFile } from "@/lib/portal-help";

export function PortalGuideMedia({ file, close }: { file: HelpFile; close: () => void }) {
  const { accountTask, t } = useSite(), dialog = useRef<HTMLDialogElement>(null), active = useRef(true), id = useId();
  const [links, setLinks] = useState<{ view: string; download: string } | null>(null), [failed, setFailed] = useState(false), [loading, setLoading] = useState(true);
  const [animation, setAnimation] = useState(false);
  const generation = useRef(0), kind = HELP_FILE_TYPES[file.mime_type]?.kind;
  const read = useCallback(async () => {
    const request = ++generation.current;
    try {
      const result = await accountTask(async (db, signal) => {
        const [view, download] = await Promise.all([
          db.storage.from(HELP_BUCKET).createSignedUrl(file.storage_path, 900),
          db.storage.from(HELP_BUCKET).createSignedUrl(file.storage_path, 900, { download: file.original_name }),
        ]);
        signal.throwIfAborted(); if (view.error || download.error || !view.data || !download.data) throw new Error();
        return { view: view.data.signedUrl, download: download.data.signedUrl };
      });
      if (active.current && request === generation.current) { setLinks(result); setFailed(false); }
    } catch { if (active.current && request === generation.current) { setLinks(null); setFailed(true); } }
    finally { if (active.current && request === generation.current) setLoading(false); }
  }, [accountTask, file.original_name, file.storage_path]);
  useEffect(() => {
    active.current = true; const node = dialog.current, previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden"; node?.showModal();
    return () => { active.current = false; node?.close(); document.body.style.overflow = overflow; previous?.focus?.(); };
  }, []);
  useEffect(() => { let cancelled = false; queueMicrotask(() => { if (!cancelled) void read(); }); return () => { cancelled = true; }; }, [read]);
  return <dialog className="help-media-dialog" ref={dialog} aria-modal="true" aria-labelledby={id} onCancel={event => { event.preventDefault(); close(); }} onKeyDown={event => {
    if (event.key === "Escape") event.stopPropagation();
    if (event.key === "Tab") { const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],video,iframe')); const first = buttons[0], last = buttons[buttons.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
  }}>
    <header><div><h2 id={id}>{file.original_name}</h2><small>{helpFileSize(file.size_bytes)} · {t("Private portal resource", "Tài liệu riêng trong cổng")}</small></div><button autoFocus type="button" className="icon-button" aria-label={t("Close viewer", "Đóng trình xem")} onClick={close}><X size={21}/></button></header>
    {loading && <p className="help-loading" role="status"><LoaderCircle size={21} className="spin"/>{t("Opening secure file…", "Đang mở tệp bảo mật…")}</p>}
    {failed && <p className="form-error" role="alert">{t("This file could not be opened. Its link may have expired or your access may have changed.", "Chưa mở được tệp. Liên kết có thể hết hạn hoặc quyền truy cập đã thay đổi.")}</p>}
    {links && <div className="help-media-stage">
      {kind === "video" ? <>
        <video key={links.view} src={links.view} controls playsInline preload="metadata" aria-label={file.original_name} onError={() => setFailed(true)}><a href={links.view}>{t("Open video", "Mở video")}</a></video>
        <p className="help-media-note">{t("Read the guide’s written steps alongside this video. You can also download the original if your browser cannot play its format.", "Đọc hướng dẫn chữ cùng với video. Bạn cũng có thể tải bản gốc nếu trình duyệt không phát được định dạng này.")}</p>
      </> : kind === "pdf" ? <><iframe src={links.view + "#toolbar=1"} title={t("PDF guide: ", "Hướng dẫn PDF: ") + file.original_name} referrerPolicy="no-referrer"/><p className="help-media-note">{t("If the PDF preview is unavailable on your phone, use Open file or Download below.", "Nếu điện thoại không xem trước PDF, hãy dùng Mở tệp hoặc Tải xuống bên dưới.")}</p></> : kind === "animation" ? <>{animation && <img src={links.view} alt={file.original_name} onError={() => setFailed(true)}/>}<button type="button" className="button button-outline" aria-pressed={animation} onClick={() => setAnimation(!animation)}>{animation ? t("Stop animation", "Dừng hoạt ảnh") : t("Play animation", "Xem hoạt ảnh")}</button></> : <img src={links.view} alt={file.original_name} onError={() => setFailed(true)}/>}
    </div>}
    <footer><button type="button" className="text-link" disabled={loading} onClick={() => { setLoading(true); void read(); }}><RefreshCw size={16}/>{t("Refresh access", "Làm mới quyền xem")}</button>{links && <><a className="button button-outline" href={links.view} target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/>{t("Open file", "Mở tệp")}</a><a className="button" href={links.download} rel="noreferrer"><Download size={16}/>{t("Download", "Tải xuống")}</a></>}</footer>
  </dialog>;
}
