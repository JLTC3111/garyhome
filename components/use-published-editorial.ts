"use client";
import { useLayoutEffect } from "react";
import type { EditorialArticle } from "@/lib/editorial";
import { useSite } from "./site-context";

// App Router layouts persist across navigation. Fresh page props must update
// the public article snapshot too, so new URLs do not inherit an old title/list.
export function usePublishedEditorial(incoming?: EditorialArticle[]) {
  const { content, setContent, demo, editor } = useSite();
  useLayoutEffect(() => {
    if (!incoming || demo) return;
    const published = incoming.filter(row => row.status === "published");
    const ids = new Set(published.map(row => row.id));
    // Sync before paint, preserving private drafts in an active Studio session.
    setContent(previous => ({ ...previous, editorial: [...published,
      ...(editor ? (previous.editorial || []).filter(row => row.status === "draft" && !ids.has(row.id)) : []),
    ] }));
  }, [incoming, demo, editor, setContent]);
  return demo ? content.editorial : incoming ?? content.editorial;
}
