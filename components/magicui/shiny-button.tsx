"use client";

// Adapted from Magic UI Shiny Button (MIT). See THIRD_PARTY_NOTICES.md.
// Keep the diagonal text/border masks with readable text beneath the shine.
import { useEffect, useRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode, type Ref } from "react";
import Link from "next/link";
import { useMotionPreference } from "../use-motion-preference";

type ShinyButtonProps = { children: ReactNode; className?: string } & (
  | ({ href: string } & AnchorHTMLAttributes<HTMLAnchorElement>)
  | ({ href?: never } & ButtonHTMLAttributes<HTMLButtonElement>)
);

export function ShinyButton(props: ShinyButtonProps) {
  const element = useRef<HTMLButtonElement | HTMLAnchorElement>(null), reduced = useMotionPreference();
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    let visible = typeof IntersectionObserver === "undefined";
    const update = () => { node.dataset.shinyActive = String(!reduced && visible && document.visibilityState !== "hidden"); };
    const observer = typeof IntersectionObserver !== "undefined" ? new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting); update();
    }) : null;
    observer?.observe(node); document.addEventListener("visibilitychange", update); update();
    return () => { observer?.disconnect(); document.removeEventListener("visibilitychange", update); node.dataset.shinyActive = "false"; };
  }, [reduced]);

  const layers = <>
    <span className="shiny-button-label">{props.children}</span>
    <span className="shiny-button-glint" aria-hidden="true">{props.children}</span>
    <span className="shiny-button-rim" aria-hidden="true"/>
  </>;
  const className = `button shiny-button ${props.className || ""}`.trim();
  if (props.href !== undefined) {
    const { children: _children, className: _className, ...link } = props;
    return <Link {...link} ref={element as Ref<HTMLAnchorElement>} className={className} data-shiny-active="false">{layers}</Link>;
  }
  const { children: _children, className: _className, href: _href, ...button } = props;
  return <button {...button} type={button.type || "button"} ref={element as Ref<HTMLButtonElement>} className={className} data-shiny-active="false">{layers}</button>;
}
