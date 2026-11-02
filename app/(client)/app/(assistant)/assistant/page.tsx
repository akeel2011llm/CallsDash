import { requireClient } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { PageHead } from "@/components/ui";
import { TryAssistant } from "@/components/TryAssistant";

/** Assistant > Test: talk to the real assistant (written chat or the website widget) after changing its knowledge or settings. */
export default async function TestAssistant() {
  const { tenant } = await requireClient();
  const { t } = await getT(tenant);
  return (
    <>
      <PageHead title={t("nav.test")} subtitle={t("assistant.test.subtitle")} />
      <TryAssistant tenant={tenant} />
    </>
  );
}
