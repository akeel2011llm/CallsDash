"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin, requireClient } from "./auth";
import { getData } from "./data";
import { MAX_IMPORT_BYTES, parseCsv } from "./data-hub";
import { sheetFromFile } from "./sheet";
import { XlsxError } from "./xlsx";
import { foldText } from "./items";
import {
  MAX_ROWS, MAX_TABLES, TableError, checkTable, cleanRow, fieldsFromLines, planImport, type FieldLine,
} from "./custom-tables";
import type { DataTable, Tenant } from "./types";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const on = (f: FormData, k: string) => f.get(k) === "on";

interface Scope { tenant: Tenant; actor: string; admin: boolean; manager: boolean; base: string }

/**
 * Who is acting and on which client (milestone 6c). The admin works from the client's Data tab (`scope=admin`); the client's
 * staff from Catalog > Custom tables. Only the admin designs tables; rows are changed by the admin, by the admin viewing as the
 * client, or by a manager of the client when the table allows it.
 */
async function scopeOf(f: FormData): Promise<Scope> {
  if (str(f, "scope") === "admin") {
    const { actor } = await requireAdmin();
    const tenant = await (await getData()).getTenant(str(f, "tenantId"));
    if (!tenant) redirect("/admin");
    return { tenant, actor, admin: true, manager: true, base: `/admin/clients/${tenant.id}/data/tables` };
  }
  const { tenant, actor, viewingAsAdmin, staffRole } = await requireClient();
  return { tenant, actor, admin: viewingAsAdmin, manager: staffRole === "manager", base: "/app/tables" };
}

const canEditRows = (s: Scope, t: DataTable) => s.admin || (s.manager && t.clientEdit);

function done(url: string): never {
  revalidatePath("/app", "layout");
  revalidatePath("/admin", "layout");
  return redirect(url);
}

async function tableOf(s: Scope, tableId: string): Promise<DataTable> {
  const t = /^[\w-]{1,64}$/.test(tableId) ? await (await getData()).getDataTable(s.tenant.id, tableId) : undefined;
  if (!t) done(`${s.base}?err=unknown`);
  return t!;
}

/** The column lines of the designer form: `n` lines named f0_label, f0_type and so on. */
function linesOf(f: FormData): FieldLine[] {
  const n = Math.min(Number(str(f, "n")) || 0, 60);
  return Array.from({ length: n }, (_, i) => ({
    key: str(f, `f${i}_key`), label: str(f, `f${i}_label`), labelAr: str(f, `f${i}_labelAr`), type: str(f, `f${i}_type`),
    options: String(f.get(`f${i}_options`) ?? ""), required: on(f, `f${i}_required`), remove: on(f, `f${i}_remove`), order: Number(str(f, `f${i}_order`)) || 0,
  }));
}

/** Creates a table or saves its name, settings and columns. Admin only. */
export async function saveTableAction(f: FormData) {
  const s = await scopeOf(f);
  if (str(f, "scope") !== "admin") return done(`${s.base}?err=locked`);
  const d = await getData();
  const id = str(f, "id");
  const all = await d.getDataTables(s.tenant.id);
  const cur = id ? all.find((t) => t.id === id) : undefined;
  if (id && !cur) return done(`${s.base}?err=unknown`);
  const preset = /^[a-z]{1,10}$/.test(str(f, "preset")) ? `&preset=${str(f, "preset")}` : "";
  const back = cur ? `${s.base}/${cur.id}` : `${s.base}/new`;
  const input = { name: str(f, "name").slice(0, 80), nameAr: str(f, "nameAr").slice(0, 80) || undefined, clientEdit: on(f, "clientEdit"), assistant: on(f, "assistant") };
  try {
    if (!cur && all.length >= MAX_TABLES) throw new TableError("too_many_tables");
    const fields = checkTable({ ...input, fields: fieldsFromLines(linesOf(f)) }, all.filter((t) => t.id !== id));
    const saved = await d.putDataTable(s.tenant.id, { ...(cur ? { id: cur.id } : {}), ...input, fields }, s.actor);
    return done(`${s.base}/${saved.id}?saved=table#design`);
  } catch (e) {
    if (e instanceof TableError) return done(`${back}?err=${e.code}${cur ? "#design" : preset}`);
    throw e;
  }
}

/** Deletes a table and all its rows. The admin types the table's name to confirm. */
export async function deleteTableAction(f: FormData) {
  const s = await scopeOf(f);
  if (str(f, "scope") !== "admin") return done(`${s.base}?err=locked`);
  const t = await tableOf(s, str(f, "tableId"));
  if (foldText(str(f, "confirmName")) !== foldText(t.name)) return done(`${s.base}/${t.id}?err=confirm#delete`);
  await (await getData()).deleteDataTable(s.tenant.id, t.id, s.actor);
  return done(`${s.base}?deleted=1`);
}

/** Adds a row, or saves one. Values come as v_<column key>. The first column names the row, so two rows cannot share it. */
export async function saveRowAction(f: FormData) {
  const s = await scopeOf(f);
  const t = await tableOf(s, str(f, "tableId"));
  const page = `${s.base}/${t.id}`;
  if (!canEditRows(s, t)) return done(`${page}?err=locked`);
  const d = await getData();
  const rowId = str(f, "rowId");
  const rows = await d.getDataRows(s.tenant.id, t.id);
  if (rowId && !rows.some((r) => r.id === rowId)) return done(`${page}?err=unknown`);
  if (!rowId && rows.length >= MAX_ROWS) return done(`${page}?err=too_many_rows`);
  const raw = Object.fromEntries(t.fields.map((x) => [x.key, String(f.get(`v_${x.key}`) ?? "")]));
  const { values, errors } = cleanRow(t, raw);
  const open = rowId ? `&open=${rowId}` : "&open=new";
  if (errors.length) {
    const col = t.fields.find((x) => x.key === errors[0].key)?.key ?? "";
    return done(`${page}?err=${errors[0].code}&col=${col}${open}`);
  }
  const first = t.fields[0].key;
  if (rows.some((r) => r.id !== rowId && foldText(r.values[first] ?? "") === foldText(values[first]))) return done(`${page}?err=duplicate_row&col=${first}${open}`);
  await d.putDataRows(s.tenant.id, t.id, [{ ...(rowId ? { id: rowId } : {}), values }], s.actor);
  return done(`${page}?saved=row`);
}

/** Deletes the ticked rows. Needs the confirm tick box. */
export async function deleteRowsAction(f: FormData) {
  const s = await scopeOf(f);
  const t = await tableOf(s, str(f, "tableId"));
  const page = `${s.base}/${t.id}`;
  if (!canEditRows(s, t)) return done(`${page}?err=locked`);
  const ids = [...new Set(f.getAll("ids").map(String))].slice(0, MAX_ROWS);
  if (!ids.length) return done(`${page}?err=none`);
  if (!on(f, "confirm")) return done(`${page}?err=confirm_rows`);
  const n = await (await getData()).deleteDataRows(s.tenant.id, t.id, ids, s.actor);
  return done(`${page}?removed=${n}`);
}

/** Adds and updates rows from a CSV or Excel file. Rows are matched by the first column; a blank cell keeps what is stored. */
export async function importRowsAction(f: FormData) {
  const s = await scopeOf(f);
  const t = await tableOf(s, str(f, "tableId"));
  const page = `${s.base}/${t.id}`;
  if (!canEditRows(s, t)) return done(`${page}?err=locked#transfer`);
  const file = f.get("file");
  if (!(file instanceof File) || file.size === 0) return done(`${page}?err=nofile#transfer`);
  if (file.size > MAX_IMPORT_BYTES) return done(`${page}?err=toobig#transfer`);
  let sheet: string[][];
  try {
    const read = await sheetFromFile(file);
    sheet = typeof read === "string" ? parseCsv(read) : read;
  } catch (e) {
    if (e instanceof XlsxError) return done(`${page}?err=badfile#transfer`);
    throw e;
  }
  const d = await getData();
  const existing = await d.getDataRows(s.tenant.id, t.id);
  const { saves, report } = planImport(t, existing, sheet);
  if (report.noColumns) return done(`${page}?err=nocolumns#transfer`);
  if (report.missingKey) return done(`${page}?err=column&col=${t.fields[0].key}#transfer`);
  if (existing.length + report.added > MAX_ROWS) return done(`${page}?err=too_many_rows#transfer`);
  if (saves.length) await d.putDataRows(s.tenant.id, t.id, saves, s.actor);
  const errs = report.errors.slice(0, 20).map((e) => `${e.line}.${e.code}${e.key ? `.${e.key}` : ""}`).join(",");
  return done(`${page}?imp=1&added=${report.added}&updated=${report.updated}&skipped=${report.skipped}&more=${report.tooMany ? 1 : 0}&errs=${encodeURIComponent(errs)}#transfer`);
}
