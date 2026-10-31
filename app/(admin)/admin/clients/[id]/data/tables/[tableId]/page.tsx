import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { getDataRows, getDataTable, getTenant } from "@/lib/data";
import { tableName } from "@/lib/custom-tables";
import { PageHead } from "@/components/ui";
import { Fold } from "@/components/Fold";
import { TableDelete, TableDesigner, TableRows, type TablesSearch } from "@/components/TablesView";

/** One custom table for the admin: its rows (always editable here), its columns and settings, and deleting it. */
export default async function AdminTablePage({ params, searchParams }: { params: Promise<{ id: string; tableId: string }>; searchParams: Promise<TablesSearch> }) {
  await requireAdmin();
  const { id, tableId } = await params;
  const tenant = await getTenant(id);
  const table = tenant && /^[\w-]{1,64}$/.test(tableId) ? await getDataTable(id, tableId) : undefined;
  if (!tenant || !table) notFound();
  const [{ t, locale }, rows, sp] = await Promise.all([getT(tenant), getDataRows(id, table.id), searchParams]);
  const base = `/admin/clients/${id}/data/tables`;
  const designErr = ["no_name", "duplicate_name", "no_fields", "too_many_fields", "bad_field"].includes(sp.err ?? "");
  return (
    <>
      <PageHead title={tableName(table, locale)} subtitle={t("tables.rowsHelp")} actions={<Link className="btn ghost" href={base}>{t("tables.all")}</Link>} />
      <TableRows tenant={tenant} table={table} rows={rows} sp={sp} canEdit admin t={t} locale={locale} />
      <Fold id="design" title={t("tables.design")} hint={t("tables.designHint")} open={designErr}>
        <TableDesigner tenant={tenant} table={table} start={table} base={base} t={t} />
      </Fold>
      <TableDelete tenant={tenant} table={table} open={sp.err === "confirm"} t={t} />
    </>
  );
}
