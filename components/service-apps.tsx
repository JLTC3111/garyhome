"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSite } from "./site-context";
import { GaryAppsDirectory, GaryAppsMenu } from "@/shared/gary-apps/gary-apps";
import { connectGaryApps, type GaryRuntimeProps } from "@/shared/gary-apps/client.js";

const renderLink: NonNullable<Parameters<typeof GaryAppsDirectory>[0]["renderLink"]> = props => props.href.startsWith("/") ? <Link {...props}/> : <a {...props}/>;

function SharedGaryApps(props: GaryRuntimeProps) {
  const target = useRef<HTMLDivElement>(null);
  const connection = useRef<ReturnType<typeof connectGaryApps> | null>(null);
  const initial = useRef(props);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!target.current) return;
    connection.current = connectGaryApps(target.current, initial.current, {
      // Preview and production Home serve their own release. Other sites use garyhome.vn.
      manifestUrl: new URL("/shared/gary-apps/v1/manifest.json", window.location.origin).href,
      onReady: () => setReady(true),
      isBusy: () => {
        const parent = target.current?.parentElement;
        return !!parent?.querySelector("details[open]") || !!(parent?.contains(document.activeElement) && document.activeElement?.closest(".gary-apps-menu"));
      },
    });
    return () => { connection.current?.unmount(); connection.current = null; };
  }, []);
  useEffect(() => {
    connection.current?.update({ kind: props.kind, language: props.language, currentApp: props.currentApp, className: props.className, onFollow: props.onFollow, onOpen: props.onOpen });
  }, [props.kind, props.language, props.currentApp, props.className, props.onFollow, props.onOpen]);
  const Fallback = props.kind === "directory" ? GaryAppsDirectory : GaryAppsMenu;
  return <>{!ready && <Fallback {...props} renderLink={renderLink}/>}<div ref={target} style={{ display: "contents" }} data-gary-apps-remote="home"/></>;
}

export function ServiceAppsSection({ className = "" }: { className?: string }) {
  const { language } = useSite();
  return <SharedGaryApps kind="directory" language={language} currentApp="home" className={className}/>;
}

export function ServiceAppsMenu({ className = "", onFollow, onOpen }: { className?: string; onFollow?: () => void; onOpen?: () => void }) {
  const { language } = useSite();
  return <SharedGaryApps kind="menu" language={language} currentApp="home" className={className} onFollow={onFollow} onOpen={onOpen}/>;
}
