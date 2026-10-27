import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getProfile } from "@/lib/data";
import { getT } from "@/lib/i18n";
import { AccountSections } from "@/components/AccountSections";
import { PageHead } from "@/components/ui";

/** The Settings page of every portal (admin, clinic, doctor): the person's own password and the guides they closed. */
export async function SettingsPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  const { t } = await getT();
  const me = s.userId ? await getProfile(s.userId) : undefined;
  return (
    <>
      <PageHead title={t("nav.settings")} />
      <section className="card stack" style={{ maxInlineSize: 560 }}>
        {me && <span className="muted">{t("account.signedInAs")} <span dir="ltr">{me.email}</span></span>}
        <AccountSections session={s} />
      </section>
    </>
  );
}
