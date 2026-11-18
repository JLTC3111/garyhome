"use client";

import { useEffect, type RefObject } from "react";
import { usePresence } from "motion/react";

export function useOverlayExit(ref: RefObject<HTMLElement | null>, property = "opacity") {
  const [present, remove] = usePresence();
  useEffect(() => {
    if (present || !remove) return;
    const node = ref.current;
    if (property === "transform") node?.getBoundingClientRect?.();
    const transition = node?.getAnimations?.().find(animation =>
      "transitionProperty" in animation && animation.transitionProperty === property
    );
    if (!transition) { remove(); return; }
    let current = true;
    const finish = () => { if (current) remove(); };
    void transition.finished.then(finish, finish);
    return () => { current = false; };
  }, [present, remove, ref, property]);
  return !present;
}
