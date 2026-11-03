import { getT } from "@/lib/i18n";
import { loadFees } from "@/lib/studio-server";
import { saveFeesAction } from "@/lib/studio-actions";
import { loadInsights } from "@/lib/account-server";
import { AccountInsights } from "@/components/AccountInsights";
import { Fold } from "@/components/Fold";
import { Notice, PageHead } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";

/**
 * Billing > ElevenLabs account (moved here from Platform settings, 2026-11-03): the credits left, usage in plain words, the plan
 * explained, the forecast per client, and the ElevenLabs fees used for every client's cost and margin.
 */
export default async function ElevenLabsAccount({ searchParams }: { searchParams: Promise<{ feesSaved?: string; feesBad?: string; refreshed?: string }> }) {
  const sp = await searchParams;
  const [{ t, locale }, fees, ins] = await Promise.all([getT(), loadFees(), loadInsights()]);
  return (
    <>
      <PageHead title={t("billing.elevenlabs")} />
      {sp.refreshed && <Notice tone="ok">{t("acct.refreshed")}</Notice>}
      <AccountInsights ins={ins} t={t} locale={locale} />
      <Fold id="fees" open={Boolean(sp.feesSaved || sp.feesBad)} title={t("studio.fees.title")} hint={t("platform.fees.help")}>
        {sp.feesSaved && <Notice tone="ok">{t("studio.fees.saved")}</Notice>}
        {sp.feesBad && <Notice tone="warn">{t("studio.fees.bad")}</Notice>}
        <form action={saveFeesAction} className="stack">
          <div className="grid two">
            <label>{t("studio.fees.minute")}<input type="number" name="minuteUsd" defaultValue={fees.minuteUsd} min={0} max={9.999} step="any" dir="ltr" inputMode="decimal" /></label>
            <label>{t("studio.fees.message")}<input type="number" name="messageUsd" defaultValue={fees.messageUsd} min={0} max={9.999} step="any" dir="ltr" inputMode="decimal" /></label>
          </div>
          <small className="muted">{t("studio.fees.where")}</small>
          <div><SubmitButton className="btn" type="submit">{t("studio.fees.save")}</SubmitButton></div>
        </form>
      </Fold>
    </>
  );
}
