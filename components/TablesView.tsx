import Link from "next/link";
import { dictionaries, type Key } from "@/lib/i18n";
import { fill, fmtDate } from "@/lib/format";
import { FIELD_TYPES, MAX_FIELDS, labelOf, searchRows, tableName } from "@/lib/custom-tables";
import { deleteRowsAction, deleteTableAction, importRowsAction, saveRowAction, saveTableAction } from "@/lib/table-actions";
import type { DataField, DataRow, DataTable, Locale, Tenant } from "@/lib/types";
import { Badge, Empty, Notice } from "./ui";
import { Fold } from "./Fold";
import { FoldControls } from "./FoldControls";
import { SubmitButton } from "./SubmitButton";
import { SelectAll } from "./SelectAll";

type T = (k: Key) => string;

export interface TablesSearch {
  q?: string; open?: string; saved?: string; removed?: string; deleted?: string; err?: string; col?: string; n?: string;
  imp?: string; added?: string; updated?: string; skipped?: string; more?: string; errs?: string; preset?: string;
}

const SHOWN = 100;
const hiddenScope = (tenant: Tenant, admin: boolean) => (
  <><input type="hidden" name="scope" value={admin ? "admin" : "client"} /><input type="hidden" name="tenantId" value={tenant.id} /></>
);

/** An error code from the address bar, in words. Codes are the ones lib/table-actions.ts and lib/custom-tables.ts send. */
export function tableError(t: T, code: string, col = ""): string {
  const key = `tables.err.${code}`;
  return fill(t((key in dictionaries.en ? key : "tables.err.other") as Key), { col });
}

/* ---------- list of tables ---------- */

/** The tables of one client, with how many rows each has and who may change them. */
export function TablesList({ tables, counts, base, admin, t, locale }: {
  tables: DataTable[]; counts: Record<string, number>; base: string; admin: boolean; t: T; locale: Locale;
}) {
  if (!tables.length) return <Empty kind="inbox">{admin ? t("tables.noneAdmin") : t("tables.noneClient")}</Empty>;
  return (
    <ul className="stack table-list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {tables.map((x) => (
        <li key={x.id} className="data-row">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ minInlineSize: 0 }}>
              <Link href={`${base}/${x.id}`}><strong>{tableName(x, locale)}</strong></Link>
              <div className="muted">{fill(t("tables.summary"), { rows: counts[x.id] ?? 0, cols: x.fields.length })}</div>
            </div>
            <div className="row" style={{ gap: ".35rem" }}>
              {x.assistant ? <Badge tone="info">{t("tables.badge.assistant")}</Badge> : <Badge>{t("tables.badge.private")}</Badge>}
              {x.clientEdit ? <Badge tone="ok">{t("tables.badge.clientEdit")}</Badge> : <Badge>{t("tables.badge.readOnly")}</Badge>}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ---------- the column designer (admin) ---------- */

/**
 * Name, settings and columns of a table. Each existing column keeps its key, so renaming it or changing its order keeps its values;
 * a ticked Remove drops the column and its values. Three empty lines add new columns.
 */
export function TableDesigner({ tenant, table, start, base, preset, t }: {
  tenant: Tenant; table?: DataTable; start: Pick<DataTable, "name" | "nameAr" | "fields">; base: string; preset?: string; t: T;
}) {
  const lines: (DataField | null)[] = [...start.fields, ...Array.from({ length: Math.min(3, MAX_FIELDS - start.fields.length) }, () => null)];
  return (
    <form action={saveTableAction} className="stack">
      {hiddenScope(tenant, true)}
      {table && <input type="hidden" name="id" value={table.id} />}
      {preset && <input type="hidden" name="preset" value={preset} />}
      <input type="hidden" name="n" value={lines.length} />
      <div className="form-cols">
        <label>{t("tables.name")}<input name="name" required maxLength={80} defaultValue={start.name} placeholder={t("tables.namePh")} /></label>
        <label>{t("tables.nameAr")}<input name="nameAr" maxLength={80} dir="rtl" defaultValue={start.nameAr ?? ""} /></label>
      </div>
      <label className="inline"><input type="checkbox" name="assistant" defaultChecked={table ? table.assistant : true} />{t("tables.assistantOn")}</label>
      <small className="muted">{t("tables.assistantHelp")}</small>
      <label className="inline"><input type="checkbox" name="clientEdit" defaultChecked={table ? table.clientEdit : true} />{t("tables.clientEditOn")}</label>
      <small className="muted">{t("tables.clientEditHelp")}</small>

      <h3>{t("tables.columns")}</h3>
      <small className="muted">{t("tables.columnsHelp")}</small>
      <ol className="stack col-lines" style={{ paddingInlineStart: 0, listStyle: "none" }}>
        {lines.map((f, i) => (
          <li key={f?.key ?? `new${i}`} className="col-line stack">
            {f && <input type="hidden" name={`f${i}_key`} value={f.key} />}
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>{f ? fill(t("tables.column"), { n: i + 1 }) : t("tables.newColumn")}</strong>
              {i === 0 && f ? <Badge tone="info">{t("tables.firstColumn")}</Badge> : null}
            </div>
            <div className="form-cols">
              <label>{t("tables.colLabel")}<input name={`f${i}_label`} maxLength={60} defaultValue={f?.label ?? ""} required={Boolean(f)} /></label>
              <label>{t("tables.colLabelAr")}<input name={`f${i}_labelAr`} maxLength={60} dir="rtl" defaultValue={f?.labelAr ?? ""} /></label>
              <label>{t("tables.colType")}
                <select name={`f${i}_type`} defaultValue={f?.type ?? "text"}>
                  {FIELD_TYPES.map((ty) => <option key={ty} value={ty}>{t(`tables.type.${ty}` as Key)}</option>)}
                </select>
              </label>
              <label>{t("tables.colOrder")}<input name={`f${i}_order`} type="number" min={1} max={60} defaultValue={i + 1} inputMode="numeric" /></label>
            </div>
            <label>{t("tables.colOptions")}<textarea name={`f${i}_options`} rows={2} defaultValue={(f?.options ?? []).join("\n")} placeholder={t("tables.colOptionsPh")} /></label>
            <div className="row">
              <label className="inline"><input type="checkbox" name={`f${i}_required`} defaultChecked={Boolean(f?.required) || i === 0} />{t("tables.colRequired")}</label>
              {f && i > 0 && <label className="inline"><input type="checkbox" name={`f${i}_remove`} />{t("tables.colRemove")}</label>}
            </div>
          </li>
        ))}
      </ol>
      {start.fields.length + 3 > MAX_FIELDS ? null : <small className="muted">{t("tables.moreColumns")}</small>}
      <div><SubmitButton className="btn" type="submit">{table ? t("common.save") : t("tables.create")}</SubmitButton></div>
      {!table && <Link className="muted" href={base}>{t("common.back")}</Link>}
    </form>
  );
}

/** The danger zone of a table: delete it with all rows, after typing its name. */
export function TableDelete({ tenant, table, open, t }: { tenant: Tenant; table: DataTable; open: boolean; t: T }) {
  return (
    <Fold id="delete" title={t("tables.delete.title")} hint={t("tables.delete.hint")} open={open} tone="danger">
      <form action={deleteTableAction} className="stack">
        {hiddenScope(tenant, true)}<input type="hidden" name="tableId" value={table.id} />
        <label>{fill(t("tables.delete.type"), { name: table.name })}<input name="confirmName" required autoComplete="off" placeholder={table.name} /></label>
        <div><SubmitButton className="btn danger" type="submit">{t("tables.delete.go")}</SubmitButton></div>
      </form>
    </Fold>
  );
}

/* ---------- rows ---------- */

/** The input for one column, by its type. */
/** One value's input for its column type. `prefix` names it: v_ in a table row, x_ for a client's own fields (components/ExtraFields.tsx). */
export function FieldInput({ f, value, t, locale, prefix = "v_" }: { f: DataField; value: string; t: T; locale: Locale; prefix?: string }) {
  const name = `${prefix}${f.key}`;
  const label = labelOf(f, locale);
  const req = Boolean(f.required);
  let input: React.ReactNode;
  switch (f.type) {
    case "longtext": input = <textarea name={name} rows={3} maxLength={4000} defaultValue={value} required={req} />; break;
    case "number": input = <input name={name} inputMode="decimal" defaultValue={value} required={req} />; break;
    case "price": input = <input name={name} inputMode="decimal" defaultValue={value} required={req} placeholder="0.000" />; break;
    case "stock": input = <input name={name} type="number" min={0} step={1} inputMode="numeric" defaultValue={value} required={req} />; break;
    case "date": input = <input name={name} type="date" defaultValue={value} required={req} />; break;
    case "link": input = <input name={name} type="url" maxLength={500} defaultValue={value} required={req} placeholder="https://" dir="ltr" />; break;
    case "yesno":
      input = <select name={name} defaultValue={value} required={req}><option value="">-</option><option value="yes">{t("tables.yes")}</option><option value="no">{t("tables.no")}</option></select>;
      break;
    case "choice":
      input = <select name={name} defaultValue={value} required={req}><option value="">-</option>{(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}</select>;
      break;
    default: input = <input name={name} maxLength={500} defaultValue={value} required={req} />;
  }
  return <label>{label}{req ? " *" : ""}{input}</label>;
}

/** A stored value as shown in a list: yes/no in words, a link shortened. */
function shown(f: DataField, v: string, t: T): string {
  if (f.type === "yesno") return v === "yes" ? t("tables.yes") : v === "no" ? t("tables.no") : v;
  if (f.type === "link") return v.replace(/^https?:\/\//, "").slice(0, 40);
  return v;
}

/**
 * Rows of one table: search, add, edit, bulk delete, and Excel or CSV import and export. `canEdit` is false for a read-only view
 * (a receptionist, or a table the admin keeps for themselves); everything still shows, the forms are switched off.
 */
export function TableRows({ tenant, table, rows, sp, canEdit, admin, t, locale }: {
  tenant: Tenant; table: DataTable; rows: DataRow[]; sp: TablesSearch; canEdit: boolean; admin: boolean; t: T; locale: Locale;
}) {
  const hidden = <>{hiddenScope(tenant, admin)}<input type="hidden" name="tableId" value={table.id} /></>;
  const tq = admin ? `&t=${encodeURIComponent(tenant.id)}` : "";
  const q = (sp.q ?? "").trim().slice(0, 80);
  const found = searchRows(table, rows, q);
  const limit = Math.min(Math.max(Number(sp.n) || SHOWN, SHOWN), 5000);
  const open = sp.open && /^[\w-]{1,64}$/.test(sp.open) ? sp.open : "";
  const err = sp.err && /^[a-z_]+$/.test(sp.err) ? sp.err : "";
  const colName = (key?: string) => { const f = table.fields.find((x) => x.key === key); return f ? labelOf(f, locale) : ""; };
  const [first, ...rest] = table.fields;
  const href = (n: number) => `?${new URLSearchParams({ ...(q ? { q } : {}), n: String(n) })}`;
  const rowForm = (r?: DataRow) => (
    <form action={saveRowAction} className="stack">
      {hidden}{r && <input type="hidden" name="rowId" value={r.id} />}
      <fieldset disabled={!canEdit} className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="form-cols">
          {table.fields.map((f) => <FieldInput key={f.key} f={f} value={r?.values[f.key] ?? ""} t={t} locale={locale} />)}
        </div>
        <div><SubmitButton className="btn small" type="submit">{r ? t("common.save") : t("tables.addRow")}</SubmitButton></div>
      </fieldset>
    </form>
  );
  return (
    <>
      {!canEdit && <Notice>{admin ? t("tables.readOnlyAdmin") : t("tables.readOnly")}</Notice>}
      {sp.saved === "row" && <Notice tone="ok">{t("tables.n.rowSaved")}</Notice>}
      {sp.saved === "table" && <Notice tone="ok">{t("tables.n.tableSaved")}</Notice>}
      {sp.removed && /^\d+$/.test(sp.removed) && <Notice tone="ok">{fill(t("tables.n.removed"), { n: sp.removed })}</Notice>}
      {err && <Notice tone="warn">{tableError(t, err, colName(sp.col))}</Notice>}
      {sp.imp && (
        <Notice tone={Number(sp.skipped) > 0 ? "warn" : "ok"}>
          <div className="stack" style={{ gap: ".25rem" }}>
            <span>{fill(t("tables.n.imported"), { added: Number(sp.added) || 0, updated: Number(sp.updated) || 0, skipped: Number(sp.skipped) || 0 })}</span>
            {sp.more === "1" && <span>{t("tables.n.more")}</span>}
            {(sp.errs ?? "").split(",").filter((e) => /^\d+\.[a-z_]+(\.[a-z0-9_]+)?$/.test(e)).map((e) => {
              const [line, code, key] = e.split(".");
              return <span key={e}>{fill(t("tables.n.line"), { line, reason: tableError(t, code, colName(key)) })}</span>;
            })}
          </div>
        </Notice>
      )}

      <form method="get" className="row" style={{ flexWrap: "nowrap" }} role="search">
        <input name="q" defaultValue={q} placeholder={t("tables.search")} aria-label={t("tables.search")} maxLength={80} style={{ flex: 1 }} />
        <SubmitButton className="btn" type="submit">{t("common.search")}</SubmitButton>
      </form>

      <FoldControls openAll={t("fold.openAll")} closeAll={t("fold.closeAll")} />

      {canEdit && (
        <Fold id="add" title={t("tables.addRow")} hint={t("tables.addHint")} open={open === "new"}>
          {rowForm()}
        </Fold>
      )}

      <Fold id="rows" title={t("tables.rows")} hint={fill(t("tables.rowsHint"), { n: rows.length })} open badge={q ? <Badge tone="info">{found.length}</Badge> : undefined}>
        <form id="bulk-rows" action={deleteRowsAction} className="stack bulk-bar">
          {hidden}
          <fieldset disabled={!canEdit} className="row" style={{ border: 0, padding: 0, margin: 0 }}>
            <label className="inline"><input type="checkbox" name="confirm" />{t("tables.confirmDelete")}</label>
            <SubmitButton className="btn small danger" type="submit">{t("tables.deleteRows")}</SubmitButton>
          </fieldset>
        </form>
        {found.length === 0 ? <Empty kind="inbox">{q ? t("tables.noMatch") : t("tables.noRows")}</Empty> : (
          <>
            {canEdit && <SelectAll form="bulk-rows" label={t("tables.selectAll")} />}
            {found.slice(0, limit).map((r) => (
              <article key={r.id} className="data-row">
                <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
                  <input type="checkbox" name="ids" value={r.id} form="bulk-rows" aria-label={fill(t("tables.selectRow"), { name: r.values[first.key] ?? "" })} disabled={!canEdit} />
                  <div style={{ flex: 1, minInlineSize: 0 }}>
                    <strong>{r.values[first.key]}</strong>
                    <dl className="row-values">
                      {rest.filter((f) => r.values[f.key]).map((f) => (
                        <div key={f.key}><dt>{labelOf(f, locale)}</dt><dd>{f.type === "link" ? <a href={r.values[f.key]} target="_blank" rel="noreferrer" dir="ltr">{shown(f, r.values[f.key], t)}</a> : shown(f, r.values[f.key], t)}</dd></div>
                      ))}
                    </dl>
                  </div>
                </div>
                <details open={open === r.id}>
                  <summary className="muted" style={{ cursor: "pointer" }}>{canEdit ? t("tables.editRow") : t("tables.viewRow")}</summary>
                  <div style={{ marginBlockStart: ".5rem" }}>{rowForm(r)}</div>
                  <small className="muted">{fill(t("tables.updated"), { when: fmtDate(r.updatedAt, locale) })}</small>
                </details>
              </article>
            ))}
            <div className="row" style={{ justifyContent: "space-between" }}>
              <small className="muted">{fill(t("tables.count"), { n: Math.min(limit, found.length), total: found.length })}</small>
              {found.length > limit && <Link className="btn small ghost" href={href(limit + SHOWN)}>{t("tables.showMore")}</Link>}
            </div>
          </>
        )}
      </Fold>

      <Fold id="transfer" title={t("tables.transfer")} hint={t("tables.transferHint")} open={Boolean(sp.imp) || ["nofile", "toobig", "badfile", "nocolumns", "column"].includes(err)}>
        <div className="row">
          <strong>{t("tables.export")}</strong>
          <a className="btn small ghost" href={`/api/tables/${table.id}${tq ? `?${tq.slice(1)}` : ""}`}>{t("sheet.csv")}</a>
          <a className="btn small ghost" href={`/api/tables/${table.id}?format=xlsx${tq}`}>{t("sheet.xlsx")}</a>
        </div>
        <h3>{t("tables.import")}</h3>
        <small className="muted">{t("tables.importHelp")}</small>
        <form action={importRowsAction} className="row import-row" encType="multipart/form-data">
          {hidden}
          <fieldset disabled={!canEdit} className="row" style={{ border: 0, padding: 0, margin: 0 }}>
            <input type="file" name="file" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label={t("tables.importFile")} />
            <SubmitButton className="btn small" type="submit">{t("tables.importGo")}</SubmitButton>
          </fieldset>
        </form>
        <div className="row">
          <a className="btn small ghost" href={`/api/tables/${table.id}?template=1${tq}`}>{t("tables.template")} ({t("sheet.csv")})</a>
          <a className="btn small ghost" href={`/api/tables/${table.id}?template=1&format=xlsx${tq}`}>{t("tables.template")} ({t("sheet.xlsx")})</a>
        </div>
      </Fold>
    </>
  );
}

