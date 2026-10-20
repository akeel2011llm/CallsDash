import { Suspense } from "react";
import { logout, exitViewAs } from "@/lib/actions";
import { getT } from "@/lib/i18n";
import { sidebarOf, themeVars } from "@/lib/theme";
import type { Branding } from "@/lib/types";
import { LocaleSwitch } from "./LocaleSwitch";
import { NavLink } from "./NavLink";
import { Icon } from "./icons";
import { SubmitButton } from "@/components/SubmitButton";

export interface NavItem {
  href: string;
  label: string;
  icon?: string;
  exact?: boolean;
  badge?: string | number;
  /** A small heading shown above this item. */
  group?: string;
}

export async function Shell({
  title, subtitle, branding, nav, viewingAs, children,
}: {
  title: string; subtitle?: string; branding?: Branding; nav: NavItem[]; viewingAs?: boolean; children: React.ReactNode;
}) {
  const { t, locale } = await getT();
  const vars = branding ? themeVars(branding) : undefined;
  const support = branding?.supportPhone || branding?.supportEmail;
  return (
    <div className="shell" style={vars as React.CSSProperties | undefined}>
      <aside className="sidebar" data-style={branding ? sidebarOf(branding) : "dark"}>
        <div className="brand">
          <span className="logo" aria-hidden>
            {branding?.logoUrl ? <img src={branding.logoUrl} alt="" /> : title.trim().charAt(0)}
          </span>
          <div>
            <strong>{title}</strong>
            {subtitle && <small>{subtitle}</small>}
          </div>
        </div>
        <nav>
          {nav.map((n) => (
            <div key={n.href} style={{ display: "contents" }}>
              {n.group && <div className="nav-label">{n.group}</div>}
              <NavLink href={n.href} exact={n.exact} icon={n.icon}>
                <span className="grow">{n.label}</span>
                {n.badge ? <span className="pill">{n.badge}</span> : null}
              </NavLink>
            </div>
          ))}
        </nav>
        <div className="side-foot">
          {support && (
            <div className="powered" style={{ paddingBlockEnd: ".35rem" }}>
              {branding?.supportPhone && <div dir="ltr">{branding.supportPhone}</div>}
              {branding?.supportEmail && <div dir="ltr">{branding.supportEmail}</div>}
            </div>
          )}
          <Suspense fallback={null}><LocaleSwitch locale={locale} /></Suspense>
          <form action={logout}><SubmitButton className="btn ghost" type="submit"><Icon name="logout" size={18} />{t("nav.signOut")}</SubmitButton></form>
          {!branding?.hidePoweredBy && <div className="powered">Powered by CallsDash</div>}
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
