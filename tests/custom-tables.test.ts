import { afterEach, describe, expect, it, vi } from "vitest";
import { createDemoData, type Data } from "@/lib/data/demo";
import { createPgData, type Db, type Q } from "@/lib/data/pg";
import { TABLE_PRESETS, checkTable, cleanRow, cleanValue, fieldKey, fieldsFromLines, findRecords, optionsFrom, planImport, recordsFor, searchRows, tableSheet, tableTemplate, TableError } from "@/lib/custom-tables";
import { buildPrompt, toolDefinitions } from "@/lib/agent-config";
import { PLAN_PRESETS } from "@/lib/plans";
import type { DataField, DataRow, DataTable } from "@/lib/types";
import { makeDb } from "./helpers/pgdb";

vi.mock("server-only", () => ({}));

const F = (key: string, type: DataField["type"], extra: Partial<DataField> = {}): DataField => ({ key, label: key[0].toUpperCase() + key.slice(1), type, ...extra });
const table = (fields: DataField[]): DataTable => ({ id: "tb", tenantId: "t", name: "Stock", fields, clientEdit: true, assistant: true, createdAt: "" });
const row = (id: string, values: Record<string, string>): DataRow => ({ id, tableId: "tb", tenantId: "t", values, updatedAt: "" });

describe("column values", () => {
  it("tidies numbers, prices and stock, with Arabic digits and separators", () => {
    expect(cleanValue({ type: "number" }, "١٬٢٥٠٫٥")).toEqual({ value: "1250.5" });
    expect(cleanValue({ type: "price" }, "BHD 4.500")).toEqual({ value: "4.5" });
    expect(cleanValue({ type: "price" }, "3 د.ب")).toEqual({ value: "3" });
    expect(cleanValue({ type: "price" }, "free")).toEqual({ error: "bad_price" });
    expect(cleanValue({ type: "stock" }, "12")).toEqual({ value: "12" });
    expect(cleanValue({ type: "stock" }, "-1")).toEqual({ error: "bad_stock" });
    expect(cleanValue({ type: "stock" }, "1.5")).toEqual({ error: "bad_stock" });
  });

  it("understands yes/no, choices, dates and links", () => {
    expect(cleanValue({ type: "yesno" }, "نعم")).toEqual({ value: "yes" });
    expect(cleanValue({ type: "yesno" }, "FALSE")).toEqual({ value: "no" });
    expect(cleanValue({ type: "yesno" }, "maybe")).toEqual({ error: "bad_yesno" });
    expect(cleanValue({ type: "choice", options: ["Small", "Large"] }, "large")).toEqual({ value: "Large" });
    expect(cleanValue({ type: "choice", options: ["Small"] }, "Huge")).toEqual({ error: "bad_choice" });
    expect(cleanValue({ type: "date" }, "30/11/2026")).toEqual({ value: "2026-11-30" });
    expect(cleanValue({ type: "date" }, "2026-02-30")).toEqual({ error: "bad_date" });
    expect(cleanValue({ type: "date" }, "46356")).toEqual({ value: "2026-11-30" }); // an Excel date number
    expect(cleanValue({ type: "link" }, "javascript:alert(1)")).toEqual({ error: "bad_link" });
    expect(cleanValue({ type: "link" }, "https://shop.bh/a.jpg")).toEqual({ value: "https://shop.bh/a.jpg" });
    expect(cleanValue({ type: "text" }, "  a   b ")).toEqual({ value: "a b" });
  });

  it("requires the first column and the required ones", () => {
    const t = table([F("name", "text"), F("size", "choice", { options: ["S"], required: true }), F("note", "text")]);
    expect(cleanRow(t, { name: "", size: "S" }).errors).toEqual([{ key: "name", code: "required" }]);
    expect(cleanRow(t, { name: "A", size: "" }).errors).toEqual([{ key: "size", code: "required" }]);
    expect(cleanRow(t, { name: "A", size: "s" })).toEqual({ values: { name: "A", size: "S", note: "" }, errors: [] });
  });
});

describe("table design", () => {
  it("makes stable unique keys from labels, Arabic too", () => {
    expect(fieldKey("Unit price", [])).toBe("unit_price");
    expect(fieldKey("Unit price", ["unit_price"])).toBe("unit_price_2");
    expect(fieldKey("السعر", [])).toBe("field");
    expect(fieldKey("2nd size", [])).toBe("f_2nd_size");
  });

  it("reads choice options one per line or by commas", () => {
    expect(optionsFrom("Small, Medium\nLarge،Small")).toEqual(["Small", "Medium", "Large"]);
  });

  it("refuses a nameless table, a duplicate name, no columns, or a choice without options", () => {
    const ok = { name: "Menu", clientEdit: true, assistant: false, fields: [F("dish", "text")] };
    expect(checkTable(ok, [])[0]).toMatchObject({ key: "dish", required: true });
    expect(() => checkTable({ ...ok, name: " " }, [])).toThrow(TableError);
    expect(() => checkTable(ok, [{ name: "menu" }])).toThrow("duplicate_name");
    expect(() => checkTable({ ...ok, fields: [] }, [])).toThrow("no_fields");
    expect(() => checkTable({ ...ok, fields: [F("dish", "text"), F("size", "choice")] }, [])).toThrow("bad_field");
    expect(() => checkTable({ ...ok, fields: [F("dish", "text"), F("dish", "number")] }, [])).toThrow("bad_field");
  });
});

describe("sheets and search", () => {
  const t = table([F("name", "text"), F("price", "price"), F("stock", "stock"), F("vegan", "yesno")]);
  const rows = [row("r1", { name: "Falafel wrap", price: "1.2", stock: "30", vegan: "yes" }), row("r2", { name: "Chicken shawarma", price: "1.5", stock: "0", vegan: "no" })];

  it("exports labels then values, and a template with a sample row", () => {
    expect(tableSheet(t, rows)).toEqual([["Name", "Price", "Stock", "Vegan"], ["Falafel wrap", "1.2", "30", "yes"], ["Chicken shawarma", "1.5", "0", "no"]]);
    expect(tableTemplate(t)[0]).toEqual(["Name", "Price", "Stock", "Vegan"]);
    expect(tableTemplate(t)[1]).toHaveLength(4);
  });

  it("imports by column name in any order: updates by first column, keeps blanks, lists bad lines", () => {
    const sheet = [["vegan", "NAME", "Price", "extra"], ["", "falafel WRAP", "1.3", "x"], ["no", "Hummus", "abc", ""], ["yes", "Hummus plate", "2", ""], ["", "", "1", ""]];
    const { saves, report } = planImport(t, rows, sheet);
    expect(report.errors).toEqual([{ line: 3, code: "bad_price", column: "Price", key: "price" }, { line: 5, code: "required", column: "Name", key: "name" }]);
    expect(saves[0]).toEqual({ id: "r1", values: { name: "falafel WRAP", price: "1.3", stock: "30", vegan: "yes" } });
    expect(saves[1]).toEqual({ id: undefined, values: { name: "Hummus plate", price: "2", stock: "", vegan: "yes" } });
  });

  it("says what is wrong with a sheet that does not fit", () => {
    expect(planImport(t, [], [["a", "b"], ["1", "2"]]).report.noColumns).toBe(true);
    expect(planImport(t, [], [["Price"], ["1"]]).report.missingKey).toBe("Name");
    expect(planImport(t, [], [["Name"], ...Array.from({ length: 3 }, (_, i) => [`x${i}`])], 2).report).toMatchObject({ added: 2, tooMany: true });
  });

  it("finds rows by any words, the first column first; Arabic letter variants match", () => {
    expect(searchRows(t, rows, "shawarma").map((r) => r.id)).toEqual(["r2"]);
    expect(searchRows(t, rows, "").length).toBe(2);
    expect(searchRows(t, rows, "wrap yes").map((r) => r.id)).toEqual(["r1"]);
    const ar = table([F("name", "text")]);
    expect(searchRows(ar, [row("a", { name: "سلطة الفتوش" })], "فتوش")).toHaveLength(1);
    expect(recordsFor(t, rows.slice(0, 1), "en")).toEqual([{ Name: "Falafel wrap", Price: "1.2", Stock: "30 in stock", Vegan: "yes" }]);
  });
});

describe.each(["demo", "postgres"] as const)("custom tables stored (%s)", (kind) => {
  const made: string[] = [];
  let d: Data;
  afterEach(async () => { for (const id of made.splice(0)) await d.deleteTenant(id, "x").catch(() => undefined); });
  async function setUp() {
    if (kind === "demo") d = await createDemoData();
    else {
      const pg = await makeDb();
      const q: Q = async (sql, params) => (await pg.query(sql, params as unknown[])).rows as never;
      d = createPgData({ q, tx: (fn) => pg.transaction((tx) => fn(async (sql, params) => (await tx.query(sql, params as unknown[])).rows as never)) } as Db) as Data;
    }
    const t = await d.createTenant({ name: `Tables ${kind}`, nameAr: "", color: "#112233", domain: `tables-${kind}.example.bh`, planType: "package", plan: { ...PLAN_PRESETS.clinic }, actor: "x" });
    made.push(t.id);
    return t;
  }

  it("adds, changes and deletes tables and rows, and keeps clients apart", async () => {
    const t = await setUp();
    const other = await d.createTenant({ name: `Other ${kind}`, nameAr: "", color: "#112233", domain: `other-${kind}.example.bh`, planType: "package", plan: { ...PLAN_PRESETS.clinic }, actor: "x" });
    made.push(other.id);
    const tb = await d.putDataTable(t.id, { name: "Menu", fields: [F("dish", "text"), F("price", "price"), F("spicy", "yesno")], clientEdit: true, assistant: true }, "x");
    expect((await d.getDataTables(t.id)).map((x) => x.name)).toEqual(["Menu"]);
    expect(await d.getDataTables(other.id)).toEqual([]);
    expect(await d.getDataTable(other.id, tb.id)).toBeUndefined();
    expect(await d.putDataRows(t.id, tb.id, [{ values: { dish: "Machboos", price: "3", spicy: "yes" } }, { values: { dish: "Harees", price: "2" } }], "x")).toBe(2);
    const rows = await d.getDataRows(t.id, tb.id);
    expect(rows.map((r) => r.values.dish).sort()).toEqual(["Harees", "Machboos"]);
    const harees = rows.find((r) => r.values.dish === "Harees")!;
    expect(await d.putDataRows(t.id, tb.id, [{ id: harees.id, values: { dish: "Harees", price: "2.5" } }], "x")).toBe(1);
    expect((await d.getDataRows(t.id, tb.id)).find((r) => r.id === harees.id)!.values.price).toBe("2.5");
    // another client cannot write into this table
    await expect(d.putDataRows(other.id, tb.id, [{ values: { dish: "x" } }], "x")).rejects.toThrow();
    expect(await d.deleteDataRows(other.id, tb.id, [harees.id], "x")).toBe(0);
    // removing a column drops its values
    await d.putDataTable(t.id, { id: tb.id, name: "Menu", fields: [F("dish", "text"), F("price", "price")], clientEdit: false, assistant: true }, "x");
    const after = await d.getDataRows(t.id, tb.id);
    expect(after.every((r) => !("spicy" in r.values))).toBe(true);
    expect((await d.getDataTable(t.id, tb.id))!.clientEdit).toBe(false);
    expect(await d.deleteDataRows(t.id, tb.id, [harees.id], "x")).toBe(1);
    await d.deleteDataTable(t.id, tb.id, "x");
    expect(await d.getDataTables(t.id)).toEqual([]);
    expect(await d.getDataRows(t.id, tb.id)).toEqual([]);
  });
});

describe("column designer", () => {
  const line = (x: Partial<Parameters<typeof fieldsFromLines>[0][number]>) => ({ key: "", label: "", labelAr: "", type: "text", options: "", required: false, remove: false, order: 0, ...x });

  it("keeps keys when renamed, drops removed and blank lines, adds new keys, sorts by position", () => {
    const f = fieldsFromLines([
      line({ key: "item", label: "Product", order: 2 }),
      line({ key: "qty", label: "Qty", type: "stock", remove: true }),
      line({ label: "Size", type: "choice", options: "S\nM, L", order: 1 }),
      line({ label: "" }),
      line({ label: "Item", labelAr: "صنف", order: 3 }),
    ]);
    expect(f.map((x) => x.key)).toEqual(["size", "item", "item_2"]);
    expect(f[0]).toMatchObject({ label: "Size", type: "choice", options: ["S", "M", "L"] });
    expect(f[1].label).toBe("Product");
    expect(f[2]).toMatchObject({ label: "Item", labelAr: "صنف" });
    // and the result passes the table check, which makes the first column required
    expect(checkTable({ name: "Stock", clientEdit: true, assistant: true, fields: f }, [])[0].required).toBe(true);
  });

  it("offers ready-made tables whose columns pass the check", () => {
    for (const p of Object.values(TABLE_PRESETS)) expect(() => checkTable({ name: p.name || "Blank", clientEdit: true, assistant: true, fields: p.fields }, [])).not.toThrow();
  });

  it("an import that repeats a row keeps the later line and counts it once", () => {
    const t = table([F("item", "text"), F("qty", "stock")]);
    const { saves, report } = planImport(t, [], [["Item", "Qty"], ["Gloves", "5"], ["gloves", "7"]]);
    expect(saves).toEqual([{ id: undefined, values: { item: "gloves", qty: "7" } }]);
    expect(report.added).toBe(1);
  });
});

describe("find_record", () => {
  const stock: DataTable = { ...table([F("item", "text", { labelAr: "الصنف" }), F("qty", "stock"), F("price", "price")]), name: "Stock list", nameAr: "المخزون" };
  const secret: DataTable = { ...table([F("name", "text")]), id: "tb2", name: "Supplier costs", assistant: false };
  const rows: Record<string, DataRow[]> = {
    tb: [row("r1", { item: "Gloves", qty: "0", price: "2" }), row("r2", { item: "Face masks", qty: "40", price: "1.5" }), ...Array.from({ length: 12 }, (_, i) => row(`m${i}`, { item: `Mask size ${i}`, qty: "3" }))],
    tb2: [row("s1", { name: "Gloves supplier" })],
  };
  const d = { getDataTables: () => [stock, secret], getDataRows: (_t: string, id: string) => rows[id] ?? [] };

  it("searches only tables the assistant may read, and says when nothing matches", async () => {
    const r = await findRecords(d, "t", { query: "gloves", table: "", language: "en" });
    expect(r).toMatchObject({ found: true, results: [{ table: "Stock list", records: [{ Item: "Gloves", Qty: "0 in stock", Price: "2" }] }] });
    expect(JSON.stringify(r)).not.toContain("supplier");
    expect(await findRecords(d, "t", { query: "laser", table: "", language: "en" })).toMatchObject({ found: false });
  });

  it("caps the answer at 10 records and says how many more match; uses Arabic names", async () => {
    const r = await findRecords(d, "t", { query: "mask", table: "المخزون", language: "ar" });
    expect(r.found).toBe(true);
    if (!("results" in r) || !r.results) throw new Error("no results");
    expect(r.results[0].table).toBe("المخزون");
    expect(r.results[0].records).toHaveLength(10);
    expect(Object.keys(r.results[0].records[0])).toContain("الصنف");
    expect(r).toMatchObject({ more: 3 });
  });

  it("lists the tables for an empty query, and handles an unknown table or no tables", async () => {
    expect(await findRecords(d, "t", { query: "", table: "", language: "en" })).toMatchObject({ found: true, tables: [{ table: "Stock list", columns: ["Item", "Qty", "Price"] }] });
    expect(await findRecords(d, "t", { query: "x", table: "Menu", language: "en" })).toMatchObject({ found: false, tables: [{ table: "Stock list" }] });
    expect(await findRecords({ getDataTables: () => [secret], getDataRows: () => [] }, "t", { query: "x", table: "", language: "en" })).toMatchObject({ found: false });
  });

  it("is a tool the assistant has, with a rule telling it when to call it", () => {
    const def = toolDefinitions("https://app.example", "s").find_record as { api_schema: { url: string } };
    expect(def.api_schema.url).toBe("https://app.example/api/agent-tools/find_record");
    expect(buildPrompt({ prompt: { identity: "", languages: "", mayDo: "", neverDo: "", emergencies: "", handoff: "" }, arabicWrittenStyle: "msa", replyLength: "short", formality: "friendly" } as never)).toContain("call find_record");
  });
});
