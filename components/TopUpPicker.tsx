"use client";

import { useState } from "react";

/** The client's top-up form: amounts as buttons, or another amount, with the price worked out as they choose. */
export function TopUpPicker({ amounts, rate, labels, locale }: {
  amounts: number[]; rate: number;
  labels: { pick: string; custom: string; total: string; send: string; credits: string };
  locale: string;
}) {
  const [credits, setCredits] = useState<number>(amounts[1] ?? amounts[0] ?? 500);
  const [custom, setCustom] = useState("");
  const n = (x: number, d = 0) => new Intl.NumberFormat(locale === "ar" ? "ar-BH" : "en-GB", { minimumFractionDigits: d, maximumFractionDigits: d }).format(x);
  const chosen = custom.trim() ? Math.max(0, Math.round(Number(custom)) || 0) : credits;
  const price = chosen * rate;
  return (
    <div className="stack">
      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend><strong>{labels.pick}</strong></legend>
        <div className="bc-amounts">
          {amounts.map((a) => (
            <label key={a}><input type="radio" name="amount" checked={!custom.trim() && credits === a} onChange={() => { setCredits(a); setCustom(""); }} /><span dir="ltr">{n(a)}</span></label>
          ))}
        </div>
      </fieldset>
      <label>{labels.custom}
        <input type="number" min={1} max={100000} step={1} inputMode="numeric" value={custom} onChange={(e) => setCustom(e.target.value)} style={{ maxInlineSize: 200 }} />
      </label>
      <input type="hidden" name="credits" value={chosen || ""} />
      {rate > 0 && chosen > 0 && <p className="muted" aria-live="polite">{labels.total.replace("{price}", n(price, 3)).replace("{rate}", n(rate, 4)).replace("{n}", n(chosen))}</p>}
      <div><button className="btn" type="submit" disabled={!chosen}>{labels.send}</button></div>
    </div>
  );
}
