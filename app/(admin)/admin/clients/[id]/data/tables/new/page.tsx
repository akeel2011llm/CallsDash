import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { getTenant } from "@/lib/data";
import { TABLE_PRESETS, isPreset } from "@/lib/custom-tables";
import { Notice, PageHead } from "@/components/ui";
import { TableDesigner, tableError } from "@/components/TablesView";

/** A new custom table, started from a ready-made set of columns or from one blank column. */
export default async function NewTablePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ preset?: string; err?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const tenant = await getTenant(id);
  if (!tenant) notFound();
  const [{ t }, sp] = await Promise.all([getT(tenant), searchParams]);
  const start = TABLE_PRESETS[isPreset(sp.preset) ? sp.preset : "blank"];
  const err = sp.err && /^[a-z_]+$/.test(sp.err) ? sp.err : "";
  return (
    <>
      <PageHead title={t("tables.new")} subtitle={t("tables.newHelp")} />
      {err && <Notice tone="warn">{tableError(t, err)}</Notice>}
      <section className="card"><TableDesigner tenant={tenant} start={start} preset={isPreset(sp.preset) ? sp.preset : undefined} base={`/admin/clients/${id}/data/tables`} t={t} /></section>
    </>
  );
}
