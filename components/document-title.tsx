"use client";

import { useLayoutEffect } from "react";
import { usePathname } from "next/navigation";
import { documentTitle } from "@/lib/document-titles";
import { useSite } from "./site-context";

export function DocumentTitle() {
  const pathname = usePathname();
  const { language, content } = useSite();
  const title = documentTitle(pathname, language, content.properties,content.neighbourhoods);

  useLayoutEffect(() => {
    if (title === null) return;
    let active = true;
    const apply = () => {
      if (active && document.title !== title) document.title = title;
    };
    apply();
    // Route metadata can arrive after the page, including from streamed renders.
    // Update the existing title instead of mounting a competing title element.
    const observer = document.head && typeof MutationObserver === "function" ? new MutationObserver(apply) : null;
    observer?.observe(document.head, { childList: true, subtree: true, characterData: true });
    window.addEventListener("pageshow", apply);
    return () => {
      active = false;
      observer?.disconnect();
      window.removeEventListener("pageshow", apply);
    };
  }, [title]);

  return null;
}
