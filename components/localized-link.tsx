"use client";
import NextLink from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";
import { localizedPath, localizedRoute } from "@/lib/localized-routes";
import { useSite } from "./site-context";

// Emit the canonical locale URL directly rather than sending internal links
// through a legacy English redirect. Private routes and assets are unchanged.
export default function LocalizedLink({ href, ...props }: ComponentProps<typeof NextLink>) {
  const pathname = usePathname(), { language, publicPath } = useSite();
  const localized = localizedRoute(pathname || "") || localizedRoute(publicPath || "");
  const destination = typeof href === "string" && !localizedRoute(href) ? localizedPath(href, localized?.language || language) : href;
  return <NextLink href={destination} {...props}/>;
}
