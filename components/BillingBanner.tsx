"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * The on-screen billing reminder: a banner above the page listing what renews or expires soon. Closing it hides it on this
 * device until the list changes (a new reminder brings it back). The list itself comes from the server.
 */
export function BillingBanner({ scope, lines, href, labels }: { scope: string; lines: { key: string; text: string }[]; href: string; labels: { title: string; close: string; open: string } }) {
  const signature = lines.map((l) => l.key).join("|");
  const storeKey = `billing-banner-${scope}`;
  const [hidden, setHidden] = useState(true); // hidden until we know it was not closed, so it never flashes
  useEffect(() => {
    try { setHidden(window.localStorage.getItem(storeKey) === signature); } catch { setHidden(false); }
  }, [storeKey, signature]);
  if (!lines.length || hidden) return null;
  return (
    <section className="notice warn billing-banner" role="alert" aria-label={labels.title}>
      <div className="billing-banner-body">
        <strong>{labels.title}</strong>
        <ul>{lines.slice(0, 5).map((l) => <li key={l.key}>{l.text}</li>)}</ul>
        <Link className="btn small ghost" href={href}>{labels.open}</Link>
      </div>
      <button type="button" className="btn small ghost billing-banner-x" aria-label={labels.close} onClick={() => { try { window.localStorage.setItem(storeKey, signature); } catch { /* it just comes back next time */ } setHidden(true); }}>×</button>
    </section>
  );
}
