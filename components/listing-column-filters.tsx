"use client";

import { useId, type ReactNode } from "react";
import { Filter } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { listingPriceBound, type ListingPriceSort } from "@/lib/listing-table";
import type { PriceCurrency } from "@/lib/types";

type Text = (message: string, values?: Record<string, string | number>) => string;
const statuses = ["published", "draft", "archived"] as const;

function ColumnFilter({ label, active, children }: { label: string; active: boolean; children: ReactNode }) {
  return <Popover>
    <PopoverTrigger asChild>
      <button type="button" className="listing-column-filter" data-active={active ? "true" : "false"} aria-label={label}>
        <Filter size={11} aria-hidden="true"/>
      </button>
    </PopoverTrigger>
    <PopoverContent className="listing-column-popover" align="start" side="bottom" sideOffset={6} collisionPadding={12} aria-label={label}>
      {children}
    </PopoverContent>
  </Popover>;
}

export function ListingPriceFilter({ sort, min, max, currency, onSort, onMin, onMax, onReset, text }: {
  sort: ListingPriceSort; min: string; max: string; currency: PriceCurrency;
  onSort: (sort: ListingPriceSort) => void; onMin: (value: string) => void; onMax: (value: string) => void; onReset: () => void; text: Text;
}) {
  const name = useId();
  const active = sort !== "" || listingPriceBound(min) !== null || listingPriceBound(max) !== null;
  const bound = (value: string) => value === "" || (Number.isFinite(Number(value)) && Number(value) >= 0);
  return <ColumnFilter label={text(active ? "Price filter, active" : "Filter price")} active={active}>
    <fieldset>
      <legend>{text("Sort by price")}</legend>
      <label><input type="radio" name={name} checked={sort === "low"} onChange={() => onSort("low")}/>{text("Lowest First")}</label>
      <label><input type="radio" name={name} checked={sort === "high"} onChange={() => onSort("high")}/>{text("Highest First")}</label>
    </fieldset>
    <fieldset>
      <legend>{text("Monthly price · {currency}", { currency })}</legend>
      <div className="listing-price-range">
        <label>{text("Min / month")}<input type="number" min={0} step={currency === "VND" ? 1 : "any"} inputMode={currency === "VND" ? "numeric" : "decimal"} autoComplete="off" value={min} onChange={event => { if (bound(event.target.value)) onMin(event.target.value); }}/></label>
        <label>{text("Max / month")}<input type="number" min={0} step={currency === "VND" ? 1 : "any"} inputMode={currency === "VND" ? "numeric" : "decimal"} autoComplete="off" value={max} onChange={event => { if (bound(event.target.value)) onMax(event.target.value); }}/></label>
      </div>
      <p>{text("Applies to monthly rents.")}</p>
    </fieldset>
    <button type="button" className="listing-filter-reset" onClick={onReset}>{text("Reset")}</button>
  </ColumnFilter>;
}

export function ListingStatusFilter({ status, onStatus, text }: { status: string; onStatus: (status: string) => void; text: Text }) {
  const name = useId();
  return <ColumnFilter label={text(status ? "Status filter, active" : "Filter status")} active={status !== ""}>
    <fieldset>
      <legend>{text("Filter by status")}</legend>
      <label><input type="radio" name={name} checked={status === ""} onChange={() => onStatus("")}/>{text("All")}</label>
      {statuses.map(value => <label key={value}><input type="radio" name={name} checked={status === value} onChange={() => onStatus(value)}/>{text(value)}</label>)}
    </fieldset>
    <button type="button" className="listing-filter-reset" onClick={() => onStatus("")}>{text("Clear filter")}</button>
  </ColumnFilter>;
}
