"use client";

import { useState } from "react";

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/**
 * Makes a random secret in the browser (letters and digits only, so it cannot carry a character that breaks a header).
 * It is shown on this screen only: it is never sent to the server or stored, and the admin pastes it into Vercel.
 */
export function SecretGenerator({ labels }: { labels: { make: string; copy: string; copied: string; hint: string } }) {
  const [value, setValue] = useState("");
  const [copied, setCopied] = useState(false);
  function make() {
    const bytes = new Uint8Array(48);
    crypto.getRandomValues(bytes);
    // 256 % 56 = 32, so values from the last partial block are skipped to keep every character equally likely
    const out: string[] = [];
    for (const b of bytes) if (b < 224) out.push(CHARS[b % CHARS.length]);
    while (out.length < 40) { const [b] = crypto.getRandomValues(new Uint8Array(1)); if (b < 224) out.push(CHARS[b % CHARS.length]); }
    setValue(out.slice(0, 40).join(""));
    setCopied(false);
  }
  async function copy() {
    try { await navigator.clipboard.writeText(value); setCopied(true); } catch { /* the field is selectable: copy by hand */ }
  }
  return (
    <div className="stack" style={{ gap: ".4rem" }}>
      <div className="row">
        <button type="button" className="btn ghost small" onClick={make}>{labels.make}</button>
        {value && <button type="button" className="btn ghost small" onClick={() => void copy()}>{copied ? labels.copied : labels.copy}</button>}
      </div>
      {value && <input readOnly value={value} dir="ltr" onFocus={(e) => e.currentTarget.select()} style={{ fontFamily: "monospace" }} aria-label="secret" />}
      {value && <small className="muted">{labels.hint}</small>}
    </div>
  );
}
