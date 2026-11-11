"use client";

import { useLayoutEffect } from "react";
import { usePathname } from "next/navigation";
import { documentTitle } from "@/lib/document-titles";
import { useSite } from "./site-context";

export function DocumentTitle() {
  const pathname = usePathname();
  const { language, content } = useSite();
  const title = documentTitle(pathname, language, content.properties,content.neighbourhoods,content.editorial);

  useLayoutEffect(() => {
    if (title === null) return;
    // HTML's document.title getter strips and collapses ASCII whitespace.
    // Comparing it with the raw authored title can otherwise keep this
    // observer writing forever (for example "90m² ·  Ban công"). That
    // microtask loop blocks hydration, input and even the page's console.
    const browserTitle = title.replace(/[\t\n\f\r ]+/g, " ").replace(/^ | $/g, "");
    let active = true;
    const apply = () => {
      if (active && document.title !== browserTitle) document.title = browserTitle;
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
