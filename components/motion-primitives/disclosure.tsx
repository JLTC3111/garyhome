"use client";

// Motion Primitives disclosure pattern, adapted for controlled, mounted panels.
import { m } from "motion/react";
import { useMotionPreference } from "../use-motion-preference";
import type { ReactNode } from "react";

export function Disclosure({ open, id, labelledBy, children, className = "" }: {
  open: boolean; id: string; labelledBy: string; children: ReactNode; className?: string;
}) {
  const reduceMotion = useMotionPreference();
  return <m.div
    id={id}
    role="region"
    aria-labelledby={labelledBy}
    aria-hidden={!open}
    inert={!open}
    className={`motion-disclosure ${className}`}
    initial={false}
    animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
    transition={{ duration: reduceMotion ? 0 : open ? 0.24 : 0.18, ease: open ? [.2, .72, .28, 1] : [.4, 0, .65, 1] }}
  >{children}</m.div>;
}
