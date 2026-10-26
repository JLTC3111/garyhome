"use client";

// Magic UI Shiny Button (MIT), matching the owner's ICUE People app reference.
// Retain the actual moving label mask and border sweep. See THIRD_PARTY_NOTICES.md.
import { useEffect, useRef, useState, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode, type Ref } from "react";
import { m, type MotionProps } from "motion/react";
import Link from "next/link";
import { useMotionPreference } from "../use-motion-preference";

type ShinyButtonProps = { children: ReactNode; className?: string } & (
  | ({ href: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof MotionProps>)
  | ({ href?: never } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof MotionProps>)
);
// The site uses LazyMotion strict: keep the reference spring with light components.
const MotionLink = m.create(Link);
const shineTransition: MotionProps["transition"] = {
  repeat: Infinity, repeatType: "loop", repeatDelay: 1,
  type: "spring", stiffness: 20, damping: 15, mass: 2,
  scale: { type: "spring", stiffness: 200, damping: 5, mass: .5 },
};

export function ShinyButton(props: ShinyButtonProps) {
  const element = useRef<HTMLButtonElement | HTMLAnchorElement>(null), reduced = useMotionPreference();
  const [visible, setVisible] = useState(false);
  const isLink = props.href !== undefined;
  const disabled = props.href === undefined && props.disabled === true;
  const active = visible && !reduced && !disabled;
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    let alive = true, inView = typeof IntersectionObserver === "undefined";
    const update = () => { if (alive) setVisible(inView && document.visibilityState !== "hidden"); };
    const observer = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(entries => {
      inView = entries.some(entry => entry.isIntersecting); update();
    }) : null;
    observer?.observe(node); document.addEventListener("visibilitychange", update); update();
    return () => { alive = false; observer?.disconnect(); document.removeEventListener("visibilitychange", update); };
  }, [isLink]);

  const animation: MotionProps = {
    initial: { "--x": "100%", scale: 1 },
    animate: { "--x": active ? "-100%" : "100%", scale: 1 },
    whileTap: reduced || disabled ? undefined : { scale: .95 },
    transition: active ? shineTransition : { duration: 0 },
  };

  const layers = <>
    <span className="shiny-button-label">{props.children}</span>
    <span className="shiny-button-rim" aria-hidden="true"/>
  </>;
  const className = `button shiny-button ${props.className || ""}`.trim();
  if (props.href !== undefined) {
    const { children: _children, className: _className, ...link } = props;
    return <MotionLink {...link} {...animation} ref={element as Ref<HTMLAnchorElement>} className={className} data-shiny-active={active}>{layers}</MotionLink>;
  }
  const { children: _children, className: _className, href: _href, ...button } = props;
  return <m.button {...button} {...animation} type={button.type || "button"} ref={element as Ref<HTMLButtonElement>} className={className} data-shiny-active={active}>{layers}</m.button>;
}
