import type { Data } from "./data/demo";
import { CustomerError, cleanPhone, phoneKey, saveCustomerByStaff } from "./customers";
import { ID_CPR, type IdRule } from "./id-rule";
import { ItemError, foldText, saveItemByStaff } from "./items";
import { toCsv } from "./stats";
import type { Customer, Doctor, Item, KnowledgeItem, Locale } from "./types";

/* ---------- storage ---------- */

/** The free Supabase plan holds 500 MB of database. The Data screen compares the size with it; a paid plan holds more. */
export const FREE_DB_BYTES = 500 * 1024 * 1024;
/** A photo above this is called large on the Data screen (the browser shrinks new ones to fit, older ones may be bigger). */
export const LARGE_PHOTO_BYTES = 300 * 1024;

/** Size in bytes of the picture itself (not the base64 text the database holds, which is a third bigger). */
export interface PhotoUsage { kind: "item" | "doctor"; id: string; name: string; bytes: number }

export function usageTotals(photos: PhotoUsage[]) {
  const total = photos.reduce((n, p) => n + p.bytes, 0);
  return { count: photos.length, total, large: photos.filter((p) => p.bytes > LARGE_PHOTO_BYTES).length };
}

/** "412 KB", "3.2 MB": a size a person can read. */
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  const mb = n / (1024 * 1024);
  return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

/** How full the database is, 0 to 1 (more than 1 means over the free plan). */
export const usageShare = (bytes: number, limit = FREE_DB_BYTES) => bytes / limit;

/* ---------- CSV ---------- */

export const MAX_IMPORT_BYTES = 1024 * 1024;
export const MAX_IMPORT_ROWS = 500;

/**
 * Reads CSV text into rows of cells. Handles quotes (including doubled quotes and line breaks inside them), a leading byte-order
 * mark, Windows or Unix line ends, and the semicolon that spreadsheets in Arabic and European settings use instead of a comma.
 */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

/** A spreadsheet writes ='...' or '=... in front of text that looked like a formula (see toCsv); take that back off. */
const unformula = (s: string) => s.replace(/^'(?=[=+\-@\t\r])/, "");

type Records = { headers: string[]; rows: Record<string, string>[]; tooMany: boolean };

const ALIASES: Record<string, string> = {
  name_ar: "namear", "name (ar)": "namear", arabic_name: "namear", details_ar: "detailsar", "details (ar)": "detailsar",
  description: "details", description_ar: "detailsar", keyword: "keywords", visible: "active", status: "active",
};
const headerKey = (h: string) => {
  const k = h.trim().toLowerCase();
  return ALIASES[k] ?? k.replace(/[\s_-]+/g, "");
};

/** A table to import: CSV text, or rows already read from an Excel file (lib/xlsx.ts). */
export type SheetInput = string | string[][];

/** The first row names the columns; the rest become records keyed by those names (spaces, case and underscores ignored). */
export function readRecords(input: SheetInput): Records {
  const all = typeof input === "string" ? parseCsv(input) : input.map((r) => r.map((c) => String(c ?? "")));
  if (!all.length) return { headers: [], rows: [], tooMany: false };
  const headers = all[0].map(headerKey);
  const body = all.slice(1);
  const rows = body.slice(0, MAX_IMPORT_ROWS).map((r) => Object.fromEntries(headers.map((h, i) => [h, unformula((r[i] ?? "").trim())])));
  return { headers, rows, tooMany: body.length > MAX_IMPORT_ROWS };
}

const truthy = (v: string, fallback: boolean) => {
  const s = v.trim().toLowerCase();
  if (!s) return fallback;
  return !["0", "no", "n", "false", "hidden", "inactive", "off", "لا"].includes(s);
};

export interface ImportResult {
  added: number;
  updated: number;
  skipped: number;
  /** Lines of the file (the header is line 1) that were not imported, with the reason code. */
  errors: { line: number; code: string }[];
  /** The file had more rows than MAX_IMPORT_ROWS; the rest were not read. */
  tooMany: boolean;
  /** A required column is missing: nothing was imported. */
  missingColumn?: string;
}

const empty = (): ImportResult => ({ added: 0, updated: 0, skipped: 0, errors: [], tooMany: false });

/* ---------- catalogue ---------- */

export const ITEM_COLUMNS = ["name", "name_ar", "details", "details_ar", "price", "keywords", "active"] as const;

export const itemsRows = (items: Item[]): string[][] =>
  [[...ITEM_COLUMNS], ...items.map((i) => [i.name, i.nameAr ?? "", i.details, i.detailsAr ?? "", i.price ?? "", i.keywords, i.active ? "yes" : "no"])];
export const itemsCsv = (items: Item[]) => toCsv(itemsRows(items));

/** One example row so the template shows what each column holds. */
export const itemsTemplateRows = (): string[][] => [[...ITEM_COLUMNS], ["Teeth whitening", "تبييض الأسنان", "One-hour session in the clinic.", "جلسة لمدة ساعة في العيادة.", "BHD 45", "whitening, bleaching", "yes"]];
export const itemsTemplate = () => toCsv(itemsTemplateRows());

type ItemDeps = Pick<Data, "getItems" | "getItem" | "getItemImage" | "putItem" | "deleteItem">;

/** Adds the catalogue items in a CSV; an item whose name already exists is updated and keeps its photo. */
export async function importItems(d: ItemDeps, tenantId: string, text: SheetInput, actor: string): Promise<ImportResult> {
  const { headers, rows, tooMany } = readRecords(text);
  const res = empty();
  res.tooMany = tooMany;
  if (!headers.includes("name")) return { ...res, missingColumn: "name" };
  const existing = new Map((await d.getItems(tenantId)).map((i) => [foldText(i.name.trim()), i]));
  for (const [n, r] of rows.entries()) {
    const line = n + 2;
    if (!r.name) { res.skipped++; res.errors.push({ line, code: "no_name" }); continue; }
    const cur = existing.get(foldText(r.name));
    try {
      const saved = await saveItemByStaff(d, tenantId, {
        id: cur?.id, name: r.name, nameAr: r.namear || (cur?.nameAr ?? ""), details: r.details || (cur?.details ?? ""), detailsAr: r.detailsar || (cur?.detailsAr ?? ""),
        price: r.price || (cur?.price ?? ""), keywords: r.keywords || (cur?.keywords ?? ""), active: truthy(r.active ?? "", cur ? cur.active : true),
      }, undefined, actor);
      existing.set(foldText(saved.name), saved);
      if (cur) res.updated++; else res.added++;
    } catch (e) {
      if (!(e instanceof ItemError)) throw e;
      res.skipped++; res.errors.push({ line, code: e.code });
    }
  }
  return res;
}

/* ---------- customers ---------- */

export const CUSTOMER_COLUMNS = ["name", "phone", "cpr", "email", "language", "notes"] as const;

export const customersTemplateRows = (): string[][] => [[...CUSTOMER_COLUMNS], ["Sara Ahmed", "+973 3600 1122", "", "sara@example.com", "ar", "Prefers morning appointments"]];

type CustomerDeps = Pick<Data, "getCustomer" | "findCustomer" | "putCustomer" | "deleteCustomer">;

/** Adds the customers in a CSV; one whose phone number is already there is updated, and a blank cell keeps what is stored. */
export async function importCustomers(d: CustomerDeps, tenantId: string, text: SheetInput, actor: string, rule: IdRule = ID_CPR): Promise<ImportResult> {
  const { headers, rows, tooMany } = readRecords(text);
  const res = empty();
  res.tooMany = tooMany;
  if (!headers.includes("phone")) return { ...res, missingColumn: "phone" };
  for (const [n, r] of rows.entries()) {
    const line = n + 2;
    const phone = cleanPhone(r.phone);
    if (!phone) { res.skipped++; res.errors.push({ line, code: "bad_phone" }); continue; }
    const cur: Customer | undefined = await d.findCustomer(tenantId, { phoneKey: phoneKey(phone) });
    const lang = r.language.trim().toLowerCase();
    const language: Locale | undefined = lang === "ar" || lang === "en" ? lang : cur?.language;
    try {
      await saveCustomerByStaff(d, tenantId, {
        id: cur?.id, name: r.name || (cur?.name ?? ""), phone, cpr: r.cpr || (cur?.cpr ?? ""), email: r.email || (cur?.email ?? ""),
        language, notes: r.notes || (cur?.notes ?? ""),
      }, actor, rule);
      if (cur) res.updated++; else res.added++;
    } catch (e) {
      if (!(e instanceof CustomerError)) throw e;
      res.skipped++; res.errors.push({ line, code: e.code });
    }
  }
  return res;
}

export const customersRows = (list: Customer[]): (string | number)[][] =>
  [[...CUSTOMER_COLUMNS, "created_at", "last_contact_at", "conversations"], ...list.map((c) => [c.name, c.phone, c.cpr ?? "", c.email ?? "", c.language ?? "", c.notes, c.createdAt, c.lastContactAt ?? "", c.history.length])];
export const customersCsv = (list: Customer[]) => toCsv(customersRows(list));

/* ---------- knowledge ---------- */

export const KNOWLEDGE_COLUMNS = ["question", "answer", "language"] as const;

export const knowledgeTemplateRows = (): string[][] => [[...KNOWLEDGE_COLUMNS], ["What are your opening hours?", "We are open Saturday to Thursday 8 am to 9 pm and Friday 4 pm to 9 pm.", "en"]];
export const knowledgeRows = (list: KnowledgeItem[]): string[][] => [[...KNOWLEDGE_COLUMNS], ...list.map((k) => [k.question, k.answer, k.language])];
export const knowledgeCsv = (list: KnowledgeItem[]) => toCsv(knowledgeRows(list));

type KnowledgeDeps = Pick<Data, "getKnowledge" | "addKnowledge" | "updateKnowledge">;

/** Adds the questions and answers in a CSV; the same question in the same language is updated instead of added twice. */
export async function importKnowledge(d: KnowledgeDeps, tenantId: string, text: SheetInput, actor: string): Promise<ImportResult> {
  const { headers, rows, tooMany } = readRecords(text);
  const res = empty();
  res.tooMany = tooMany;
  for (const need of ["question", "answer"]) if (!headers.includes(need)) return { ...res, missingColumn: need };
  const key = (q: string, l: Locale) => `${l}:${foldText(q.trim())}`;
  const existing = new Map((await d.getKnowledge(tenantId)).map((k) => [key(k.question, k.language), k]));
  for (const [n, r] of rows.entries()) {
    const line = n + 2;
    const question = r.question.slice(0, 500), answer = r.answer.slice(0, 2000);
    if (!question || !answer) { res.skipped++; res.errors.push({ line, code: "no_text" }); continue; }
    const lang = r.language.trim().toLowerCase();
    const language: Locale = lang === "ar" || (!lang && /[؀-ۿ]/.test(question)) ? "ar" : "en";
    const cur = existing.get(key(question, language));
    if (cur) { await d.updateKnowledge(tenantId, cur.id, { question, answer, language }, actor); res.updated++; } else { await d.addKnowledge(tenantId, question, answer, language, actor); res.added++; }
    existing.set(key(question, language), { id: cur?.id ?? "", tenantId, question, answer, language });
  }
  return res;
}

/* ---------- doctors, full export ---------- */

export const doctorsRows = (list: Doctor[]): string[][] =>
  [["name", "specialty", "active", "has_photo"], ...list.map((x) => [x.name, x.specialty, x.active === false ? "no" : "yes", x.photoAt ? "yes" : "no"])];

export const EXPORT_KINDS = ["catalogue", "customers", "knowledge", "doctors"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];
export const isExportKind = (v: unknown): v is ExportKind => typeof v === "string" && (EXPORT_KINDS as readonly string[]).includes(v);
export const IMPORT_KINDS = ["catalogue", "customers", "knowledge"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
export const isImportKind = (v: unknown): v is ImportKind => typeof v === "string" && (IMPORT_KINDS as readonly string[]).includes(v);

/** A file name that is safe in a download header. */
export const safeName = (s: string) => s.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "client";

export interface FullExport {
  exportedAt: string;
  client: { name: string; slug: string };
  catalogue: (Omit<Item, "tenantId"> & { photo?: string })[];
  customers: Omit<Customer, "tenantId">[];
  knowledge: Omit<KnowledgeItem, "tenantId">[];
  doctors: (Omit<Doctor, "tenantId"> & { photo?: string })[];
}

/** Everything a client holds in one file. `photos` includes each photo as a data: URL, which makes the file much bigger. */
export async function buildFullExport(
  d: Pick<Data, "getItems" | "getItemImage" | "getCustomers" | "getKnowledge" | "getDoctors" | "getDoctorImage">,
  tenant: { id: string; name: string; slug: string }, photos: boolean, at: string,
): Promise<FullExport> {
  const [items, customers, knowledge, doctors] = await Promise.all([d.getItems(tenant.id), d.getCustomers(tenant.id), d.getKnowledge(tenant.id), d.getDoctors(tenant.id)]);
  const strip = <T extends { tenantId: string }>(o: T): Omit<T, "tenantId"> => { const { tenantId: _t, ...rest } = o; void _t; return rest; };
  return {
    exportedAt: at,
    client: { name: tenant.name, slug: tenant.slug },
    catalogue: await Promise.all(items.map(async (i) => ({ ...strip(i), ...(photos && i.hasImage ? { photo: await d.getItemImage(tenant.id, i.id) } : {}) }))),
    customers: customers.map(strip),
    knowledge: knowledge.map(strip),
    doctors: await Promise.all(doctors.map(async (x) => ({ ...strip(x), ...(photos && x.photoAt ? { photo: await d.getDoctorImage(tenant.id, x.id) } : {}) }))),
  };
}
