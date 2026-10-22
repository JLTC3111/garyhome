"use client";

// Adapted from Magic UI NumberTicker (MIT). See THIRD_PARTY_NOTICES.md.
import { useEffect, useRef, type ComponentPropsWithoutRef } from "react";
import { useInView, useSpring } from "motion/react";
import { useMotionPreference } from "../use-motion-preference";

/** The actual count is always present for SSR and assistive technology. */
export function NumberTicker({ value, className = "", ...props }: ComponentPropsWithoutRef<"span"> & { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduceMotion = useMotionPreference();
  const spring = useSpring(value, { stiffness: 180, damping: 30 });

  useEffect(() => {
    if (!inView || reduceMotion) spring.jump(value);
    else spring.set(value);
  }, [value, inView, reduceMotion, spring]);

  useEffect(() => spring.on("change", latest => {
    if (ref.current) ref.current.textContent = Math.round(latest).toLocaleString("en-US");
  }), [spring]);

  return <span className={`number-ticker ${className}`} {...props}>
    <span ref={ref} aria-hidden="true">{value.toLocaleString("en-US")}</span>
    <span className="sr-only">{value.toLocaleString("en-US")}</span>
  </span>;
}
