import Link from "next/link";
import { notFound } from "next/navigation";
import { requireClient } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { getDataRows, getDataTable } from "@/lib/data";
import { tableName } from "@/lib/custom-tables";
import { PageHead } from "@/components/ui";
import { TableRows, type TablesSearch } from "@/components/TablesView";

/** One custom table: managers add, edit, delete and import rows when the administrator allowed it; everyone else reads. */
export default async function TablePage({ params, searchParams }: { params: Promise<{ tableId: string }>; searchParams: Promise<TablesSearch> }) {
  const { tenant, viewingAsAdmin, staffRole } = await requireClient();
  const { tableId } = await params;
  const table = /^[\w-]{1,64}$/.test(tableId) ? await getDataTable(tenant.id, tableId) : undefined;
  if (!table) notFound();
  const [{ t, locale }, rows, sp] = await Promise.all([getT(tenant), getDataRows(tenant.id, table.id), searchParams]);
  const canEdit = viewingAsAdmin || (staffRole === "manager" && table.clientEdit);
  return (
    <>
      <PageHead title={tableName(table, locale)} subtitle={t("tables.rowsHelp")} actions={<Link className="btn ghost" href="/app/tables">{t("tables.all")}</Link>} />
      <TableRows tenant={tenant} table={table} rows={rows} sp={sp} canEdit={canEdit} admin={false} t={t} locale={locale} />
    </>
  );
}
