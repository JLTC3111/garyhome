"use client";

import { LazyMotion, MotionConfig, domAnimation } from "motion/react";
import type { ReactNode } from "react";
import { useMotionPreference } from "./use-motion-preference";

export function InteractionProvider({ children }: { children: ReactNode }) {
  const reduceMotion = useMotionPreference();
  return <MotionConfig reducedMotion={reduceMotion ? "always" : "never"}>
    <LazyMotion features={domAnimation} strict>{children}</LazyMotion>
  </MotionConfig>;
}
