import { getT } from "@/lib/i18n";
import { SettingsPage } from "@/components/SettingsPage";
import { ServerKeys } from "@/components/ServerKeys";

/**
 * Platform settings: the admin's own password and guides, and the server settings (the keys set in Vercel). Money and usage
 * (ElevenLabs balance, fees, packages, reminders) live in Billing.
 */
export default async function PlatformSettings() {
  const { t } = await getT();
  return (
    <SettingsPage title={t("nav.platform")}>
      <ServerKeys t={t} />
    </SettingsPage>
  );
}
