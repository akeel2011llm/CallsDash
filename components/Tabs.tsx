"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { activeTab } from "@/lib/steps";
import { Icon } from "./icons";

export interface TabItem {
  href: string;
  label: string;
  icon?: string;
  /** A small count or "!" after the label (open requests, a warning). */
  badge?: string | number;
  /** Active only on exactly this address. */
  exact?: boolean;
}

/**
 * A row of tabs that are links, so every tab has its own address (it can be bookmarked, opened in a new tab, and the back
 * button works). On a phone the row scrolls sideways and keeps the active tab in view; in Arabic it runs right to left.
 * Used for the client workspace and for grouped menu areas (Inbox, Bookings, Billing...).
 */
export function Tabs({ items, label }: { items: TabItem[]; label: string }) {
  const path = usePathname() ?? "";
  const on = activeTab(path, items);
  const ref = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => { ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [on]);
  return (
    <nav className="ptabs" aria-label={label}>
      {items.map((t, i) => (
        <Link
          key={t.href} href={t.href} ref={i === on ? ref : undefined}
          className={i === on ? "ptab active" : "ptab"} aria-current={i === on ? "page" : undefined}
        >
          {t.icon && <Icon name={t.icon} size={16} />}
          <span>{t.label}</span>
          {t.badge !== undefined && t.badge !== "" && t.badge !== 0 && <span className="pill">{t.badge}</span>}
        </Link>
      ))}
    </nav>
  );
}
