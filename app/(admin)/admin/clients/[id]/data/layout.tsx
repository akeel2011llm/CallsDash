import { getT } from "@/lib/i18n";
import { getTenant } from "@/lib/data";
import { Tabs } from "@/components/Tabs";

/** The client's Data tab has two parts: the built-in lists and photos, and the custom tables the admin designs (milestone 6c). */
export default async function DataLayout({ params, children }: { params: Promise<{ id: string }>; children: React.ReactNode }) {
  const { id } = await params;
  const tenant = await getTenant(id);
  const { t } = await getT(tenant ?? undefined);
  const base = `/admin/clients/${id}/data`;
  return (
    <>
      <Tabs label={t("ws.data")} items={[{ href: base, label: t("nav.dataPhotos"), exact: true }, { href: `${base}/tables`, label: t("nav.tables") }]} />
      {children}
    </>
  );
}
