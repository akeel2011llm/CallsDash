import { demoMode } from "@/lib/auth";
import { login } from "@/lib/actions";
import { getT } from "@/lib/i18n";
import { listTenants } from "@/lib/store";
import { LocaleSwitch } from "@/components/LocaleSwitch";
import { Notice } from "@/components/ui";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
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
              {listTenants().map((c) => (
                <button key={c.id} className="btn ghost" name="who" value={`client:${c.id}`}>
                  {t("login.client")} {locale === "ar" ? c.branding.displayNameAr : c.branding.displayName}
                </button>
              ))}
            </form>
          </>
        ) : (
          <Notice tone="warn">{t("login.notConfigured")}</Notice>
        )}
      </div>
    </div>
  );
}
