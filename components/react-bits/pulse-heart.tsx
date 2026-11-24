"use client";

// Adapted from React Bits Pulse Heart. See THIRD_PARTY_NOTICES.md.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useMotionPreference } from "../use-motion-preference";

const ADD_MS = 560;
const REMOVE_MS = 210;
const PARTICLES = [
  { angle: -88, travel: 21, delay: 0, spin: 96, color: "red", shape: "square" },
  { angle: -44, travel: 17, delay: 35, spin: -118, color: "cyan", shape: "strip" },
  { angle: -4, travel: 22, delay: 16, spin: 138, color: "pink", shape: "square" },
  { angle: 41, travel: 16, delay: 62, spin: -84, color: "yellow", shape: "strip" },
  { angle: 89, travel: 20, delay: 22, spin: 112, color: "blue", shape: "square" },
  { angle: 139, travel: 16, delay: 52, spin: -124, color: "green", shape: "strip" },
  { angle: 181, travel: 22, delay: 8, spin: 132, color: "cyan", shape: "square" },
  { angle: 227, travel: 18, delay: 44, spin: -98, color: "yellow", shape: "strip" },
] as const;

type PulseHeartProps = {
  liked: boolean;
  pending?: boolean;
  onChange?: (liked: boolean) => boolean | null | Promise<boolean | null>;
  showCount?: boolean;
  icon: (filled: boolean) => ReactNode;
  disabled?: boolean;
  label: string;
  className?: string;
};

function Fanfare({ anchor }: { anchor: RefObject<HTMLButtonElement | null> }) {
  const layer = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const button = anchor.current, host = layer.current;
    if (!button || !host) return;
    let frame = 0, lastPosition = "", lastRadius = "";
    const follow = () => {
      const { left, top, width, height } = button.getBoundingClientRect();
      const position = "translate3d(" + (left + width / 2) + "px," + (top + height / 2) + "px,0)";
      const radius = (Math.max(width, height) / 2 + 5) + "px";
      if (position !== lastPosition) {
        host.style.transform = position;
        lastPosition = position;
      }
      if (radius !== lastRadius) {
        host.style.setProperty("--pulse-heart-radius", radius);
        lastRadius = radius;
      }
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [anchor]);

  // Property images and cards clip their contents, so draw the effect at the
  // button's viewport position for the duration of the burst.
  return createPortal(
    <span ref={layer} className="pulse-heart__fanfare" aria-hidden="true">
      {PARTICLES.map(({ angle, travel, delay, spin, color, shape }) =>
        <span key={angle} className="pulse-heart__particle" data-shape={shape} style={{
          color: "var(--pulse-heart-" + color + ")",
          "--pulse-heart-angle": angle + "deg",
          "--pulse-heart-travel": travel + "px",
          "--pulse-heart-delay": delay + "ms",
          "--pulse-heart-spin": spin + "deg",
        } as CSSProperties} />
      )}
    </span>,
    document.body
  );
}

export default function PulseHeart({
  liked, pending = false, onChange, showCount = false, icon, disabled = false, label, className = "",
}: PulseHeartProps) {
  const reduced = useMotionPreference();
  const [pulse, setPulse] = useState<"add" | "remove" | null>(null);
  const root = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const timer = useRef<number | null>(null);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    if (!reduced) return;
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
      setPulse(null);
    }
    root.current?.style.removeProperty("transform");
  }, [reduced]);

  function release(event?: PointerEvent<HTMLButtonElement>) {
    event?.stopPropagation();
    root.current?.style.removeProperty("transform");
  }

  function press(event: PointerEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (event.button === 0 && !disabled && !pending && !inFlight.current && !reduced) {
      root.current?.style.setProperty("transform", "scale(0.97)", "important");
    }
  }

  async function activate(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    release();
    if (disabled || pending || inFlight.current || timer.current !== null || !onChange) return;
    const next = !liked;
    inFlight.current = true;
    try {
      const confirmed = await onChange(next);
      if (!mounted.current || confirmed !== next || reducedRef.current) return;

      setPulse(next ? "add" : "remove");
      timer.current = window.setTimeout(() => {
        timer.current = null;
        setPulse(null);
      }, next ? ADD_MS : REMOVE_MS);
    } catch {
      // The saved state stays controlled by the caller on a rejected write.
    } finally {
      inFlight.current = false;
    }
  }

  const activePulse = reduced || (pulse === "add" && !liked) || (pulse === "remove" && liked) ? null : pulse;
  return (
    <>
      <button
        ref={root}
        type="button"
        className={["save-button", "pulse-heart", liked ? "is-saved" : "", className].filter(Boolean).join(" ")}
        data-button-variant="save"
        data-liked={String(liked)}
        data-pulse={activePulse ?? undefined}
        data-no-count={showCount ? undefined : ""}
        aria-pressed={liked}
        aria-busy={pending}
        aria-label={label}
        disabled={disabled || pending}
        onPointerDown={press}
        onPointerUp={release}
        onPointerLeave={release}
        onPointerCancel={release}
        onKeyDown={event => event.stopPropagation()}
        onClick={activate}
      >
        <span className="pulse-heart__pill">
          <span className="pulse-heart__heart" aria-hidden="true">{icon(liked)}</span>
        </span>
      </button>
      {activePulse === "add" && <Fanfare anchor={root} />}
    </>
  );
}
