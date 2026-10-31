import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { colIndex, colName, looksLikeXlsx, readXlsx, toXlsx, XlsxError } from "@/lib/xlsx";
import { formatOf, sheetFromFile, sheetResponse } from "@/lib/sheet";
import { importItems, itemsRows, itemsTemplateRows, readRecords } from "@/lib/data-hub";
import { createDemoData } from "@/lib/data/demo";
import { PLAN_PRESETS } from "@/lib/plans";

vi.mock("server-only", () => ({}));

/** The text of one file inside the workbook (enough of a ZIP reader for the test). */
function part(xlsx: Uint8Array, name: string): string {
  const b = Buffer.from(xlsx);
  for (let p = 0; p < b.length - 30; p++) {
    if (b.readUInt32LE(p) !== 0x04034b50) continue;
    const size = b.readUInt32LE(p + 18), n = b.readUInt16LE(p + 26), e = b.readUInt16LE(p + 28);
    if (b.toString("utf8", p + 30, p + 30 + n) === name) return inflateRawSync(b.subarray(p + 30 + n + e, p + 30 + n + e + size)).toString("utf8");
  }
  throw new Error(`no ${name}`);
}

describe("Excel files", () => {
  it("writes and reads back text, Arabic, numbers and empty cells", () => {
    const rows = [["name", "name_ar", "price", "count"], ["Teeth & whitening", "تبييض الأسنان", "BHD 45", 3], ["", "<b>x</b>", "", 1.5]];
    const x = toXlsx(rows, { sheet: "Catalogue" });
    expect(looksLikeXlsx(x)).toBe(true);
    expect(readXlsx(x)).toEqual([["name", "name_ar", "price", "count"], ["Teeth & whitening", "تبييض الأسنان", "BHD 45", "3"], ["", "<b>x</b>", "", "1.5"]]);
  });

  it("never writes a formula: a cell starting with = stays text", () => {
    const x = toXlsx([["a"], ["=HYPERLINK(\"http://evil\")"], ["+1"]]);
    const sheet = part(x, "xl/worksheets/sheet1.xml");
    expect(sheet).not.toContain("<f>");
    expect(sheet).toContain('t="inlineStr"');
    expect(readXlsx(x)[1][0]).toBe('=HYPERLINK("http://evil")');
  });

  it("makes the header bold, frozen and filterable, and can show right to left", () => {
    const sheet = part(toXlsx([["a", "b"], ["1", "2"]], { rtl: true }), "xl/worksheets/sheet1.xml");
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toContain('<autoFilter ref="A1:B2"/>');
    expect(sheet).toContain('rightToLeft="1"');
    expect(sheet).toMatch(/<c r="A1" s="1"/);
  });

  it("reads a workbook saved by another program (shared strings, true/false, number cells)", () => {
    const rows = readXlsx(readFileSync(join(__dirname, "fixtures", "libreoffice-items.xlsx")));
    expect(rows).toEqual([["Name", "Name (AR)", "Price", "Visible"], ["Cleaning", "تنظيف", "BHD 20", "yes"], ["Filling", "", "15", "no"]]);
  });

  it("refuses a file that is not a workbook", () => {
    expect(() => readXlsx(new TextEncoder().encode("name,price\nA,1\n"))).toThrow(XlsxError);
    expect(() => readXlsx(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0, 0]))).toThrow(XlsxError);
  });

  it("names columns like Excel", () => {
    expect([0, 25, 26, 27, 701, 702].map(colName)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
    expect(["A", "Z", "AA", "AB", "ZZ", "AAA"].map(colIndex)).toEqual([0, 25, 26, 27, 701, 702]);
  });
});

describe("one download and upload path for CSV and Excel", () => {
  it("picks the format from the address", () => {
    expect(formatOf("http://x/a?format=xlsx")).toBe("xlsx");
    expect(formatOf("http://x/a")).toBe("csv");
    expect(formatOf("http://x/a?format=pdf")).toBe("csv");
  });

  it("downloads either format with the right name and type", async () => {
    const csv = sheetResponse([["a"], ["1"]], "list", "csv");
    expect(csv.headers.get("content-disposition")).toContain('filename="list.csv"');
    // starts with the byte-order mark so Excel reads Arabic in a CSV
    expect([...new Uint8Array(await csv.arrayBuffer())].slice(0, 3)).toEqual([0xef, 0xbb, 0xbf]);
    const xl = sheetResponse([["a"], ["1"]], "list", "xlsx");
    expect(xl.headers.get("content-type")).toContain("spreadsheetml");
    expect(xl.headers.get("content-disposition")).toContain('filename="list.xlsx"');
    expect(readXlsx(new Uint8Array(await xl.arrayBuffer()))).toEqual([["a"], ["1"]]);
  });

  it("reads an upload by its bytes: Excel rows or CSV text", async () => {
    expect(await sheetFromFile(new Blob([Buffer.from(toXlsx([["name"], ["A"]]))]))).toEqual([["name"], ["A"]]);
    expect(await sheetFromFile(new Blob(["name\nA\n"]))).toBe("name\nA\n");
  });

  it("imports the Excel template and an exported Excel file like their CSV twins", async () => {
    const d = await createDemoData();
    const t = await d.createTenant({ name: "Sheet Clinic", nameAr: "", color: "#112233", domain: "sheet.example.bh", planType: "package", plan: { ...PLAN_PRESETS.clinic }, actor: "x" });
    const before = (await d.getItems(t.id)).length;
    const tpl = readXlsx(toXlsx(itemsTemplateRows()));
    expect(readRecords(tpl).headers).toContain("namear");
    expect(await importItems(d, t.id, tpl, "x")).toMatchObject({ added: 1, skipped: 0 });
    // a round trip through Excel changes nothing: every row is found again by its name
    const again = readXlsx(toXlsx(itemsRows(await d.getItems(t.id))));
    expect(await importItems(d, t.id, again, "x")).toMatchObject({ added: 0, updated: before + 1, skipped: 0 });
  });
});
