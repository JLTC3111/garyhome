"use client";
import { useLayoutEffect } from "react";
import type { EditorialArticle } from "@/lib/editorial";
import { useSite } from "./site-context";

function latestPublished(incoming: EditorialArticle[], current: EditorialArticle[] = []) {
  const byId = new Map(current.map(row => [row.id, row]));
  return incoming.filter(row => row.status === "published").map(row => {
    const local = byId.get(row.id);
    return local && Date.parse(local.updated_at) >= Date.parse(row.updated_at) ? local : row;
  });
}

// App Router layouts persist across navigation. Fresh page props must update
// the public article snapshot too, so new URLs do not inherit an old title/list.
export function usePublishedEditorial(incoming?: EditorialArticle[]) {
  const { content, setContent, demo, editor } = useSite();
  useLayoutEffect(() => {
    if (!incoming || demo) return;
    const ids = new Set(incoming.map(row => row.id));
    // Sync before paint, preserving private drafts in an active Studio session.
    setContent(previous => ({ ...previous, editorial: [...latestPublished(incoming, previous.editorial),
      ...(editor ? (previous.editorial || []).filter(row => row.status === "draft" && !ids.has(row.id)) : []),
    ] }));
  }, [incoming, demo, editor, setContent]);
  return demo || !incoming ? content.editorial : latestPublished(incoming, content.editorial);
}
