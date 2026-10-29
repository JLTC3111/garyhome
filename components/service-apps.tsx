"use client";
import Link from "next/link";
import { useSite } from "./site-context";
import { GaryAppsDirectory, GaryAppsMenu } from "@/shared/gary-apps/gary-apps";

const renderLink: NonNullable<Parameters<typeof GaryAppsDirectory>[0]["renderLink"]> = props => props.href.startsWith("/") ? <Link {...props}/> : <a {...props}/>;

export function ServiceAppsSection({ className = "" }: { className?: string }) {
  const { language } = useSite();
  return <GaryAppsDirectory language={language} currentApp="home" className={className} renderLink={renderLink}/>;
}

export function ServiceAppsMenu({ className = "", onFollow, onOpen }: { className?: string; onFollow?: () => void; onOpen?: () => void }) {
  const { language } = useSite();
  return <GaryAppsMenu language={language} currentApp="home" className={className} renderLink={renderLink} onFollow={onFollow} onOpen={onOpen}/>;
}
