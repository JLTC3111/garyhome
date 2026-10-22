"use client";

// Adapted from ibelick/motion-primitives AnimatedBackground (MIT).
// Controlled selection preserves each child's handlers, state and semantics.
import { Children, cloneElement, useId, type ReactElement, type ReactNode } from "react";
import { AnimatePresence, m } from "motion/react";
import { useMotionPreference } from "../use-motion-preference";

type SelectionItem = ReactElement<{ "data-id": string; className?: string; children?: ReactNode }>;

export function AnimatedBackground({ children, activeValue }: { children: SelectionItem | SelectionItem[]; activeValue: string }) {
  const id = useId();
  const reduceMotion = useMotionPreference();

  return Children.map(children, child => cloneElement(child, {
    className: `${child.props.className || ""} animated-selection`,
  }, <>
    <AnimatePresence initial={false}>
      {child.props["data-id"] === activeValue && <m.i
        key="selection"
        aria-hidden="true"
        className="selection-background"
        layoutId={reduceMotion ? undefined : `selection-${id}`}
        initial={false}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 36 }}
      />}
    </AnimatePresence>
    {child.props.children}
  </>));
}
