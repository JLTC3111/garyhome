"use client";

import { useId, useState, type Ref } from "react";
import { CalendarDays } from "lucide-react";
import { TZDate } from "react-day-picker";
import { enUS, vi } from "react-day-picker/locale";
import { Calendar } from "./ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { hanoiToday, validHelpDate } from "@/lib/submissions";
import { useSite } from "./site-context";

const zone = "Asia/Ho_Chi_Minh";
const minimum = "2000-01-01";
function calendarDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new TZDate(year, month - 1, day, 12, zone);
}
function dateValue(date: Date) {
  const zoned = new TZDate(date, zone);
  return [zoned.getFullYear(), zoned.getMonth()+1, zoned.getDate()].map(value=>String(value).padStart(2,"0")).join("-");
}

export function AssistanceDatePicker({ triggerRef, invalid, onSelect }: { triggerRef: Ref<HTMLButtonElement>; invalid: boolean; onSelect: ()=>void }) {
  const { language, t } = useSite();
  const labelId = useId();
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const today = calendarDate(hanoiToday()), start = calendarDate(minimum);
  const selected = value ? calendarDate(value) : undefined;
  const label = t("When did they help?", "Bạn được hỗ trợ ngày nào?");
  const dateFormat = new Intl.DateTimeFormat(language==="vi"?"vi-VN":"en-US", { dateStyle:"medium", timeZone:zone });
  const dateLabel = selected
    ? dateFormat.format(selected)
    : t("Choose a date", "Chọn ngày");

  return <div className="assistance-date-field">
    <span id={labelId}>{label}</span>
    <input type="hidden" name="helped_on" value={value}/>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button ref={triggerRef} type="button" className="assistance-date-trigger"
          aria-invalid={invalid||undefined} aria-label={`${label} ${dateLabel}`}>
          <CalendarDays size={18} aria-hidden="true"/>{dateLabel}
        </button>
      </PopoverTrigger>
      <PopoverContent className="assistance-date-popover" aria-labelledby={labelId} align="start"
        collisionPadding={12} onOpenAutoFocus={event=>event.preventDefault()}
        onInteractOutside={event=>{
          if(event.target instanceof Element&&event.target.closest(".language-toggle, .site-preferences"))event.preventDefault();
        }}>
        <Calendar mode="single" required autoFocus locale={language==="vi"?vi:enUS} timeZone={zone} weekStartsOn={1}
          selected={selected} defaultMonth={selected||today} today={today} startMonth={start} endMonth={today}
          captionLayout="dropdown" showOutsideDays={false} disabled={[{before:start},{after:today}]}
          formatters={{formatMonthDropdown:date=>new Intl.DateTimeFormat(language==="vi"?"vi-VN":"en-US",{month:"long",timeZone:zone}).format(date)}}
          labels={{
            labelNav:()=>t("Calendar navigation","Điều hướng lịch"),
            labelPrevious:()=>t("Previous month","Tháng trước"),
            labelNext:()=>t("Next month","Tháng sau"),
            labelMonthDropdown:()=>t("Choose month","Chọn tháng"),
            labelYearDropdown:()=>t("Choose year","Chọn năm"),
            labelDayButton:(date, modifiers)=>[
              dateFormat.format(date),
              modifiers.today&&t("Today","Hôm nay"),
              modifiers.selected&&t("Selected","Đã chọn"),
            ].filter(Boolean).join(", "),
          }}
          onSelect={date=>{
            const next=dateValue(date);
            if(validHelpDate(next)){setValue(next);setOpen(false);onSelect();}
          }}/>
      </PopoverContent>
    </Popover>
  </div>;
}
