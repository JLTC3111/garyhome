"use client";

import { useEffect, useRef } from "react";
import { installFormValidationMessages } from "@/lib/form-validation";
import type { Language } from "@/lib/types";

export function FormValidationMessages({ language }: { language: Language }) {
  const installed = useRef<ReturnType<typeof installFormValidationMessages> | null>(null);
  useEffect(() => {
    installed.current = installFormValidationMessages(document);
    return () => { installed.current?.destroy(); installed.current = null; };
  }, []);
  useEffect(() => { installed.current?.setLanguage(language); }, [language]);
  return null;
}
