import { demoMode } from "@/lib/auth";
import { login, loginWithPassword } from "@/lib/actions";
import { supabaseConfigured } from "@/lib/supabase";
import { getT } from "@/lib/i18n";
import { listTenants } from "@/lib/data";
import { LocaleSwitch } from "@/components/LocaleSwitch";
import { Notice } from "@/components/ui";
import { Suspense } from "react";
import { themeVars } from "@/lib/theme";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; c?: string }> }) {
  const { error, c } = await searchParams;
  const { t, locale } = await getT();
  const demo = demoMode();
  const tenants = demo || c ? await listTenants() : [];
  // a client's own sign-in page: /login?c=<slug>
  const brand = c ? tenants.find((x) => x.slug === c)?.branding : undefined;
  const brandName = brand && (locale === "ar" ? brand.displayNameAr : brand.displayName);
  const tagline = brand && (locale === "ar" ? brand.taglineAr : brand.tagline);
  return (
    <div className="login" style={brand ? (themeVars(brand) as React.CSSProperties) : undefined}>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="row" style={{ flexWrap: "nowrap" }}>
            {brand && <span className="logo">{brand.logoUrl ? <img src={brand.logoUrl} alt="" /> : brandName?.trim().charAt(0)}</span>}
            <div>
              <h1>{brandName ?? t("login.title")}</h1>
              <span className="muted">{tagline || t("login.subtitle")}</span>
            </div>
          </div>
          <Suspense fallback={null}><LocaleSwitch locale={locale} /></Suspense>
        </div>
        {demo ? (
          <>
            <Notice>{t("login.demoNote")}</Notice>
            <form action={login} className="stack">
              {!brand && <SubmitButton className="btn" name="who" value="admin">{t("login.admin")}</SubmitButton>}
              {tenants.filter((x) => !brand || x.slug === c).map((c) => (
                <SubmitButton key={c.id} className="btn ghost" name="who" value={`client:${c.id}`}>
                  {t("login.client")} {locale === "ar" ? c.branding.displayNameAr : c.branding.displayName}
                </SubmitButton>
              ))}
            </form>
          </>
        ) : supabaseConfigured() ? (
          <form action={loginWithPassword} className="stack">
            {error && <Notice tone="warn">{t("login.failed")}</Notice>}
            <label>{t("login.email")}<input name="email" type="email" autoComplete="username" required /></label>
            <label>{t("login.password")}<input name="password" type="password" autoComplete="current-password" required /></label>
            <SubmitButton className="btn" type="submit">{t("login.submit")}</SubmitButton>
          </form>
        ) : (
          <Notice tone="warn">{t("login.notConfigured")}</Notice>
        )}
      </div>
    </div>
  );
}
