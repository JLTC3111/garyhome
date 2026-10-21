"use client";

import { studioText } from "@/lib/studio-i18n";
import { useSite } from "./site-context";

export function useStudioText() {
  const { language } = useSite();
  return (message: string, values?: Record<string, string | number>) => studioText(message, language, values);
}
