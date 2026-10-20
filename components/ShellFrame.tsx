"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "./icons";

export interface TabItem { href: string; label: string; icon?: string; exact?: boolean; badge?: string | number }

/**
 * The frame around every signed-in page. On a computer it is just the sidebar and the page. On a phone the sidebar
 * becomes a drawer opened from a top bar, and the most-used pages sit in a bar at the bottom within thumb reach.
 */
export function ShellFrame({ style, sidebar, title, logo, tabs, menuLabel, moreLabel, children }: {
  style?: React.CSSProperties; sidebar: React.ReactNode; title: string; logo: React.ReactNode; tabs: TabItem[];
  menuLabel: string; moreLabel: string; children: React.ReactNode;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  // close the drawer when the page changes or Escape is pressed
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  const active = (t: TabItem) => (t.exact ? path === t.href : path === t.href || path.startsWith(t.href + "/"));
  return (
    <div className="shell" style={style} data-open={open}>
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label={menuLabel} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <Icon name={open ? "close" : "menu"} size={22} />
        </button>
        <span className="logo" aria-hidden>{logo}</span>
        <strong className="topbar-title">{title}</strong>
      </header>
      {sidebar}
      <div className="backdrop" onClick={() => setOpen(false)} aria-hidden />
      {children}
      <nav className="tabbar" aria-label={title}>
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} className={active(t) ? "tab active" : "tab"} aria-current={active(t) ? "page" : undefined}>
            <span className="tab-icon"><Icon name={t.icon ?? "home"} size={22} />{t.badge ? <span className="pill">{t.badge}</span> : null}</span>
            <span>{t.label}</span>
          </Link>
        ))}
        <button type="button" className="tab" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="tab-icon"><Icon name="more" size={22} /></span>
          <span>{moreLabel}</span>
        </button>
      </nav>
    </div>
  );
}
