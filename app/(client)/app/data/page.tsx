import { redirect } from "next/navigation";
import { requireClient } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { Notice, PageHead } from "@/components/ui";
import { DataView, type DataSearch } from "@/components/DataView";

export default async function DataPage({ searchParams }: { searchParams: Promise<DataSearch> }) {
  const { tenant, staffRole, viewingAsAdmin } = await requireClient();
  if (staffRole !== "manager") redirect("/app");
  const [{ t, locale }, sp] = [await getT(), await searchParams];
  // an administrator viewing as the clinic keeps the screen even while it is off for the clinic itself
  if (!tenant.permissions.dataManager && !viewingAsAdmin) {
    return (
      <>
        <PageHead title={t("data.title")} />
        <Notice tone="warn">{t("data.locked")}</Notice>
      </>
    );
  }
  return (
    <>
      <PageHead title={t("data.title")} subtitle={t("data.help")} />
      <DataView tenant={tenant} scope="client" sp={sp} t={t} locale={locale} base="/app/data" />
    </>
  );
}
