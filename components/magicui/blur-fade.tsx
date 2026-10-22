"use client";

// Adapted from Magic UI BlurFade (MIT). See THIRD_PARTY_NOTICES.md.
import { useEffect, useRef, type HTMLAttributes } from "react";
import { useInView } from "motion/react";
import { useMotionPreference } from "../use-motion-preference";

/** A progressive reveal: content remains visible during SSR and without JS. */
export function BlurFade({ children, delay = 0, className = "", ...props }: HTMLAttributes<HTMLDivElement> & { delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -24px 0px" });
  const reduceMotion = useMotionPreference();

  useEffect(() => {
    const element = ref.current;
    if (!inView || reduceMotion || !element?.animate) return;
    const animation = element.animate([
      { opacity: 0.55, transform: "translateY(12px)", filter: "blur(3px)" },
      { opacity: 1, transform: "translateY(0)", filter: "blur(0px)" },
    ], { duration: 420, delay: Math.min(delay, 0.18) * 1000, easing: "cubic-bezier(.22,1,.36,1)", fill: "backwards" });
    return () => animation.cancel();
  }, [inView, reduceMotion, delay]);

  return <div ref={ref} className={`blur-fade ${className}`} {...props}>{children}</div>;
}
