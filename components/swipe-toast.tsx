"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import SwipeRow from "./react-bits/swipe-row";

export function SwipeToast({ children, dismiss, dismissLabel, actionsLabel, releaseLabel, hostClassName = "toast", duration = 0 }: {
  children: ReactNode; dismiss: () => void; dismissLabel: string; actionsLabel: string; releaseLabel: string;
  hostClassName?: string; duration?: number;
}) {
  const latestDismiss = useRef(dismiss);
  useEffect(() => { latestDismiss.current = dismiss; }, [dismiss]);
  const remaining = useRef(duration);
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false), [open, setOpen] = useState(false), [hidden, setHidden] = useState(false);
  const paused = hovered || focused || dragging || open || hidden;
  useEffect(() => {
    const visibility = () => setHidden(document.visibilityState === "hidden");
    visibility(); document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);
  useEffect(() => {
    if (!duration || paused) return;
    const started = Date.now(), timer = setTimeout(() => latestDismiss.current(), remaining.current);
    return () => { clearTimeout(timer); remaining.current = Math.max(0, remaining.current - (Date.now() - started)); };
  }, [duration, paused]);

  return <div className={hostClassName} role="status" aria-live="polite" aria-atomic="true"
    onPointerEnter={event => { if (event.pointerType !== "touch") setHovered(true); }} onPointerLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <SwipeRow label={actionsLabel} actionsLabel={actionsLabel} releaseLabel={releaseLabel}
      actions={[{ id: "dismiss", label: dismissLabel, icon: <X size={18}/>, dismiss: true }]}
      onCommit={dismiss} onOpenChange={setOpen} onInteractionChange={setDragging}
      rowColor="var(--toast-background, #263d31)" textColor="var(--toast-color, #ffffff)" actionColor="#476149"
      style={{ "--sr-h": "auto" } as React.CSSProperties} haptic={false}>
      <span className="swipe-toast-message">{children}</span>
      <button type="button" className="swipe-toast-close" aria-label={dismissLabel} onClick={dismiss}><X size={18}/></button>
    </SwipeRow>
  </div>;
}
