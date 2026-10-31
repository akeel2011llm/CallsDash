import type { Tenant } from "@/lib/types";
import type { Key } from "@/lib/i18n";
import { setupDetailsAction } from "@/lib/onboarding-actions";
import { SubmitButton } from "./SubmitButton";

/**
 * The client's website and contact details: the one place they are edited (they used to be on the Setup page and in the
 * branding studio as well). Used on the Business tab, and by the setup wizard's first step.
 */
export function ContactForm({ tenant, t, returnTo }: { tenant: Tenant; t: (k: Key) => string; returnTo: string }) {
  const b = tenant.branding;
  return (
    <form action={setupDetailsAction} className="stack">
      <input type="hidden" name="tenantId" value={tenant.id} /><input type="hidden" name="returnTo" value={returnTo} />
      <small className="muted">{t("setup.details.help")}</small>
      <div className="grid two" style={{ gap: ".75rem" }}>
        <label>{t("setup.domain")}<input name="domain" defaultValue={b.domain ?? ""} placeholder="example.bh" dir="ltr" maxLength={200} /></label>
        <label>{t("setup.phone")}<input name="supportPhone" defaultValue={b.supportPhone ?? ""} dir="ltr" maxLength={40} inputMode="tel" /></label>
        <label>{t("setup.email")}<input name="supportEmail" type="email" defaultValue={b.supportEmail ?? ""} dir="ltr" maxLength={120} /></label>
        <label>{t("setup.whatsapp")}<input name="supportWhatsapp" defaultValue={b.supportWhatsapp ?? ""} dir="ltr" maxLength={40} inputMode="tel" /></label>
      </div>
      <div><SubmitButton className="btn" type="submit">{t("common.save")}</SubmitButton></div>
    </form>
  );
}
