import Link from "next/link";
import { Suspense } from "react";
import { logout, exitViewAs } from "@/lib/actions";
import { getT } from "@/lib/i18n";
import { sidebarOf, themeVars } from "@/lib/theme";
import type { Branding } from "@/lib/types";
import { LocaleSwitch } from "./LocaleSwitch";
import { NavLink } from "./NavLink";
import { Icon } from "./icons";
import { SubmitButton } from "@/components/SubmitButton";
import { InstallPrompt } from "./InstallPrompt";
import { ShellFrame } from "./ShellFrame";

export interface NavItem {
  href: string;
  label: string;
  icon?: string;
  exact?: boolean;
  badge?: string | number;
  /** A small heading shown above this item. */
  group?: string;
  /** Also shown in the bottom bar on phones (the first four marked, or the first four items). */
  tab?: boolean;
  /** A shorter name for the bottom bar. */
  short?: string;
  /** Other addresses this item stands for (the tabs of a grouped item), so it stays active on them. */
  also?: string[];
}

export async function Shell({
  title, subtitle, branding, nav, viewingAs, children,
}: {
  title: string; subtitle?: string; branding?: Branding; nav: NavItem[]; viewingAs?: boolean; children: React.ReactNode;
}) {
  const { t, locale } = await getT();
  const vars = branding ? themeVars(branding) : undefined;
  const support = branding?.supportPhone || branding?.supportEmail;
  const tabs = (nav.some((n) => n.tab) ? nav.filter((n) => n.tab) : nav).slice(0, 4);
  const logo = branding?.logoUrl ? <img src={branding.logoUrl} alt="" /> : title.trim().charAt(0);
  // the first item of every portal's menu is its home page
  const home = nav[0]?.href ?? "/";
  return (
    <ShellFrame
      style={vars as React.CSSProperties | undefined}
      title={title}
      logo={logo}
      home={home}
      settings={nav.find((n) => n.icon === "gear")}
      tabs={tabs.map((n) => ({ ...n, label: n.short ?? n.label }))}
      menuLabel={t("nav.menu")}
      moreLabel={t("nav.more")}
      sidebar={(
      <aside className="sidebar" data-style={branding ? sidebarOf(branding) : "dark"}>
        <Link className="brand" href={home} aria-label={`${title}: ${t("nav.home")}`}>
          <span className="logo" aria-hidden>
            {logo}
          </span>
          <div>
            <strong>{title}</strong>
            {subtitle && <small>{subtitle}</small>}
          </div>
        </Link>
        <nav>
          {nav.map((n) => (
            <div key={n.href} style={{ display: "contents" }}>
              {n.group && <div className="nav-label">{n.group}</div>}
              <NavLink href={n.href} exact={n.exact} also={n.also} icon={n.icon}>
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
          <InstallPrompt label={t("pwa.install")} iosHint={t("pwa.iosHint")} />
          <Suspense fallback={null}><LocaleSwitch locale={locale} /></Suspense>
          <form action={logout}><SubmitButton className="btn ghost" type="submit"><Icon name="logout" size={18} />{t("nav.signOut")}</SubmitButton></form>
          {!branding?.hidePoweredBy && <div className="powered">Powered by CallsDash</div>}
        </div>
      </aside>
      )}
    >
      <main className="main">
        {viewingAs && (
          <div className="banner">
            <span>{t("nav.viewingAs")}</span>
            <form action={exitViewAs}><SubmitButton className="btn small" type="submit">{t("nav.exitView")}</SubmitButton></form>
          </div>
        )}
        {children}
      </main>
    </ShellFrame>
  );
}
