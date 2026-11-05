"use client";

import { useEffect, useId, useRef, useState } from "react";
import { parsePublicUrl, publicUrlFor, type PublicUrlKind } from "@/lib/public-url";
import { useSite } from "./site-context";

export function PublicUrlField({ value, onChange, kind = "property", name = "slug", disabled = false }: {
  value: string; onChange: (value: string) => void; kind?: PublicUrlKind; name?: string; disabled?: boolean;
}) {
  const { publicOrigin, t } = useSite();
  const hintId = useId(), errorId = useId(), input = useRef<HTMLInputElement>(null);
  const origin = publicOrigin || "https://garyhome.vn";
  const [draft, setDraft] = useState(() => ({ source: value, raw: publicUrlFor(value, origin, kind), origin, kind, revealed: false }));
  let current = draft;
  // A stored key is expanded when a different record arrives. Changes emitted
  // by this input keep the exact text the person is still typing.
  if (draft.source !== value || draft.origin !== origin || draft.kind !== kind) {
    current = { source: value, raw: publicUrlFor(value, origin, kind), origin, kind, revealed: false };
    setDraft(current);
  }
  const displayed = current.raw;
  const example = publicUrlFor(kind === "neighbourhood" ? "tay-ho" : kind === "article" ? "renting-in-hanoi" : "apartment-in-tay-ho", origin, kind);
  const label = kind === "property" ? t("Listing URL", "Đường dẫn tin đăng") : kind === "article" ? t("Article URL", "Đường dẫn bài viết") : t("Neighbourhood URL", "Đường dẫn khu vực");
  function messageFor(raw: string) {
    const { issue } = parsePublicUrl(raw, origin, kind);
    if (!issue) return "";
    if (issue === "required") return t(`Enter the complete URL, for example ${example}.`, `Nhập đường dẫn đầy đủ, ví dụ: ${example}.`);
    if (issue === "format") return t(`Enter a complete HTTPS URL, for example ${example}.`, `Nhập đường dẫn HTTPS đầy đủ, ví dụ: ${example}.`);
    if (issue === "origin") return t(`This page is hosted on ${origin}. Use a URL on this website.`, `Trang này được lưu trên ${origin}. Hãy dùng đường dẫn thuộc website này.`);
    if (issue === "route") return t(`Use a URL in this format: ${example}.`, `Dùng đường dẫn theo mẫu: ${example}.`);
    if (kind === "neighbourhood") return t("The district name after district= must use lowercase letters without accents, numbers and single hyphens (up to 180 characters). Example: tay-ho.", "Tên khu vực sau district= phải dùng chữ thường không dấu, số và dấu gạch nối đơn (tối đa 180 ký tự). Ví dụ: tay-ho.");
    return t("The address after the final / must use lowercase letters without accents, numbers and single hyphens (up to 180 characters). Example: apartment-in-tay-ho.", "Phần địa chỉ sau dấu / cuối cùng phải dùng chữ thường không dấu, số và dấu gạch nối đơn (tối đa 180 ký tự). Ví dụ: apartment-in-tay-ho.");
  }
  const message = messageFor(displayed), invalid = !disabled && current.revealed && !!message;
  useEffect(() => { input.current?.setCustomValidity(disabled ? "" : message); }, [message, disabled]);
  return <label className="property-slug-field">{label}
    <input ref={input} name={name} type="url" data-validation-managed="true" required disabled={disabled}
      value={displayed} maxLength={2000} placeholder={example} autoCapitalize="none" autoCorrect="off" spellCheck={false}
      aria-describedby={invalid ? `${hintId} ${errorId}` : hintId} aria-invalid={invalid}
      onInvalid={event => { event.preventDefault(); setDraft(previous => ({ ...previous, revealed: true })); }}
      onBlur={() => {
        const parsed = parsePublicUrl(displayed, origin, kind);
        setDraft(previous => ({ ...previous, raw: parsed.issue ? displayed : publicUrlFor(parsed.key, origin, kind), revealed: true }));
      }}
      onChange={event => {
        const raw = event.target.value, parsed = parsePublicUrl(raw, origin, kind);
        const source = parsed.issue ? raw : parsed.key;
        input.current?.setCustomValidity(messageFor(raw));
        setDraft(previous => ({ ...previous, source, raw, origin, kind }));
        onChange(source);
      }}/>
    <small id={hintId}>{t("Enter the full public address, including https://. Changing a published URL changes its link.", "Nhập địa chỉ công khai đầy đủ, gồm https://. Đổi đường dẫn đã xuất bản sẽ thay đổi liên kết của trang.")}</small>
    {invalid && <small id={errorId} className="slug-field-error" role="alert">{message}</small>}
  </label>;
}
