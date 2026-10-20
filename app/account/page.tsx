import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getProfile } from "@/lib/data";
import { getT } from "@/lib/i18n";
import { logout } from "@/lib/actions";
import { passwordText } from "@/lib/user-text";
import { PasswordForm } from "@/components/UserForms";
import { LocaleSwitch } from "@/components/LocaleSwitch";
import { Notice } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

/** Your own account: change your password. A person with a temporary password is sent here and cannot go anywhere else until they have. */
export default async function Account() {
  const s = await getSession();
  if (!s) redirect("/login");
  const { t, locale } = await getT();
  const me = s.userId ? await getProfile(s.userId) : undefined;
  const home = s.role === "admin" ? "/admin" : "/app";
  return (
    <main className="auth-page">
      <div className="card stack">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap", alignItems: "flex-start" }}>
          <div>
            <h1>{t("account.title")}</h1>
            {me && <span className="muted">{t("account.signedInAs")} <span dir="ltr">{me.email}</span></span>}
          </div>
          <Suspense fallback={null}><LocaleSwitch locale={locale} /></Suspense>
        </div>
        {s.mustChangePassword && <Notice tone="warn">{t("account.force")}</Notice>}
        <h2>{t("account.changePassword")}</h2>
        <PasswordForm text={passwordText(t)} />
        <div className="row" style={{ justifyContent: "space-between" }}>
          {!s.mustChangePassword ? <Link href={home}>{t("common.back")}</Link> : <span />}
          <form action={logout}><SubmitButton className="btn small ghost" type="submit">{t("nav.signOut")}</SubmitButton></form>
        </div>
      </div>
    </main>
  );
}
