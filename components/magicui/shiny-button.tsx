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
  repeat: 0,
  type: "spring", stiffness: 20, damping: 15, mass: 2,
  scale: { type: "spring", stiffness: 200, damping: 5, mass: .5 },
};

export function ShinyButton(props: ShinyButtonProps) {
  const element = useRef<HTMLButtonElement | HTMLAnchorElement>(null), reduced = useMotionPreference();
  const [shine, setShine] = useState<{ mode: "hover" | "timed"; active: boolean }>({ mode: "hover", active: false });
  const finish = useRef<() => void>(() => {});
  const isLink = props.href !== undefined;
  const disabled = props.href === undefined && props.disabled === true;
  const active = shine.active && !reduced && !disabled;
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const hover = typeof window.matchMedia === "function" ? window.matchMedia("(hover: hover) and (pointer: fine)") : null;
    let alive = true, inView = typeof IntersectionObserver === "undefined", hovered = false, focused = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const eligible = () => !reduced && !disabled && inView && document.visibilityState !== "hidden";
    const update = (next: boolean) => {
      if (!alive) return;
      const mode = hover?.matches ? "hover" : "timed";
      setShine(current => current.mode === mode && current.active === next ? current : { mode, active: next });
    };
    const reset = () => {
      clearInterval(timer); timer = undefined; update(false);
      if (!eligible()) return;
      if (hover?.matches) update(hovered || focused);
      else timer = setInterval(() => { if (alive && eligible()) update(true); }, 60_000);
    };
    const pointerEnter = (event: Event) => {
      if ("pointerType" in event && event.pointerType === "touch") return;
      hovered = true; if (hover?.matches && eligible()) update(true);
    };
    const pointerLeave = () => { hovered = false; if (hover?.matches) update(eligible() && focused); };
    const focus = () => { focused = node.matches(":focus-visible"); if (hover?.matches && eligible()) update(hovered || focused); };
    const blur = () => { focused = false; if (hover?.matches) update(eligible() && hovered); };
    const modeChange = () => { hovered = false; focused = false; reset(); };
    const visibility = () => { if (document.visibilityState === "hidden") { hovered = false; focused = false; } reset(); };
    const complete = () => { if (!hover?.matches) update(false); };
    finish.current = complete;
    const observer = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(entries => {
      const next = entries.some(entry => entry.isIntersecting);
      if (inView !== next) { inView = next; if (!next) hovered = false; reset(); }
    }) : null;
    observer?.observe(node); document.addEventListener("visibilitychange", visibility);
    node.addEventListener("pointerenter", pointerEnter); node.addEventListener("pointerleave", pointerLeave);
    node.addEventListener("focus", focus); node.addEventListener("blur", blur);
    if (hover?.addEventListener) hover.addEventListener("change", modeChange); else hover?.addListener(modeChange);
    reset();
    return () => {
      alive = false; clearInterval(timer); observer?.disconnect(); document.removeEventListener("visibilitychange", visibility);
      node.removeEventListener("pointerenter", pointerEnter); node.removeEventListener("pointerleave", pointerLeave);
      node.removeEventListener("focus", focus); node.removeEventListener("blur", blur);
      if (hover?.removeEventListener) hover.removeEventListener("change", modeChange); else hover?.removeListener(modeChange);
      if (finish.current === complete) finish.current = () => {};
    };
  }, [isLink, reduced, disabled]);

  const animation: MotionProps = {
    initial: { "--x": "100%", scale: 1 },
    animate: { "--x": active ? "-100%" : "100%", scale: 1 },
    whileTap: reduced || disabled ? undefined : { scale: .95 },
    transition: active ? shineTransition : { duration: 0 },
    onAnimationComplete: definition => {
      if (typeof definition === "object" && "--x" in definition && definition["--x"] === "-100%") finish.current();
    },
  };

  const layers = <>
    <span className="shiny-button-label">{props.children}</span>
    <span className="shiny-button-rim" aria-hidden="true"/>
  </>;
  const className = `button shiny-button ${props.className || ""}`.trim();
  if (props.href !== undefined) {
    const { children: _children, className: _className, ...link } = props;
    return <MotionLink {...link} {...animation} ref={element as Ref<HTMLAnchorElement>} className={className} data-shiny-active={active} data-shiny-mode={shine.mode}>{layers}</MotionLink>;
  }
  const { children: _children, className: _className, href: _href, ...button } = props;
  return <m.button {...button} {...animation} type={button.type || "button"} ref={element as Ref<HTMLButtonElement>} className={className} data-shiny-active={active} data-shiny-mode={shine.mode}>{layers}</m.button>;
}
