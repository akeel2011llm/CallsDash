import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getT, type Key } from "@/lib/i18n";
import { fill } from "@/lib/format";
import { getDataRows, getDataTables, getTenant } from "@/lib/data";
import { MAX_TABLES, TABLE_PRESETS } from "@/lib/custom-tables";
import { Notice, PageHead } from "@/components/ui";
import { Guide } from "@/components/Guide";
import { TablesList, tableError } from "@/components/TablesView";

/** The admin's list of a client's custom tables, and the ways to start a new one (milestone 6c). */
export default async function AdminTablesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string; deleted?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const tenant = await getTenant(id);
  if (!tenant) notFound();
  const [{ t, locale }, sp, tables] = await Promise.all([getT(tenant), searchParams, getDataTables(id)]);
  const counts = Object.fromEntries(await Promise.all(tables.map(async (x) => [x.id, (await getDataRows(id, x.id)).length] as const)));
  const base = `/admin/clients/${id}/data/tables`;
  const err = sp.err && /^[a-z_]+$/.test(sp.err) ? sp.err : "";
  return (
    <>
      <PageHead title={t("tables.title")} subtitle={t("tables.adminHelp")} />
      <Guide id="tables">
        <ol className="stack">{(["1", "2", "3", "4"] as const).map((n) => <li key={n}>{t(`tables.guide.${n}` as Key)}</li>)}</ol>
      </Guide>
      {sp.deleted && <Notice tone="ok">{t("tables.n.deleted")}</Notice>}
      {err && <Notice tone="warn">{tableError(t, err)}</Notice>}
      <section className="card stack">
        <h2>{t("tables.new")}</h2>
        {tables.length >= MAX_TABLES ? <Notice tone="warn">{fill(t("tables.err.too_many_tables"), { col: "" })}</Notice> : (
          <div className="row">
            {(Object.keys(TABLE_PRESETS) as (keyof typeof TABLE_PRESETS)[]).map((p) => (
              <Link key={p} className={p === "blank" ? "btn" : "btn ghost"} href={`${base}/new?preset=${p}`}>{t(`tables.preset.${p}` as Key)}</Link>
            ))}
          </div>
        )}
        <small className="muted">{t("tables.presetHelp")}</small>
      </section>
      <section className="card stack">
        <h2>{fill(t("tables.count.tables"), { n: tables.length, max: MAX_TABLES })}</h2>
        <TablesList tables={tables} counts={counts} base={base} admin t={t} locale={locale} />
      </section>
    </>
  );
}
