"use client";

// Adapted from the React Bits Squish Switch interaction. See THIRD_PARTY_NOTICES.md.
import { useState, type CSSProperties } from "react";
import { useMotionPreference } from "../use-motion-preference";

type SquishSwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  offLabel?: string;
  onLabel?: string;
  className?: string;
  title?: string;
  disabled?: boolean;
  trackColor?: string;
  trackOnColor?: string;
  width?: number;
  height?: number;
  radius?: number;
  speed?: number;
  stretch?: number;
  hoverScale?: number;
  colorDuration?: number;
};

export default function SquishSwitch({
  checked, onChange, label, offLabel = "EN", onLabel = "VN", className = "", title,
  disabled = false, trackColor = "#edf0e5", trackOnColor = "#e4ecdc",
  width = 76, height = 38, radius = 19, speed = 50, stretch = 36,
  hoverScale = 1.035, colorDuration = 320,
}: SquishSwitchProps) {
  const reduced = useMotionPreference();
  const [interacted, setInteracted] = useState(false);
  const change = (value: boolean) => {
    if (disabled || value === checked) return;
    setInteracted(true);
    onChange(value);
  };
  const style = {
    "--switch-width": `${width}px`, "--switch-height": `${height}px`,
    "--switch-radius": `${Math.min(radius, height / 2)}px`,
    "--switch-travel": `${width - height}px`,
    "--switch-track": trackColor, "--switch-track-on": trackOnColor,
    "--switch-duration": `${Math.round(560 - Math.min(100, Math.max(0, speed)) * 3.6)}ms`,
    "--switch-color-duration": `${Math.max(0, colorDuration)}ms`,
    "--switch-stretch": 1 + Math.min(100, Math.max(0, stretch)) / 180,
    "--switch-hover-scale": hoverScale,
  } as CSSProperties;
  return <button type="button" role="switch" aria-checked={checked} aria-label={label}
    title={title} disabled={disabled} className={className} style={style}
    data-squish-switch="" data-squish-active={interacted && !reduced}
    data-reduced-motion={reduced}
    onClick={() => change(!checked)} onKeyDown={event => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault(); change(event.key === "ArrowRight");
      }
    }}>
    <span className="squish-switch-track" aria-hidden="true">
      <span className="squish-switch-options"><span>{offLabel}</span><span>{onLabel}</span></span>
      <span className="squish-switch-thumb"><span className="squish-switch-blob"/>
        <span className="squish-switch-current">{checked ? onLabel : offLabel}</span>
      </span>
    </span>
  </button>;
}
