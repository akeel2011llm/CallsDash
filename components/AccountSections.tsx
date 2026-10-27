import { getSetting } from "@/lib/data";
import { GUIDES, guideOwnerKey, readHidden } from "@/lib/guides";
import { showGuideAction } from "@/lib/guide-actions";
import { getT } from "@/lib/i18n";
import { passwordText } from "@/lib/user-text";
import type { Session } from "@/lib/types";
import { PasswordForm } from "@/components/UserForms";
import { SubmitButton } from "@/components/SubmitButton";

/**
 * What a person can change about themselves: their password, and the guides they closed. Shown on the Settings page of each
 * portal and on the full-page account screen a person with a temporary password is sent to (where only the password shows).
 */
export async function AccountSections({ session, passwordOnly }: { session: Session; passwordOnly?: boolean }) {
  const { t } = await getT();
  const hidden = passwordOnly ? [] : readHidden(await getSetting(guideOwnerKey(session)));
  return (
    <>
      <h2>{t("account.changePassword")}</h2>
      <PasswordForm text={passwordText(t)} />
      {!passwordOnly && (
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
    </>
  );
}
