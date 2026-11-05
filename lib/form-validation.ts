import type { Language } from "./types";

type NativeValidity = Pick<ValidityState, "valid" | "valueMissing" | "typeMismatch" | "patternMismatch" | "tooShort" | "tooLong" | "rangeUnderflow" | "rangeOverflow" | "stepMismatch" | "badInput" | "customError">;
type FieldDetails = {
  label: string; type: string; validity: NativeValidity; min?: string; max?: string;
  step?: string; minLength?: number; maxLength?: number; pattern?: string; title?: string; customMessage?: string;
};

export function nativeFieldError(field: FieldDetails, language: Language) {
  const { validity: v, type, min, max, step, minLength, maxLength } = field;
  if (v.valid) return "";
  const t = (english: string, vietnamese: string) => language === "vi" ? vietnamese : english;
  let reason: string;
  if (v.valueMissing) {
    reason = type === "checkbox" ? t("confirm this checkbox to continue.", "đánh dấu ô này để tiếp tục.")
      : type === "radio" || type.startsWith("select") ? t("choose an option.", "chọn một mục.")
      : type === "file" ? t("choose a file.", "chọn một tệp.") : t("enter a value.", "nhập thông tin.");
  } else if (v.badInput) {
    reason = type === "number" ? t("enter a number, for example 25 or 25.5.", "nhập một số, ví dụ 25 hoặc 25.5.")
      : t("enter a complete date or time.", "nhập đầy đủ ngày hoặc giờ.");
  } else if (v.typeMismatch) {
    reason = type === "email" ? t("enter an email address such as name@example.com.", "nhập địa chỉ email, ví dụ name@example.com.")
      : t("enter a full URL such as https://www.example.com.", "nhập URL đầy đủ, ví dụ https://www.example.com.");
  } else if (v.tooShort) {
    reason = t(`use at least ${minLength} characters.`, `nhập ít nhất ${minLength} ký tự.`);
  } else if (v.tooLong) {
    reason = t(`use no more than ${maxLength} characters.`, `nhập tối đa ${maxLength} ký tự.`);
  } else if (v.rangeUnderflow) {
    reason = ["date", "time", "datetime-local", "month", "week"].includes(type)
      ? t(`choose a value on or after ${min}.`, `chọn giá trị từ ${min} trở đi.`)
      : t(`enter ${min} or higher.`, `nhập giá trị từ ${min} trở lên.`);
  } else if (v.rangeOverflow) {
    reason = ["date", "time", "datetime-local", "month", "week"].includes(type)
      ? t(`choose a value on or before ${max}.`, `chọn giá trị không muộn hơn ${max}.`)
      : t(`enter ${max} or lower.`, `nhập giá trị không lớn hơn ${max}.`);
  } else if (v.stepMismatch) {
    reason = type === "number" || type === "range"
      ? t(`use increments of ${step || "1"}, starting at ${min || "0"}.`, `nhập theo bước ${step || "1"}, bắt đầu từ ${min || "0"}.`)
      : type === "date" ? t(`use increments of ${step || "1"} days, starting at ${min || "1970-01-01"}.`, `nhập theo bước ${step || "1"} ngày, bắt đầu từ ${min || "1970-01-01"}.`)
      : type === "month" ? t(`use increments of ${step || "1"} months, starting at ${min || "1970-01"}.`, `nhập theo bước ${step || "1"} tháng, bắt đầu từ ${min || "1970-01"}.`)
      : type === "week" ? t(`use increments of ${step || "1"} weeks, starting at ${min || "1970-W01"}.`, `nhập theo bước ${step || "1"} tuần, bắt đầu từ ${min || "1970-W01"}.`)
      : t(`use time intervals of ${step || "60"} seconds.`, `nhập theo khoảng thời gian ${step || "60"} giây.`);
  } else if (v.patternMismatch) {
    reason = field.title || (field.pattern === "[a-z0-9]+(-[a-z0-9]+)*"
      ? t("use lowercase letters without accents and numbers, separated by single hyphens, e.g. apartment-in-tay-ho.", "dùng chữ thường không dấu và số, ngăn cách bằng một dấu gạch nối, ví dụ apartment-in-tay-ho.")
      : t(`use this format: ${field.pattern}.`, `nhập theo định dạng: ${field.pattern}.`));
  } else if (v.customError && field.customMessage) {
    return field.customMessage;
  } else {
    reason = t(`enter a valid ${type || "text"} value.`, `nhập giá trị hợp lệ cho kiểu ${type || "text"}.`);
  }
  return `${field.label}: ${reason}`;
}

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type Entry = { error: HTMLElement; previousInvalid: string | null };

function fieldLabel(control: Control, language: Language, doc: Document) {
  const accessible = control.getAttribute("aria-label") || control.getAttribute("aria-labelledby")?.split(/\s+/).map(id => doc.getElementById(id)?.textContent || "").join(" ");
  if (accessible?.trim()) return accessible.trim();
  const label = control.labels?.[0];
  const directText = label && Array.from(label.childNodes).filter(node => node.nodeType === 3).map(node => node.textContent).join(" ").trim();
  if (directText) return directText;
  const legend = control.closest("fieldset")?.querySelector("legend")?.textContent?.trim();
  return legend || (language === "vi" ? "Mục này" : "This field");
}

// Capture native invalid events so browser language never replaces site language.
// Preventing the tooltip preserves the browser's normal submission blocking.
export function installFormValidationMessages(doc: Document) {
  let language: Language = "en", sequence = 0, firstInvalid: Control | null = null, active = true;
  const entries = new Map<Control, Entry>();
  const controlFor = (event: Event): Control | null => {
    const target = event.target as Control | null;
    return target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) ? target : null;
  };
  function clear(control: Control) {
    const entry = entries.get(control);
    if (!entry) return;
    const ids = (control.getAttribute("aria-describedby") || "").split(/\s+/).filter(id => id && id !== entry.error.id);
    if (ids.length) control.setAttribute("aria-describedby", ids.join(" ")); else control.removeAttribute("aria-describedby");
    if (entry.previousInvalid === null) control.removeAttribute("aria-invalid"); else control.setAttribute("aria-invalid", entry.previousInvalid);
    control.removeAttribute("data-form-invalid");
    entry.error.remove(); entries.delete(control);
  }
  function render(control: Control) {
    if (!control.isConnected || control.validity.valid || control.hasAttribute("data-validation-managed")) { clear(control); return; }
    let entry = entries.get(control);
    if (!entry) {
      const error = doc.createElement("small");
      error.id = `gary-field-error-${++sequence}`; error.className = "field-validation-error"; error.setAttribute("role", "alert");
      const anchor = control.closest(".password-control") || control;
      anchor.insertAdjacentElement("afterend", error);
      entry = { error, previousInvalid: control.getAttribute("aria-invalid") }; entries.set(control, entry);
    }
    const input = control as HTMLInputElement;
    entry.error.textContent = nativeFieldError({ label: fieldLabel(control, language, doc), type: control.type, validity: control.validity,
      min: input.min, max: input.max, step: input.step, minLength: input.minLength, maxLength: input.maxLength,
      pattern: input.pattern, title: control.title, customMessage: control.validationMessage }, language);
    const ids = new Set((control.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean)); ids.add(entry.error.id);
    control.setAttribute("aria-describedby", [...ids].join(" ")); control.setAttribute("aria-invalid", "true"); control.setAttribute("data-form-invalid", "true");
  }
  function invalid(event: Event) {
    const control = controlFor(event); if (!control) return;
    event.preventDefault(); render(control);
    if (!firstInvalid) {
      firstInvalid = control;
      queueMicrotask(() => {
        const target = firstInvalid; firstInvalid = null;
        if (!active || !target?.isConnected) return;
        const focusTarget = target.tabIndex < 0 ? target.labels?.[0]?.querySelector<HTMLElement>('button,[role="combobox"]') || target : target;
        focusTarget.focus();
      });
    }
  }
  function changed(event: Event) {
    const control = controlFor(event);
    if (control && entries.has(control)) render(control);
    for (const field of entries.keys()) if (!field.isConnected) clear(field);
  }
  doc.addEventListener("invalid", invalid, true); doc.addEventListener("input", changed, true); doc.addEventListener("change", changed, true);
  return {
    setLanguage(next: Language) { language = next; for (const control of entries.keys()) render(control); },
    destroy() {
      active = false; doc.removeEventListener("invalid", invalid, true); doc.removeEventListener("input", changed, true); doc.removeEventListener("change", changed, true);
      for (const control of entries.keys()) clear(control);
    },
  };
}
