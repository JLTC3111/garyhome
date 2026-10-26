"use client";

// React Bits Bounce Cards, adapted to native district links and idle cleanup.
// The original spring/picking model is retained in lib/bounce-cards.ts.
// See THIRD_PARTY_NOTICES.md.
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { bounceSlots, createBounceAnimator, pickBounceCard } from "@/lib/bounce-cards";
import { useMotionPreference } from "../use-motion-preference";

type DistrictCard = { id: string; href: string; image: string; srcSet?: string; sizes?: string; title: string; content: ReactNode };
type BounceCardsProps = {
  cards: DistrictCard[]; label: string; containerWidth?: number; containerHeight?: number;
  cardSize?: number; spread?: number; rotation?: number; arc?: number; pushDistance?: number;
  hoverScale?: number; bounciness?: number; animationDelay?: number; animationStagger?: number;
  borderWidth?: number; borderColor?: string; radius?: number; shadow?: boolean; enableHover?: boolean;
};
const desktopQuery = "(min-width: 900px) and (hover: hover) and (pointer: fine)";

export default function BounceCards({ cards, label, containerWidth = 500, containerHeight = 320,
  cardSize = 200, spread = 85, rotation = 10, arc = 0, pushDistance = 160,
  hoverScale = 1.06, bounciness = .6, animationDelay = .5, animationStagger = .06,
  borderWidth = 5, borderColor = "#fff", radius = 25, shadow = true, enableHover = true,
}: BounceCardsProps) {
  const root = useRef<HTMLUListElement>(null), elements = useRef<(HTMLLIElement | null)[]>([]);
  const count=cards.length;
  const reduced = useMotionPreference(), identity = cards.map(card => card.id).join("|");
  const fullWidth = Math.max(containerWidth, cardSize * hoverScale + Math.max(0, cards.length - 1) * spread + 2 * pushDistance + 52);
  const initialSlots = bounceSlots(cards.length, spread, rotation, arc);
  useEffect(() => {
    const node = root.current;
    if (!node || typeof window.matchMedia !== "function") return;
    elements.current.length=count;
    const media = window.matchMedia(desktopQuery);
    let animator: ReturnType<typeof createBounceAnimator> | undefined;
    let slots = bounceSlots(count, spread, rotation, arc), size = cardSize, push = pushDistance;
    let hovered = -1, revealed = false, visible = true;
    const paint = (poses: { x: number; y: number; rotate: number; scale: number }[], active: number) => {
      poses.forEach((pose, index) => {
        const element = elements.current[index]; if (!element) return;
        element.style.transform = `translate(-50%, -50%) translate3d(${pose.x.toFixed(2)}px, ${pose.y.toFixed(2)}px, 0) rotate(${pose.rotate.toFixed(3)}deg) scale(${pose.scale.toFixed(4)})`;
        element.style.zIndex = String(active === index ? poses.length + 1 : index + 1);
        element.toggleAttribute("data-active", active === index);
      });
    };
    const settings = () => ({ cardSize: size, pushDistance: push, hoverScale, bounciness, animationDelay, animationStagger });
    const resize = () => {
      const scale = Math.min(1, Math.max(0, node.getBoundingClientRect().width) / fullWidth) || 1;
      size = cardSize * scale; push = pushDistance * scale;
      slots = bounceSlots(count, spread * scale, rotation, arc * scale);
      node.style.setProperty("--bounce-size", `${size}px`);
      if (animator) animator.layout(slots, settings());
      else paint(slots.map(slot => ({ ...slot, scale: 1 })), -1);
    };
    const configure = () => {
      animator?.destroy(); animator = undefined; hovered = -1; resize();
      if (reduced || !media.matches || typeof requestAnimationFrame !== "function") return;
      animator = createBounceAnimator(slots, settings(), {
        now: () => performance.now(), request: frame => requestAnimationFrame(frame), cancel: id => cancelAnimationFrame(id),
      }, paint);
      if (!visible || typeof document !== "undefined" && document.visibilityState === "hidden") animator.pause();
    };
    const move = (event: PointerEvent) => {
      if (!animator || !enableHover || event.pointerType !== "mouse") return;
      const rect = node.getBoundingClientRect();
      hovered = pickBounceCard(slots, event.clientX - rect.left - rect.width / 2,
        event.clientY - rect.top - rect.height / 2, size, hovered, push);
      animator.activate(hovered);
    };
    const leave = () => { hovered = -1; animator?.activate(-1); };
    const focus = (event: FocusEvent) => {
      const index = elements.current.findIndex(element => element?.contains(event.target as Node));
      animator?.activate(index);
    };
    const key = (event: KeyboardEvent) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const index = elements.current.findIndex(element => element?.contains(event.target as Node)); if (index < 0) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? elements.current.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + elements.current.length) % elements.current.length;
      elements.current[next]?.querySelector("a")?.focus();
    };
    const visibility = () => { if (document.visibilityState === "hidden") animator?.pause(); else if (visible) animator?.resume(); };
    configure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null; observer?.observe(node);
    const intersection = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      if (!visible) { animator?.pause(); return; }
      animator?.resume();
      if (!revealed && animator) { revealed = true; animator.reveal(node.getBoundingClientRect().top >= window.innerHeight ? 0 : .84); }
    }, { rootMargin: "140px 0px" }) : null; intersection?.observe(node);
    media.addEventListener?.("change", configure);
    node.addEventListener("pointermove", move); node.addEventListener("pointerleave", leave);
    node.addEventListener("focusin", focus); node.addEventListener("focusout", leave); node.addEventListener("keydown", key);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", visibility);
    return () => {
      animator?.destroy(); observer?.disconnect(); intersection?.disconnect(); media.removeEventListener?.("change", configure);
      node.removeEventListener("pointermove", move); node.removeEventListener("pointerleave", leave);
      node.removeEventListener("focusin", focus); node.removeEventListener("focusout", leave); node.removeEventListener("keydown", key);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", visibility);
    };
  }, [identity, count, reduced, fullWidth, cardSize, spread, rotation, arc, pushDistance, hoverScale, bounciness, animationDelay, animationStagger, enableHover]);
  const style = { maxWidth: fullWidth, "--bounce-height": `${containerHeight}px`, "--bounce-size": `${cardSize}px`,
    "--bounce-border": `${borderWidth}px`, "--bounce-border-color": borderColor, "--bounce-radius": `${radius}px` } as CSSProperties;
  return <ul ref={root} className="bounce-cards" style={style} aria-label={label} data-reduced-motion={reduced} data-shadow={shadow}>
    {cards.map((card, index) => <li ref={element => { elements.current[index] = element; }} key={card.id} className="bounce-card"
      style={{ zIndex: index + 1, transform: `translate(-50%, -50%) translate3d(${initialSlots[index].x}px, ${initialSlots[index].y}px, 0) rotate(${initialSlots[index].rotate}deg)` }}>
      <Link href={card.href} className="bounce-card-link"><img src={card.image} srcSet={card.srcSet} sizes={card.sizes} alt="" width="480" height="480" loading="lazy" decoding="async" draggable={false}/>
        <div className="bounce-card-caption"><h3>{card.title}</h3>{card.content}</div>
      </Link>
    </li>)}
  </ul>;
}
