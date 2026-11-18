"use client";

import { useEffect, type RefObject } from "react";
import { usePresence } from "motion/react";

export function useOverlayExit(ref: RefObject<HTMLElement | null>) {
  const [present, remove] = usePresence();
  useEffect(() => {
    if (present || !remove) return;
    const fade = ref.current?.getAnimations?.().find(animation =>
      "transitionProperty" in animation && animation.transitionProperty === "opacity"
    );
    if (!fade) { remove(); return; }
    let current = true;
    const finish = () => { if (current) remove(); };
    void fade.finished.then(finish, finish);
    return () => { current = false; };
  }, [present, remove, ref]);
  return !present;
}
