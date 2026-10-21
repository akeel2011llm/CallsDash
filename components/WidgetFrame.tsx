"use client";

import { useEffect, useState } from "react";

/**
 * The frame around the website widget's conversation. The close button asks the clinic page (public/widget.js) to
 * remove the frame. Where the browser reports the embedding site (location.ancestorOrigins), a site that is not the
 * clinic's own gets nothing; the server already checked the referrer.
 */
export function WidgetFrame({ lang, title, color, closeLabel, allowedHosts, blocked, children }: {
  lang: "en" | "ar"; title: string; color?: string; closeLabel: string; allowedHosts: string[]; blocked: string; children: React.ReactNode;
}) {
  const [refused, setRefused] = useState(false);
  useEffect(() => {
    const origins = (window.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
    if (!origins || origins.length === 0) return;
    try {
      const host = new URL(origins[origins.length - 1]).hostname.toLowerCase();
      if (!allowedHosts.some((d) => host === d || host.endsWith(`.${d}`))) setRefused(true);
    } catch { setRefused(true); }
  }, [allowedHosts]);
  return (
    <main dir={lang === "ar" ? "rtl" : "ltr"} lang={lang} className="stack" style={{ padding: "12px", minHeight: "100dvh", background: "var(--surface)", ...(color ? { ["--brand" as string]: color } : {}) }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <strong>{title}</strong>
        <button type="button" className="btn small ghost" onClick={() => window.parent.postMessage({ callsdash: "close" }, "*")}>{closeLabel}</button>
      </div>
      {refused ? <p>{blocked}</p> : children}
    </main>
  );
}
