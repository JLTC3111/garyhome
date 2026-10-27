"use client";
import { useLayoutEffect } from "react";
import type { Neighbourhood, Property } from "@/lib/types";
import { useSite } from "./site-context";

function latest(incoming: Property, current?: Property) {
  // A pending navigation must not roll back a newer CMS save or unpublish.
  return current && Date.parse(current.updated_at) >= Date.parse(incoming.updated_at) ? current : incoming;
}

export function usePublishedProperty(slug: string, incoming?: Property, area?: Neighbourhood) {
  const { content, setContent, demo } = useSite();
  useLayoutEffect(() => {
    if (!incoming || demo) return;
    setContent(previous => {
      const current = previous.properties.find(row => row.id === incoming.id);
      const selected = latest(incoming, current);
      return { ...previous,
        properties: current ? previous.properties.map(row => row.id === incoming.id ? selected : row) : [...previous.properties, selected],
        neighbourhoods: area ? [...previous.neighbourhoods.filter(row => row.slug !== area.slug), area] : previous.neighbourhoods,
      };
    });
  }, [incoming, area, demo, setContent]);
  const current = content.properties.find(row => incoming ? row.id === incoming.id : row.slug === slug);
  return { property: incoming && !demo ? latest(incoming, current) : current,
    district: area && !demo ? area : content.neighbourhoods.find(row => row.slug === (incoming?.district_slug || current?.district_slug)) };
}
