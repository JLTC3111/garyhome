"use client";

// Adapted from React Bits SpotlightCard by David Haz.
// Source and license: docs/ui-components.md and THIRD_PARTY_NOTICES.md.
import type { HTMLAttributes, PointerEvent } from "react";
import { useMotionPreference } from "../use-motion-preference";

export function SpotlightCard({ children, className = "", onPointerMove, ...props }: HTMLAttributes<HTMLDivElement>) {
  const reduceMotion = useMotionPreference();

  function move(event: PointerEvent<HTMLDivElement>) {
    onPointerMove?.(event);
    if (reduceMotion || event.pointerType !== "mouse") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--spotlight-x", `${event.clientX - bounds.left}px`);
    event.currentTarget.style.setProperty("--spotlight-y", `${event.clientY - bounds.top}px`);
  }

  return <div className={`spotlight-card ${className}`} onPointerMove={move} {...props}>
    <span className="spotlight-light" aria-hidden="true"/>
    {children}
  </div>;
}
