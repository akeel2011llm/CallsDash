import { Suspense } from "react";
import { logout, exitViewAs } from "@/lib/actions";
import { getT } from "@/lib/i18n";
import { LocaleSwitch } from "./LocaleSwitch";
import { NavLink } from "./NavLink";
import { SubmitButton } from "@/components/SubmitButton";

export interface NavItem {
  href: string;
  label: string;
  exact?: boolean;
  badge?: string | number;
}

export async function Shell({
  title, subtitle, color, nav, viewingAs, children,
}: {
  title: string; subtitle?: string; color?: string; nav: NavItem[]; viewingAs?: boolean; children: React.ReactNode;
}) {
  const { t, locale } = await getT();
  return (
    <div className="shell" style={color ? ({ ["--brand" as string]: color } as React.CSSProperties) : undefined}>
      <aside className="sidebar">
        <div className="brand">
          <span className="logo" aria-hidden>{title.trim().charAt(0)}</span>
          <div>
            <strong>{title}</strong>
            {subtitle && <small>{subtitle}</small>}
          </div>
        </div>
        <nav>
          {nav.map((n) => (
            <NavLink key={n.href} href={n.href} exact={n.exact}>
              {n.label}
              {n.badge ? <span className="pill">{n.badge}</span> : null}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <Suspense fallback={null}><LocaleSwitch locale={locale} /></Suspense>
          <form action={logout}><SubmitButton className="btn ghost" type="submit">{t("nav.signOut")}</SubmitButton></form>
        </div>
      </aside>
      <main className="main">
        {viewingAs && (
          <div className="banner">
            <span>{t("nav.viewingAs")}</span>
            <form action={exitViewAs}><SubmitButton className="btn small" type="submit">{t("nav.exitView")}</SubmitButton></form>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
