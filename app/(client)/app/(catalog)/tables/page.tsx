import { requireClient } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { getDataRows, getDataTables } from "@/lib/data";
import { PageHead } from "@/components/ui";
import { TablesList } from "@/components/TablesView";

/** Catalog > Custom tables: the lists the administrator set up for this business (milestone 6c). Every staff member can read them. */
export default async function TablesPage() {
  const { tenant } = await requireClient();
  const { t, locale } = await getT(tenant);
  const tables = await getDataTables(tenant.id);
  const counts = Object.fromEntries(await Promise.all(tables.map(async (x) => [x.id, (await getDataRows(tenant.id, x.id)).length] as const)));
  return (
    <>
      <PageHead title={t("tables.title")} subtitle={t("tables.clientHelp")} />
      <div className="card"><TablesList tables={tables} counts={counts} base="/app/tables" admin={false} t={t} locale={locale} /></div>
    </>
  );
}
