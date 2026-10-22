"use client";

import { useState } from "react";

/**
 * A slider with its value shown beside it. The value travels in a hidden field, so a slider that is switched off still
 * sends the setting it shows.
 */
export function RangeField({ name, label, hint, min, max, step, defaultValue, disabled, suffix = "" }: {
  name: string; label: string; hint?: string; min: number; max: number; step: number; defaultValue: number; disabled?: boolean; suffix?: string;
}) {
  const [v, setV] = useState(defaultValue);
  return (
    <label>
      <span className="row" style={{ justifyContent: "space-between" }}>
        <span>{label}</span>
        <output dir="ltr" className="range-value">{v}{suffix}</output>
      </span>
      <input type="range" min={min} max={max} step={step} value={v} disabled={disabled} onChange={(e) => setV(Number(e.target.value))} />
      <input type="hidden" name={name} value={v} />
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}
