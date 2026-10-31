"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icons";
import { navActive } from "@/lib/nav";

export function NavLink({ href, exact, also, icon, children }: { href: string; exact?: boolean; also?: string[]; icon?: string; children: React.ReactNode }) {
  const path = usePathname();
  const active = navActive(path, href, exact, also);
  return (
    <Link href={href} className={active ? "nav-link active" : "nav-link"} aria-current={active ? "page" : undefined}>
      {icon && <Icon name={icon} />}
      {children}
    </Link>
  );
}
