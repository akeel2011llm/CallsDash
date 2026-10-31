/**
 * Custom tables (milestone 6c of docs/reorganization.md): the admin designs tables for a client (a stock list, a menu, a price
 * list), the client's staff fill them, and the assistant can search them. This module holds the rules every screen, import and
 * the assistant share: what each column type accepts, how a row is tidied, how a sheet is read, and how rows are searched.
 * Pure (no storage), so it is tested on its own.
 */
import type { DataField, DataFieldType, DataRow, DataTable, Locale } from "./types";
import { foldText } from "./items";

export const FIELD_TYPES: DataFieldType[] = ["text", "longtext", "number", "price", "stock", "yesno", "choice", "date", "link"];
export const isFieldType = (v: unknown): v is DataFieldType => typeof v === "string" && (FIELD_TYPES as string[]).includes(v);

export const MAX_TABLES = 20;
export const MAX_FIELDS = 30;
export const MAX_ROWS = 5000;
export const MAX_OPTIONS = 50;

export class TableError extends Error {
  constructor(readonly code: "no_name" | "no_fields" | "too_many_tables" | "too_many_fields" | "too_many_rows" | "duplicate_name" | "bad_field" | "unknown" | "locked") { super(code); }
}

const clip = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** A stable key for a new column, from its label: lower case latin letters, digits and "_", unique in the table. */
export function fieldKey(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = foldText(label).normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "field";
  let key = /^[a-z]/.test(base) ? base : `f_${base}`;
  for (let n = 2; used.has(key); n++) key = `${base}_${n}`;
  return key;
}

/** Choice options from a text box: one per line or comma separated, trimmed, without repeats. */
export const optionsFrom = (text: string): string[] =>
  [...new Set(text.split(/[\n,،]/).map((o) => clip(o, 60)).filter(Boolean))].slice(0, MAX_OPTIONS);

/**
 * Tidies one value for its column. Blank is allowed (the row check decides about required columns). Returns the value to store
 * or an error code: numbers lose thousands separators and Arabic digits become latin, yes/no understands the usual words in
 * English and Arabic, dates become YYYY-MM-DD, a link must be http(s).
 */
export function cleanValue(f: Pick<DataField, "type" | "options">, raw: unknown): { value: string } | { error: string } {
  const v = clip(raw, f.type === "longtext" ? 4000 : 500);
  if (!v) return { value: "" };
  const latin = v.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/٫/g, ".").replace(/[٬,\s]/g, "");
  switch (f.type) {
    case "number": case "stock": {
      const n = Number(latin);
      if (!Number.isFinite(n) || latin === "") return { error: "bad_number" };
      if (f.type === "stock" && (!Number.isInteger(n) || n < 0)) return { error: "bad_stock" };
      return { value: String(n) };
    }
    case "price": {
      // keeps a currency word if one was typed ("BHD 4.500"), but the amount must be a number
      const amount = latin.replace(/^(bhd|bd|د\.ب|دب|usd|\$)/i, "").replace(/(bhd|bd|د\.ب|دب|usd)$/i, "");
      const n = Number(amount);
      if (!Number.isFinite(n) || n < 0 || amount === "") return { error: "bad_price" };
      return { value: String(n) };
    }
    case "yesno": {
      const s = v.toLowerCase();
      if (["yes", "y", "true", "1", "on", "نعم", "اي", "ايوه"].includes(s)) return { value: "yes" };
      if (["no", "n", "false", "0", "off", "لا"].includes(s)) return { value: "no" };
      return { error: "bad_yesno" };
    }
    case "choice": {
      const hit = (f.options ?? []).find((o) => foldText(o) === foldText(v));
      return hit ? { value: hit } : { error: "bad_choice" };
    }
    case "date": {
      const iso = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      const dmy = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
      // Excel stores a date as a day count from 1899-12-30
      const serial = /^\d{5}(\.\d+)?$/.test(latin) ? new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(latin)) * 86_400_000) : null;
      const [y, m, d] = iso ? [+iso[1], +iso[2], +iso[3]] : dmy ? [+dmy[3], +dmy[2], +dmy[1]] : serial ? [serial.getUTCFullYear(), serial.getUTCMonth() + 1, serial.getUTCDate()] : [0, 0, 0];
      const date = new Date(Date.UTC(y, m - 1, d));
      if (!y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return { error: "bad_date" };
      return { value: date.toISOString().slice(0, 10) };
    }
    case "link":
      return /^https?:\/\/[^\s]+$/i.test(v) ? { value: v.slice(0, 500) } : { error: "bad_link" };
    default:
      return { value: v };
  }
}

/** Every column of a row tidied; a blank required column or an unusable value is listed by column key. */
export function cleanRow(t: Pick<DataTable, "fields">, raw: Record<string, unknown>): { values: Record<string, string>; errors: { key: string; code: string }[] } {
  const values: Record<string, string> = {};
  const errors: { key: string; code: string }[] = [];
  for (const f of t.fields) {
    const r = cleanValue(f, raw[f.key]);
    if ("error" in r) { errors.push({ key: f.key, code: r.error }); continue; }
    if (!r.value && (f.required || f === t.fields[0])) { errors.push({ key: f.key, code: "required" }); continue; }
    values[f.key] = r.value;
  }
  return { values, errors };
}

export interface TableInput { name: string; nameAr?: string; clientEdit: boolean; assistant: boolean }

/** Checks a table's own settings (name, columns) before it is saved. The first column is always required: it names a row. */
export function checkTable(t: TableInput & { fields: DataField[] }, others: Pick<DataTable, "name">[]): DataTable["fields"] {
  if (!clip(t.name, 80)) throw new TableError("no_name");
  if (others.some((o) => foldText(o.name) === foldText(clip(t.name, 80)))) throw new TableError("duplicate_name");
  if (!t.fields.length) throw new TableError("no_fields");
  if (t.fields.length > MAX_FIELDS) throw new TableError("too_many_fields");
  const keys = new Set<string>();
  return t.fields.map((f, i) => {
    if (!clip(f.label, 60) || !isFieldType(f.type) || keys.has(f.key) || !/^[a-z][a-z0-9_]{0,40}$/.test(f.key)) throw new TableError("bad_field");
    if (f.type === "choice" && !(f.options ?? []).length) throw new TableError("bad_field");
    keys.add(f.key);
    return {
      key: f.key, label: clip(f.label, 60), ...(clip(f.labelAr, 60) ? { labelAr: clip(f.labelAr, 60) } : {}), type: f.type,
      ...(f.type === "choice" ? { options: (f.options ?? []).map((o) => clip(o, 60)).filter(Boolean).slice(0, MAX_OPTIONS) } : {}),
      ...(f.required || i === 0 ? { required: true } : {}),
    };
  });
}

export const labelOf = (f: Pick<DataField, "label" | "labelAr">, l: Locale) => (l === "ar" && f.labelAr) || f.label;
export const tableName = (t: Pick<DataTable, "name" | "nameAr">, l: Locale) => (l === "ar" && t.nameAr) || t.name;

/* ---------- sheets ---------- */

/** A table as sheet rows: the column labels, then one line per row. */
export const tableSheet = (t: DataTable, rows: DataRow[]): string[][] =>
  [t.fields.map((f) => f.label), ...rows.map((r) => t.fields.map((f) => r.values[f.key] ?? ""))];

/** An empty sheet with the column labels and one row that shows what each type expects. */
export function tableTemplate(t: DataTable): string[][] {
  const sample: Record<DataFieldType, string> = {
    text: "Example", longtext: "A longer description", number: "12", price: "4.500", stock: "25", yesno: "yes",
    choice: "", date: "2026-11-30", link: "https://example.com/photo.jpg",
  };
  return [t.fields.map((f) => f.label), t.fields.map((f) => (f.type === "choice" ? f.options?.[0] ?? "" : sample[f.type]))];
}

const norm = (s: string) => foldText(s).replace(/[\s_\-()]+/g, "");

export interface TableImport {
  added: number; updated: number; skipped: number;
  errors: { line: number; code: string; column?: string; key?: string }[];
  /** The sheet has none of the table's column names: nothing was read. */
  noColumns?: boolean;
  /** The first column (which names a row) is missing from the sheet. */
  missingKey?: string;
  tooMany: boolean;
}

/**
 * Turns sheet rows into saves. Columns are found by label (English or Arabic) or key, in any order; unknown columns are ignored.
 * A row whose first-column value already exists is updated, and a blank cell there keeps the stored value. Rows with a bad
 * value are skipped and listed with their line in the file (the header is line 1).
 */
export function planImport(t: DataTable, existing: DataRow[], sheet: string[][], maxRows = 500): { saves: { id?: string; values: Record<string, string> }[]; report: TableImport } {
  const report: TableImport = { added: 0, updated: 0, skipped: 0, errors: [], tooMany: false };
  if (!sheet.length) return { saves: [], report: { ...report, noColumns: true } };
  const header = sheet[0].map((h) => norm(String(h ?? "")));
  const col = new Map<string, number>();
  for (const f of t.fields) {
    const i = header.findIndex((h) => h && (h === norm(f.label) || h === norm(f.key) || (f.labelAr && h === norm(f.labelAr))));
    if (i >= 0) col.set(f.key, i);
  }
  if (!col.size) return { saves: [], report: { ...report, noColumns: true } };
  const first = t.fields[0];
  if (!col.has(first.key)) return { saves: [], report: { ...report, missingKey: first.label } };
  const byKey = new Map(existing.map((r) => [foldText(r.values[first.key] ?? ""), r]));
  const body = sheet.slice(1);
  report.tooMany = body.length > maxRows;
  const saves: { id?: string; values: Record<string, string> }[] = [];
  const inFile = new Map<string, number>();
  for (const [n, cells] of body.slice(0, maxRows).entries()) {
    const line = n + 2;
    const name = clip(cells[col.get(first.key)!], 500);
    const tidy = cleanValue(first, name);
    const cur = name ? byKey.get(foldText("value" in tidy ? tidy.value : name)) : undefined;
    const raw: Record<string, string> = {};
    for (const f of t.fields) {
      const i = col.get(f.key);
      const v = i === undefined ? "" : String(cells[i] ?? "").trim();
      raw[f.key] = v || (cur?.values[f.key] ?? "");
    }
    const { values, errors } = cleanRow(t, raw);
    if (errors.length) {
      report.skipped++;
      report.errors.push({ line, code: errors[0].code, column: t.fields.find((f) => f.key === errors[0].key)?.label, key: errors[0].key });
      continue;
    }
    const k = foldText(values[first.key]);
    const again = inFile.get(k);
    if (again !== undefined) { saves[again] = { ...saves[again], values }; continue; } // the same row twice in one file: the later line wins
    inFile.set(k, saves.length);
    saves.push({ id: cur?.id, values });
    byKey.set(k, { id: cur?.id ?? "", tableId: t.id, tenantId: t.tenantId, values, updatedAt: "" });
    if (cur) report.updated++; else report.added++;
  }
  return { saves, report };
}

/* ---------- search (screens and the assistant) ---------- */

const words = (s: string) => foldText(s).split(/[^\p{L}\p{N}.]+/u).filter((w) => w.length >= 1);

/** Rows that hold every word of the query somewhere (any column), the first column counting most. Empty query: all rows. */
export function searchRows(t: Pick<DataTable, "fields">, rows: DataRow[], query: string): DataRow[] {
  const q = words(query);
  if (!q.length) return rows;
  const first = t.fields[0]?.key;
  return rows
    .map((r) => {
      const all = foldText(Object.values(r.values).join(" "));
      const name = foldText(first ? r.values[first] ?? "" : "");
      if (!q.every((w) => all.includes(w))) return null;
      return { r, s: q.reduce((n, w) => n + (name.includes(w) ? 2 : 1), 0) };
    })
    .filter((x): x is { r: DataRow; s: number } => x !== null)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.r);
}

/** What find_record gives the assistant: each row as label -> value, in the customer's language where a label has one. */
export function recordsFor(t: DataTable, rows: DataRow[], l: Locale): Record<string, string>[] {
  return rows.map((r) => Object.fromEntries(t.fields.filter((f) => r.values[f.key]).map((f) => [labelOf(f, l), f.type === "stock" ? `${r.values[f.key]} in stock` : r.values[f.key]])));
}

/* ---------- the column designer ---------- */

/** One line of the column designer as the form sends it. `key` is blank for a new column. */
export interface FieldLine { key: string; label: string; labelAr: string; type: string; options: string; required: boolean; remove: boolean; order: number }

/**
 * The columns a designer form describes: removed lines and blank new lines dropped, sorted by their order number, new columns
 * given a key from their label. A column keeps its key when renamed, so its values stay with it.
 */
export function fieldsFromLines(lines: FieldLine[]): DataField[] {
  const keep = lines.filter((l) => !l.remove && (l.key || clip(l.label, 60)));
  const taken = new Set(keep.map((l) => l.key).filter(Boolean));
  return keep
    .map((l, i) => ({ l, i }))
    .sort((a, b) => (a.l.order || a.i + 1) - (b.l.order || b.i + 1) || a.i - b.i)
    .map(({ l }) => {
      const key = l.key || fieldKey(l.label, taken);
      taken.add(key);
      const type = isFieldType(l.type) ? l.type : "text";
      return {
        key, label: clip(l.label, 60), ...(clip(l.labelAr, 60) ? { labelAr: clip(l.labelAr, 60) } : {}), type,
        ...(type === "choice" ? { options: optionsFrom(l.options) } : {}), ...(l.required ? { required: true } : {}),
      };
    });
}

/** Ready-made starting points for a new table; the admin can change every column before saving. */
export const TABLE_PRESETS: Record<"stock" | "menu" | "prices" | "blank", { name: string; nameAr: string; fields: DataField[] }> = {
  stock: {
    name: "Stock list", nameAr: "قائمة المخزون",
    fields: [
      { key: "item", label: "Item", labelAr: "الصنف", type: "text", required: true },
      { key: "code", label: "Code", labelAr: "الرمز", type: "text" },
      { key: "in_stock", label: "In stock", labelAr: "الكمية المتوفرة", type: "stock" },
      { key: "price", label: "Price", labelAr: "السعر", type: "price" },
      { key: "notes", label: "Notes", labelAr: "ملاحظات", type: "longtext" },
    ],
  },
  menu: {
    name: "Menu", nameAr: "قائمة الطعام",
    fields: [
      { key: "dish", label: "Dish", labelAr: "الطبق", type: "text", required: true },
      { key: "section", label: "Section", labelAr: "القسم", type: "choice", options: ["Starters", "Mains", "Desserts", "Drinks"] },
      { key: "price", label: "Price", labelAr: "السعر", type: "price" },
      { key: "available", label: "Available today", labelAr: "متوفر اليوم", type: "yesno" },
      { key: "description", label: "Description", labelAr: "الوصف", type: "longtext" },
    ],
  },
  prices: {
    name: "Price list", nameAr: "قائمة الأسعار",
    fields: [
      { key: "service", label: "Service", labelAr: "الخدمة", type: "text", required: true },
      { key: "price", label: "Price", labelAr: "السعر", type: "price" },
      { key: "minutes", label: "Duration (minutes)", labelAr: "المدة (دقائق)", type: "number" },
      { key: "notes", label: "Notes", labelAr: "ملاحظات", type: "longtext" },
    ],
  },
  blank: { name: "", nameAr: "", fields: [{ key: "name", label: "Name", labelAr: "الاسم", type: "text", required: true }] },
};
export const isPreset = (v: unknown): v is keyof typeof TABLE_PRESETS => typeof v === "string" && v in TABLE_PRESETS;

/* ---------- the assistant's find_record tool ---------- */

export const RECORDS_PER_ANSWER = 10;

/**
 * What find_record answers: only tables the admin marked "Assistant reads it". With a table name it searches that table; without
 * one, every such table. An empty query lists the tables (and, for a named table, its first rows). At most 10 records come back,
 * so a phone call is not flooded.
 */
export async function findRecords(
  d: { getDataTables(tenantId: string): Promise<DataTable[]> | DataTable[]; getDataRows(tenantId: string, tableId: string): Promise<DataRow[]> | DataRow[] },
  tenantId: string,
  q: { query: string; table: string; language: Locale },
) {
  const tables = (await d.getDataTables(tenantId)).filter((t) => t.assistant);
  if (!tables.length) return { found: false, tables: [] as { table: string; columns: string[] }[], message: "This business has no lists for you to search. Answer from the knowledge base, or offer to take a message." };
  const want = foldText(q.table.trim());
  const chosen = want ? tables.filter((t) => [t.name, t.nameAr ?? ""].some((n) => n && (foldText(n).includes(want) || want.includes(foldText(n))))) : tables;
  const list = tables.map((t) => ({ table: tableName(t, q.language), columns: t.fields.map((f) => labelOf(f, q.language)) }));
  if (want && !chosen.length) return { found: false, tables: list, message: "No list has that name. Use one of these table names, or leave table empty to search them all." };
  const query = q.query.trim().slice(0, 120);
  if (!query && !want) return { found: true, tables: list, message: "These are the business's lists. Call find_record again with what the customer asked for." };
  const results: { table: string; records: Record<string, string>[] }[] = [];
  let left = RECORDS_PER_ANSWER, more = 0;
  for (const t of chosen) {
    const hits = searchRows(t, await d.getDataRows(tenantId, t.id), query);
    if (!hits.length) continue;
    if (left > 0) results.push({ table: tableName(t, q.language), records: recordsFor(t, hits.slice(0, left), q.language) });
    more += Math.max(0, hits.length - left);
    left = Math.max(0, left - hits.length);
  }
  if (!results.length) return { found: false, tables: list, message: "Nothing in the lists matches. Do not guess; say it is not listed and offer to take a message." };
  return {
    found: true, results,
    ...(more ? { more, message: `${more} more records match; ask the customer to be more specific.` } : {}),
    note: "Answer only from these records. A stock value of 0 in stock means it is not available now.",
  };
}
