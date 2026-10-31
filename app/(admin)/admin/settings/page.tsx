import { getT } from "@/lib/i18n";
import { loadFees } from "@/lib/studio-server";
import { saveFeesAction } from "@/lib/studio-actions";
import { SettingsPage } from "@/components/SettingsPage";
import { ServerKeys } from "@/components/ServerKeys";
import { Fold } from "@/components/Fold";
import { Notice } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";

/**
 * Platform settings (docs/reorganization.md, milestone 4): the admin's own account and guides, plus everything that is the
 * same for every client: the server keys in Vercel and the ElevenLabs fees used for cost and margin.
 */
export default async function PlatformSettings({ searchParams }: { searchParams: Promise<{ feesSaved?: string; feesBad?: string }> }) {
  const sp = await searchParams;
  const [{ t }, fees] = await Promise.all([getT(), loadFees()]);
  return (
    <SettingsPage title={t("nav.platform")}>
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
      <ServerKeys t={t} />
    </SettingsPage>
  );
}
