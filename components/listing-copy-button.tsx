"use client";

import { useState, type RefObject } from "react";
import { Copy } from "lucide-react";
import { useSite } from "./site-context";

export function ListingCopyButton({ value, label, field }: {
  value: string; label: string; field: RefObject<HTMLTextAreaElement | null>;
}) {
  const { t } = useSite();
  const [feedback, setFeedback] = useState<{ value: string; copied: boolean } | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback({ value, copied: true });
    } catch {
      field.current?.focus({ preventScroll: true });
      field.current?.select();
      setFeedback({ value, copied: false });
    }
  }

  return <div className="listing-copy-control">
    <button type="button" className="listing-copy-button" disabled={!value} onClick={() => void copy()}>
      <Copy size={16} aria-hidden="true"/>{label}
    </button>
    <span role="status" className="listing-copy-feedback">{feedback?.value === value && (feedback.copied
      ? t("Copied", "Đã sao chép") : t("Selected. Copy from the field.", "Đã chọn. Hãy sao chép từ ô văn bản."))}</span>
  </div>;
}
