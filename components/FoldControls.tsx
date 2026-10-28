"use client";

import { useEffect } from "react";

/**
 * Open all / close all for the folded sections of a page, and opens the section a link points to (`#voice` in the studio's menu,
 * or a link from another page) together with the sections around it.
 */
export function FoldControls({ openAll, closeAll }: { openAll: string; closeAll: string }) {
  useEffect(() => {
    const openHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      let el: Element | null = document.getElementById(id);
      let opened = false;
      for (; el; el = el.parentElement?.closest("details") ?? null) {
        if (el instanceof HTMLDetailsElement && !el.open) { el.open = true; opened = true; }
      }
      if (opened) document.getElementById(id)?.scrollIntoView();
    };
    openHash();
    window.addEventListener("hashchange", openHash);
    return () => window.removeEventListener("hashchange", openHash);
  }, []);
  const all = (open: boolean) => document.querySelectorAll<HTMLDetailsElement>("details.fold").forEach((d) => { d.open = open; });
  return (
    <div className="row fold-controls">
      <button type="button" className="btn small ghost" onClick={() => all(true)}>{openAll}</button>
      <button type="button" className="btn small ghost" onClick={() => all(false)}>{closeAll}</button>
    </div>
  );
}
