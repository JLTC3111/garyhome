"use client";
import NextLink from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";
import { localizedPath, localizedRoute } from "@/lib/localized-routes";
import { useSite } from "./site-context";

// Preserve legacy and private navigation; explicit public language URLs keep
// their language when following links, including during server rendering.
export default function LocalizedLink({ href, ...props }: ComponentProps<typeof NextLink>) {
  const pathname = usePathname(), { language, publicPath } = useSite();
  const localized = (pathname && localizedRoute(pathname)) || (publicPath && localizedRoute(publicPath));
  const destination = localized && typeof href === "string" && !localizedRoute(href) ? localizedPath(href, language) : href;
  return <NextLink href={destination} {...props}/>;
}
