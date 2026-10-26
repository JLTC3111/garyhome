"use client";

// React Bits Bounce Cards, adapted to linked districts, keyboard focus and mobile.
// See THIRD_PARTY_NOTICES.md for the upstream notice.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { motion, useInView } from "motion/react";
import { useMotionPreference } from "../use-motion-preference";

type DistrictCard = { id: string; href: string; image: string; title: string; content: ReactNode };
type BounceCardsProps = {
  cards: DistrictCard[]; label: string; containerWidth?: number; containerHeight?: number;
  cardSize?: number; spread?: number; rotation?: number; arc?: number; pushDistance?: number;
  hoverScale?: number; bounciness?: number; animationDelay?: number; animationStagger?: number;
  borderWidth?: number; borderColor?: string; radius?: number; shadow?: boolean; enableHover?: boolean;
};
const tilts = [1, .5, -.3, -1, .2];

export default function BounceCards({ cards, label, containerWidth = 1040, containerHeight = 420,
  cardSize = 242, spread = 190, rotation = 10, arc = 15, pushDistance = 160,
  hoverScale = 1.06, bounciness = .6, animationDelay = .15, animationStagger = .06,
  borderWidth = 5, borderColor = "#fff", radius = 25, shadow = true, enableHover = true,
}: BounceCardsProps) {
  const root = useRef<HTMLUListElement>(null);
  const reduced = useMotionPreference();
  const inView = useInView(root, { once: true, margin: "0px 0px -24px 0px" });
  const [width, setWidth] = useState(containerWidth);
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  useEffect(() => {
    const element = root.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(entries => {
      const next = entries[0]?.contentRect.width;
      if (next > 0) setWidth(Math.min(next, containerWidth));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [containerWidth]);
  const active = focused ?? hovered;
  const gap = Math.min(spread, Math.max(0, (width - cardSize - 110) / Math.max(1, cards.length - 1)));
  const edge = Math.max(0, (width - cardSize * hoverScale - gap * (cards.length - 1)) / 2 - 18);
  const rootStyle = {
    maxWidth: containerWidth, "--bounce-height": `${containerHeight}px`,
    "--bounce-size": `${cardSize}px`, "--bounce-border": `${borderWidth}px`,
    "--bounce-border-color": borderColor, "--bounce-radius": `${radius}px`,
  } as CSSProperties;
  return <ul ref={root} className="bounce-cards" style={rootStyle} aria-label={label}
    data-reduced-motion={reduced} data-shadow={shadow} data-in-view={inView}>
    {cards.map((card, index) => {
      const offset = index - (cards.length - 1) / 2;
      const selected = active === index;
      const pushed = active !== null && !selected ? Math.sign(index - active) * Math.min(pushDistance, edge) : 0;
      const x = offset * gap + (!reduced ? pushed : 0);
      const y = arc * (offset / Math.max(1, (cards.length - 1) / 2)) ** 2;
      return <motion.li key={card.id} className="bounce-card"
        style={{ zIndex: selected ? cards.length + 1 : index + 1,
          "--bounce-delay": `${animationDelay + index * animationStagger}s` } as CSSProperties}
        initial={false} animate={{ x, y: selected && !reduced ? -24 : y,
          rotate: selected && !reduced ? 0 : tilts[index % tilts.length] * rotation,
          scale: selected && !reduced ? hoverScale : 1 }}
        transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 30 - Math.min(1, Math.max(0, bounciness)) * 13 }}
        onPointerEnter={event => { if (enableHover && event.pointerType === "mouse") setHovered(index); }}
        onPointerLeave={() => setHovered(null)} onFocus={() => setFocused(index)}
        onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(null); }}>
        <Link href={card.href} className="bounce-card-link">
          <img src={card.image} alt="" width="480" height="640" loading="lazy"/>
          <div className="bounce-card-caption"><h3>{card.title}</h3>{card.content}</div>
        </Link>
      </motion.li>;
    })}
  </ul>;
}
