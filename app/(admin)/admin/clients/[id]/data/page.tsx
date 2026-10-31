import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { getTenant } from "@/lib/data";
import { PageHead } from "@/components/ui";
import { DataView, type DataSearch } from "@/components/DataView";

export default async function AdminDataPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<DataSearch> }) {
  await requireAdmin();
  const { id } = await params;
  const tenant = await getTenant(id);
  if (!tenant) notFound();
  const [{ t, locale }, sp] = [await getT(tenant), await searchParams];
  return (
    <>
      <PageHead
        title={t("data.title")}
        subtitle={t("data.help")}
      />
      <DataView tenant={tenant} scope="admin" sp={sp} t={t} locale={locale} base={`/admin/clients/${id}/data`} />
    </>
  );
}
