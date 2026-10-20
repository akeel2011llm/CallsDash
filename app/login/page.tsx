import { redirect } from "next/navigation";
import { demoMode, getSession } from "@/lib/auth";
import { login, loginWithPassword } from "@/lib/actions";
import { supabaseConfigured } from "@/lib/supabase";
import { getT } from "@/lib/i18n";
import { listTenants } from "@/lib/data";
import { publicBranding } from "@/lib/brand-image";
import { patternOf, themeVars } from "@/lib/theme";
import { LocaleSwitch } from "@/components/LocaleSwitch";
import { ReceptionArt } from "@/components/art";
import { Notice } from "@/components/ui";
import { Suspense } from "react";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; c?: string }> }) {
  const { error, c } = await searchParams;
  // one address for everyone: people who are already signed in go straight to their own portal
  const session = await getSession();
  if (session) redirect(session.role === "admin" ? "/admin" : "/app");
  const { t, locale } = await getT();
  const demo = demoMode();
  const tenants = demo || c ? await listTenants() : [];
  // a client's own sign-in page: /login?c=<slug>
  const tenant = c ? tenants.find((x) => x.slug === c) : undefined;
  const brand = tenant ? publicBranding(tenant) : undefined;
  const brandName = brand && (locale === "ar" ? brand.displayNameAr : brand.displayName);
  const tagline = brand && (locale === "ar" ? brand.taglineAr : brand.tagline);
  const pattern = brand ? patternOf(brand) : "waves";
  const style = brand ? (themeVars(brand) as React.CSSProperties) : undefined;
  const coverStyle = brand?.coverUrl ? ({ "--cover": `url("${brand.coverUrl}")` } as React.CSSProperties) : undefined;
  const logo = brand?.logoUrl ? <img src={brand.logoUrl} alt="" /> : (brandName ?? "CallsDash").trim().charAt(0);
  return (
    <div className="login-split" style={style}>
      <aside className="cover" data-pattern={pattern === "none" ? undefined : pattern} data-cover={brand?.coverUrl ? "" : undefined} style={coverStyle}>
        <div className="brand">
          <span className="logo" aria-hidden>{logo}</span>
          <div><strong>{brandName ?? "CallsDash"}</strong></div>
        </div>
        {!brand?.coverUrl && <ReceptionArt className="art" />}
        <div className="cover-copy">
          <h2>{tagline || t("login.tagline")}</h2>
          <p>{t("login.tagline.sub")}</p>
        </div>
      </aside>
      <main className="login-pane">
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap", alignItems: "flex-start" }}>
            <div>
              <h1>{t("login.welcome")}</h1>
              <span className="muted">{brandName ? brandName : t("login.subtitle")}</span>
            </div>
            <Suspense fallback={null}><LocaleSwitch locale={locale} /></Suspense>
          </div>
          {demo ? (
            <>
              <Notice>{t("login.demoNote")}</Notice>
              <form action={login} className="stack">
                {!brand && <SubmitButton className="btn" name="who" value="admin">{t("login.admin")}</SubmitButton>}
                {tenants.filter((x) => !brand || x.slug === c).map((x) => (
                  <SubmitButton key={x.id} className="btn ghost" name="who" value={`client:${x.id}`}>
                    {t("login.client")} {locale === "ar" ? x.branding.displayNameAr : x.branding.displayName}
                  </SubmitButton>
                ))}
              </form>
            </>
          ) : supabaseConfigured() ? (
            <form action={loginWithPassword} className="stack">
              {error && <Notice tone="warn">{t("login.failed")}</Notice>}
              <label>{t("login.email")}<input name="email" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" required /></label>
              <label>{t("login.password")}<input name="password" type="password" autoComplete="current-password" required /></label>
              <SubmitButton className="btn" type="submit">{t("login.submit")}</SubmitButton>
              <small className="muted">{t("login.help")}</small>
            </form>
          ) : (
            <Notice tone="warn">{t("login.notConfigured")}</Notice>
          )}
        </div>
      </main>
    </div>
  );
}
