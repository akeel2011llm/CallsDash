import { demoMode } from "@/lib/auth";
import { login, loginWithPassword } from "@/lib/actions";
import { supabaseConfigured } from "@/lib/supabase";
import { getT } from "@/lib/i18n";
import { listTenants } from "@/lib/data";
import { LocaleSwitch } from "@/components/LocaleSwitch";
import { Notice } from "@/components/ui";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { t, locale } = await getT();
  const demo = demoMode();
  return (
    <div className="login">
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <h1>{t("login.title")}</h1>
            <span className="muted">{t("login.subtitle")}</span>
          </div>
          <Suspense fallback={null}><LocaleSwitch locale={locale} /></Suspense>
        </div>
        {demo ? (
          <>
            <Notice>{t("login.demoNote")}</Notice>
            <form action={login} className="stack">
              <button className="btn" name="who" value="admin">{t("login.admin")}</button>
              {(await listTenants()).map((c) => (
                <button key={c.id} className="btn ghost" name="who" value={`client:${c.id}`}>
                  {t("login.client")} {locale === "ar" ? c.branding.displayNameAr : c.branding.displayName}
                </button>
              ))}
            </form>
          </>
        ) : supabaseConfigured() ? (
          <form action={loginWithPassword} className="stack">
            {error && <Notice tone="warn">{t("login.failed")}</Notice>}
            <label>{t("login.email")}<input name="email" type="email" autoComplete="username" required /></label>
            <label>{t("login.password")}<input name="password" type="password" autoComplete="current-password" required /></label>
            <button className="btn" type="submit">{t("login.submit")}</button>
          </form>
        ) : (
          <Notice tone="warn">{t("login.notConfigured")}</Notice>
        )}
      </div>
    </div>
  );
}
