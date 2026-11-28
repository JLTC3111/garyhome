"use client";

import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { useSite } from "./site-context";
import { useStudioText } from "./use-studio-text";

const HOLD_MS = 2000;
const TAP_MS = 250;

type PointerPosition = { clientX: number; clientY: number };
type HoldInput = { pointerId: number } | { key: " " | "Enter" };
type Hold = { input: HoldInput; startedAt: number; timer: ReturnType<typeof setTimeout> };

function insideButton(button: HTMLButtonElement, { clientX, clientY }: PointerPosition) {
  const { left, right, top, bottom } = button.getBoundingClientRect();
  return clientX >= left && clientX <= right && clientY >= top && clientY <= bottom;
}

export function PhotoRemoveButton({ number, disabled, hintId, onRemove }: {
  number: number; disabled: boolean; hintId: string; onRemove: (restoreFocus: boolean) => void;
}) {
  const { t } = useSite();
  const text = useStudioText();
  const [phase, setPhase] = useState<"idle" | "holding" | "confirming">("idle");
  const button = useRef<HTMLButtonElement>(null);
  const confirmation = useRef<HTMLDivElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const hold = useRef<Hold | null>(null);
  const pointerPosition = useRef<PointerPosition>({ clientX: 0, clientY: 0 });
  const ignorePointerClick = useRef(false);
  const remove = useRef(onRemove);
  const confirmationId = useId();

  const clearHold = useCallback(() => {
    const current = hold.current;
    if (!current) return;
    hold.current = null;
    clearTimeout(current.timer);
    if ("pointerId" in current.input && button.current?.hasPointerCapture(current.input.pointerId)) {
      button.current.releasePointerCapture(current.input.pointerId);
    }
    return current;
  }, []);
  const cancelHold = useCallback(() => {
    if (clearHold()) setPhase("idle");
  }, [clearHold]);

  useLayoutEffect(() => { remove.current = onRemove; }, [onRemove]);
  useLayoutEffect(() => () => { clearHold(); }, [clearHold]);
  useLayoutEffect(() => {
    if (phase === "confirming") confirmButton.current?.focus();
  }, [phase]);

  useEffect(() => {
    if (phase !== "holding") return;
    const document = button.current?.ownerDocument;
    const view = document?.defaultView;
    if (!view || !document) return;
    const onVisibilityChange = () => { if (document.hidden) cancelHold(); };
    view.addEventListener("blur", cancelHold);
    view.addEventListener("scroll", cancelHold, true);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      view.removeEventListener("blur", cancelHold);
      view.removeEventListener("scroll", cancelHold, true);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [cancelHold, phase]);

  function confirmRemoval() {
    const target = button.current;
    if (!target || target.disabled || target.closest("[inert]")) return;
    const focused = target.ownerDocument.activeElement;
    setPhase("idle");
    remove.current(focused === target || !!confirmation.current?.contains(focused));
  }

  function beginHold(input: HoldInput) {
    if (disabled || hold.current) return false;
    const current: Hold = { input, startedAt: performance.now(), timer: setTimeout(complete, HOLD_MS) };
    hold.current = current;
    setPhase("holding");
    function complete() {
      if (hold.current !== current) return;
      const remaining = HOLD_MS - (performance.now() - current.startedAt);
      if (remaining > 0) {
        current.timer = setTimeout(complete, Math.ceil(remaining));
        return;
      }
      const target = button.current;
      cancelHold();
      if (!target || target.ownerDocument.hidden || ("pointerId" in input && !insideButton(target, pointerPosition.current))) return;
      confirmRemoval();
    }
    return true;
  }

  function endPointer(event: PointerEvent<HTMLButtonElement>, canTap = false) {
    const current = hold.current;
    if (!current || !("pointerId" in current.input) || current.input.pointerId !== event.pointerId) return;
    ignorePointerClick.current = !canTap || performance.now() - current.startedAt >= TAP_MS;
    cancelHold();
  }

  function closeConfirmation() {
    setPhase("idle");
    button.current?.focus({ preventScroll: true });
  }

  const confirming = phase === "confirming";
  const icon = <Trash2 size={16} aria-hidden="true"/>;
  return <>
    <button ref={button} type="button" className="editor-photo-remove" data-button-variant="danger" data-button-size="icon"
      data-holding={phase === "holding" || undefined} disabled={disabled} aria-describedby={hintId}
      aria-label={text("Remove photo {number}", { number })} aria-expanded={confirming} aria-controls={confirming ? confirmationId : undefined}
      title={t("Hold for 2 seconds to remove", "Nhấn giữ 2 giây để gỡ ảnh")}
      style={{ "--photo-hold-duration": `${HOLD_MS}ms` } as CSSProperties}
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary || !beginHold({ pointerId: event.pointerId })) return;
        pointerPosition.current = { clientX: event.clientX, clientY: event.clientY };
        ignorePointerClick.current = true;
        try { event.currentTarget.setPointerCapture(event.pointerId); }
        catch { cancelHold(); }
      }}
      onPointerMove={event => {
        const input = hold.current?.input;
        if (!input || !("pointerId" in input) || input.pointerId !== event.pointerId) return;
        if (!(event.buttons & 1) || !insideButton(event.currentTarget, event)) endPointer(event);
        else pointerPosition.current = { clientX: event.clientX, clientY: event.clientY };
      }}
      onPointerUp={event => endPointer(event, insideButton(event.currentTarget, event))}
      onPointerLeave={event => endPointer(event)}
      onPointerCancel={event => endPointer(event)}
      onLostPointerCapture={event => endPointer(event)}
      onBlur={cancelHold}
      onContextMenu={event => event.preventDefault()}
      onClick={event => {
        if (!disabled && !hold.current && (event.detail === 0 || !ignorePointerClick.current)) setPhase("confirming");
      }}
      onKeyDown={event => {
        if (event.key === "Escape" && hold.current) {
          event.preventDefault();
          event.stopPropagation();
          cancelHold();
        }
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault();
        if (!event.repeat) beginHold({ key: event.key });
      }}
      onKeyUp={event => {
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault();
        const current = hold.current;
        if (!current || !("key" in current.input) || current.input.key !== event.key) return;
        cancelHold();
        if (performance.now() - current.startedAt < TAP_MS) setPhase("confirming");
      }}>
      {icon}
      <span className="editor-photo-remove-fill" aria-hidden="true">{icon}</span>
      <span className="editor-photo-remove-crest" aria-hidden="true">{icon}</span>
    </button>
    {confirming && <div ref={confirmation} id={confirmationId} className="editor-photo-remove-confirmation"
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPhase("idle"); }}
      onKeyDown={event => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        closeConfirmation();
      }}>
      <button ref={confirmButton} type="button" className="text-link text-danger" onClick={confirmRemoval}
        aria-label={t(`Confirm removal of photo ${number}`, `Xác nhận gỡ ảnh ${number}`)}>{t("Confirm removal", "Xác nhận gỡ ảnh")}</button>
      <button type="button" className="text-link" onClick={closeConfirmation}>{text("Cancel")}</button>
    </div>}
  </>;
}
