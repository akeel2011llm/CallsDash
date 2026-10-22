"use client";

import { useState } from "react";

/** Copies a piece of text (a template wording, a sample value) to the clipboard. The text is on screen too, so a refusal costs nothing. */
export function CopyButton({ text, label, done }: { text: string; label: string; done: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className="btn ghost small" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* select and copy by hand */ }
    }}>{copied ? done : label}</button>
  );
}
