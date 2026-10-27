import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, homeFor } from "@/lib/auth";
import { getProfile, getSetting } from "@/lib/data";
import { GUIDES, guideOwnerKey, readHidden } from "@/lib/guides";
import { showGuideAction } from "@/lib/guide-actions";
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
  const home = homeFor(s);
  const hidden = readHidden(await getSetting(guideOwnerKey(s)));
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
        {!s.mustChangePassword && (
          <>
            <h2>{t("account.guides.title")}</h2>
            <p className="muted" style={{ margin: 0 }}>{t("account.guides.help")}</p>
            {hidden.length === 0 ? <small className="muted">{t("account.guides.none")}</small> : (
              <>
                <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: ".4rem" }}>
                  {hidden.map((id) => (
                    <li key={id} className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
                      <span>{t(GUIDES[id])}</span>
                      <form action={showGuideAction}><input type="hidden" name="id" value={id} /><SubmitButton className="btn small ghost" type="submit" style={{ whiteSpace: "nowrap" }}>{t("account.guides.show")}</SubmitButton></form>
                    </li>
                  ))}
                </ul>
                <form action={showGuideAction}><SubmitButton className="btn small" type="submit">{t("account.guides.showAll")}</SubmitButton></form>
              </>
            )}
          </>
        )}
        <div className="row" style={{ justifyContent: "space-between" }}>
          {!s.mustChangePassword ? <Link href={home}>{t("common.back")}</Link> : <span />}
          <form action={logout}><SubmitButton className="btn small ghost" type="submit">{t("nav.signOut")}</SubmitButton></form>
        </div>
      </div>
    </main>
  );
}
