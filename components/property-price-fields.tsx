"use client";

import { useId } from "react";
import type { Property } from "@/lib/types";
import { useStudioText } from "./use-studio-text";

export function PropertyPriceFields({ property, patch }: {
  property: Property;
  patch: <K extends keyof Property>(key: K, value: Property[K]) => void;
}) {
  const text = useStudioText();
  const hintId = useId();
  const period = property.price_period === "night" ? "/ night" : property.price_period === "week" ? "/ week" : "/ month";

  return <div className="property-price-currencies">
    <p className="form-info">{text("Enter USD, VND, or both. Leave both currencies blank for price on request.")}</p>
    {([{currency:"USD",min:"price",max:"price_max",step:"0.01",from:"600",to:"800"},{currency:"VND",min:"price_vnd",max:"price_vnd_max",step:"1",from:"15000000",to:"20000000"}] as const).map(({currency,min,max,step,from,to})=><fieldset key={currency} className="property-price-fields" aria-describedby={hintId}>
      <legend>{text("Price range · {currency}",{currency})} {text(period)}</legend>
      <div className="form-row">
        <label>{text("From · {currency}",{currency})}<input name={min} type="number" min="0" step={step} value={property[min] ?? ""} required={property[max] != null} onChange={event => patch(min, event.target.value === "" ? null : Number(event.target.value))} placeholder={from}/></label>
        <label>{text("To · {currency}",{currency})}<input name={max} type="number" min={property[min] ?? 0} step={step} value={property[max] ?? ""} onChange={event => patch(max, event.target.value === "" ? null : Number(event.target.value))} placeholder={to}/></label>
      </div>
    </fieldset>)}
    <p id={hintId}>{text("Leave To blank for a fixed price, or both blank for price on request.")}</p>
  </div>;
}
