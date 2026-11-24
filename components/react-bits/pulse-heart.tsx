"use client";

// Adapted from React Bits Pulse Heart. See THIRD_PARTY_NOTICES.md.
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode, type Ref } from "react";
import { useMotionPreference } from "../use-motion-preference";

const FLIP = 0.4;

const back = (progress: number, overshoot: number) => {
  const offset = progress - 1;
  return 1 + (overshoot + 1) * offset ** 3 + overshoot * offset ** 2;
};
const swellOf = (progress: number, overshoot: number) =>
  progress <= 0 ? 0 : progress < FLIP ? 1 - (1 - progress / FLIP) ** 3 : 1 - back((progress - FLIP) / (1 - FLIP), overshoot);

type MotionNode = {
  dataset: Record<string, string | undefined>;
  style: CSSStyleDeclaration;
  getBoundingClientRect: () => DOMRect;
};

type PulseHeartProps = {
  liked: boolean;
  pending?: boolean;
  onChange?: (liked: boolean) => void;
  showCount?: boolean;
  icon: (filled: boolean) => ReactNode;
  disabled?: boolean;
  label: string;
  className?: string;
  duration?: number;
  dotSize?: number;
  overshoot?: number;
  beat?: number;
};

function writeScale(node: MotionNode | null, value: string | null) {
  if (!node) return;
  if (value === null) node.style.removeProperty("transform");
  else node.style.setProperty("transform", value, "important");
}

export default function PulseHeart({
  liked, pending = false, onChange, showCount = false, icon, disabled = false, label, className = "",
  duration = 560, dotSize = 0.3, overshoot = 1.7, beat = 3,
}: PulseHeartProps) {
  const reduced = useMotionPreference();
  const [shown, setShown] = useState(liked);
  const [attempt, setAttempt] = useState(0);
  const rootRef = useRef<MotionNode | null>(null);
  const heartRef = useRef<MotionNode | null>(null);
  const raf = useRef(0);
  const viaPointer = useRef(false);
  const anticipated = useRef<boolean | null>(null);
  const shownRef = useRef(shown);
  const likedRef = useRef(liked);
  const pendingRef = useRef(pending);
  const reducedRef = useRef(reduced);
  const motion = useRef({ duration, dotSize, overshoot, beat });
  likedRef.current = liked;
  pendingRef.current = pending;
  reducedRef.current = reduced;
  motion.current = { duration, dotSize, overshoot, beat };

  const syncShown = (next: boolean, instant: boolean) => {
    if (shownRef.current === next) return;
    shownRef.current = next;
    if (instant && rootRef.current) rootRef.current.dataset.instant = "";
    setShown(next);
  };

  const clearMotion = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = 0;
    writeScale(rootRef.current, null);
    if (heartRef.current) heartRef.current.style.transform = "";
    if (rootRef.current) delete rootRef.current.dataset.running;
  };

  const finish = () => {
    raf.current = 0;
    writeScale(rootRef.current, null);
    if (heartRef.current) heartRef.current.style.transform = "";
    if (rootRef.current) delete rootRef.current.dataset.running;
    const confirmed = likedRef.current;
    const target = anticipated.current;
    if (target !== null && pendingRef.current && confirmed !== target) return;
    if (shownRef.current !== confirmed) syncShown(confirmed, true);
    if (target !== null && (confirmed === target || !pendingRef.current)) anticipated.current = null;
  };

  const run = (nextLiked: boolean) => {
    const root = rootRef.current;
    const heart = heartRef.current;
    if (!root || !heart) return;
    root.dataset.running = "";
    let swapped = false;
    let previous = 0;
    const started = performance.now();
    const tick = (now: number) => {
      if (reducedRef.current) { clearMotion(); syncShown(likedRef.current, true); return; }
      const { duration: length, dotSize: dot, overshoot: rebound, beat: dip } = motion.current;
      const progress = Math.min(1, (now - started) / length);
      const step = previous ? now - previous : 1000 / 60;
      previous = now;
      const swell = swellOf(progress, rebound);
      heart.style.transform = `scale(${1 - (1 - dot) * swell})`;
      const pressed = root.dataset.pressed !== undefined ? 0.97 : 1;
      writeScale(root, `scale(${(1 - (dip / 100) * swell) * pressed})`);
      if (!swapped && progress + step / 2 / length >= FLIP) {
        swapped = true;
        root.dataset.liked = String(nextLiked);
        shownRef.current = nextLiked;
        setShown(nextLiked);
      }
      if (progress < 1) { raf.current = requestAnimationFrame(tick); return; }
      finish();
    };
    raf.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    if (reduced) {
      clearMotion();
      anticipated.current = null;
      syncShown(liked, true);
      return;
    }
    const target = anticipated.current;
    if (target !== null && liked !== target && !pending) {
      anticipated.current = null;
      clearMotion();
      syncShown(liked, true);
      return;
    }
    if (raf.current) return;
    if (target !== null && pending && liked !== target) return;
    if (target !== null && liked === target) anticipated.current = null;
    if (shownRef.current !== liked) syncShown(liked, true);
    // attempt changes on every press so a rejected toggle is reconciled even when
    // the confirmed favourite and pending flag stay the same.
  }, [liked, pending, reduced, attempt]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || root.dataset.instant === undefined) return;
    root.getBoundingClientRect();
    delete root.dataset.instant;
  }, [shown]);

  useEffect(() => () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = 0;
  }, []);

  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  const release = () => {
    const root = rootRef.current;
    if (root) delete root.dataset.pressed;
    if (!raf.current) writeScale(root, null);
  };
  const press = (event: PointerEvent<HTMLButtonElement>) => {
    stop(event);
    if (event.button !== 0 || disabled) return;
    viaPointer.current = true;
    if (!reducedRef.current && rootRef.current) {
      rootRef.current.dataset.pressed = "";
      writeScale(rootRef.current, "scale(0.97)");
    }
  };
  const activate = (event: { detail?: number; stopPropagation: () => void }) => {
    stop(event);
    const pointer = viaPointer.current && event.detail !== 0;
    viaPointer.current = false;
    if (disabled || raf.current || anticipated.current !== null) return;
    const next = !liked;
    anticipated.current = next;
    onChange?.(next);
    setAttempt(value => value + 1);
    if (pointer && !reducedRef.current) run(next);
    else release();
  };

  return (
    <button
      ref={rootRef as Ref<HTMLButtonElement>}
      type="button"
      className={["save-button", "pulse-heart", shown ? "is-saved" : "", className].filter(Boolean).join(" ")}
      data-button-variant="save"
      data-liked={String(shown)}
      data-no-count={showCount ? undefined : ""}
      aria-pressed={liked}
      aria-busy={pending}
      aria-label={label}
      disabled={disabled}
      onPointerDown={press}
      onPointerUp={event => { stop(event); release(); }}
      onPointerLeave={event => { stop(event); release(); }}
      onPointerCancel={event => { stop(event); viaPointer.current = false; release(); }}
      onKeyDown={event => { viaPointer.current = false; stop(event); }}
      onClick={activate}
    >
      <span className="pulse-heart__pill">
        <span ref={heartRef as Ref<HTMLSpanElement>} className="pulse-heart__heart" aria-hidden="true">{icon(shown)}</span>
      </span>
    </button>
  );
}
