import { afterEach, describe, expect, it, vi } from "vitest";
import { createDemoData, type Data } from "@/lib/data/demo";
import { createPgData, type Db, type Q } from "@/lib/data/pg";
import {
  LARGE_PHOTO_BYTES, buildFullExport, customersCsv, fmtBytes, importCustomers, importItems, importKnowledge, itemsCsv, itemsTemplate, knowledgeCsv,
  parseCsv, readRecords, safeName, usageShare, usageTotals,
} from "@/lib/data-hub";
import { PHOTO_TARGET_BYTES, SHRINK_STEPS, fitSize } from "@/lib/image-shrink";
import { saveCustomerByStaff } from "@/lib/customers";
import { saveItemByStaff } from "@/lib/items";
import { PLAN_PRESETS } from "@/lib/plans";
import { dictionaries } from "@/lib/i18n";
import { makeDb } from "./helpers/pgdb";

vi.mock("server-only", () => ({}));

async function backend(kind: "demo" | "postgres"): Promise<Data> {
  if (kind === "demo") return createDemoData();
  const pg = await makeDb();
  const q: Q = async (sql, params) => (await pg.query(sql, params as unknown[])).rows as never;
  const db: Db = { q, tx: (fn) => pg.transaction((tx) => fn(async (sql, params) => (await tx.query(sql, params as unknown[])).rows as never)) };
  return createPgData(db) as Data;
}
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("CSV reading", () => {
  it("reads quotes, doubled quotes, line breaks inside quotes and Windows line ends", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n"two\nlines",z\r\n')).toEqual([["a", "b"], ["x, y", 'say "hi"'], ["two\nlines", "z"]]);
  });
  it("drops the byte-order mark and blank lines, and accepts the semicolon spreadsheets use", () => {
    expect(parseCsv("﻿name;price\n\nTea;5\n")).toEqual([["name", "price"], ["Tea", "5"]]);
  });
  it("keys records by column name, ignoring case, spaces and underscores, and takes back the formula guard", () => {
    const r = readRecords("Name,Name (AR),Details_AR,Visible\n'=Odd,عربي,تفاصيل,no\n");
    expect(r.headers).toEqual(["name", "namear", "detailsar", "active"]);
    expect(r.rows[0]).toMatchObject({ name: "=Odd", namear: "عربي", detailsar: "تفاصيل", active: "no" });
  });
  it("reads at most 500 rows and says when it stopped", () => {
    const text = "name\n" + Array.from({ length: 503 }, (_, i) => `item ${i}`).join("\n");
    const r = readRecords(text);
    expect(r.rows).toHaveLength(500);
    expect(r.tooMany).toBe(true);
  });
});

describe("sizes", () => {
  it("writes sizes people can read", () => {
    expect([fmtBytes(512), fmtBytes(2048), fmtBytes(3.5 * 1024 * 1024), fmtBytes(250 * 1024 * 1024)]).toEqual(["512 B", "2 KB", "3.5 MB", "250 MB"]);
    expect(usageShare(250 * 1024 * 1024)).toBeCloseTo(0.5);
  });
  it("totals photos and counts the large ones", () => {
    const u = [{ kind: "item" as const, id: "a", name: "A", bytes: 1000 }, { kind: "doctor" as const, id: "b", name: "B", bytes: LARGE_PHOTO_BYTES + 1 }];
    expect(usageTotals(u)).toEqual({ count: 2, total: 1000 + LARGE_PHOTO_BYTES + 1, large: 1 });
  });
  it("shrinking tries smaller and smaller sizes and never makes a picture bigger", () => {
    expect(fitSize(4000, 3000, 1200)).toEqual({ width: 1200, height: 900 });
    expect(fitSize(300, 200, 1200)).toEqual({ width: 300, height: 200 });
    const sides = SHRINK_STEPS.map(([s]) => s);
    expect([...sides].sort((a, b) => b - a)).toEqual(sides);
    expect(PHOTO_TARGET_BYTES).toBe(300 * 1024);
  });
  it("makes a download name that is safe in a header", () => {
    expect(safeName('al-noor "clinic"\r\nx')).toBe("al-noor-clinic-x");
    expect(safeName("***")).toBe("client");
  });
});

describe.each(["demo", "postgres"] as const)("Data screen logic (%s)", (kind) => {
  const made: string[] = [];
  afterEach(async () => {
    if (kind !== "demo") return;
    const data = await createDemoData();
    for (const id of made.splice(0)) await data.deleteTenant(id, "x");
  });
  async function clinic(data: Data, name = "Hub Clinic") {
    const t = await data.createTenant({ name, nameAr: "", color: "#112233", domain: `${name.replace(/\W/g, "").toLowerCase()}.example.bh`, planType: "package", plan: { ...PLAN_PRESETS.clinic }, actor: "x" });
    made.push(t.id);
    return t;
  }

  it("keeps a doctor's photo apart, lists its size, and drops it with the doctor", async () => {
    const d = await backend(kind);
    const t = await clinic(d);
    const doc = await d.addDoctor(t.id, { name: "Dr Hana", specialty: "Dental" }, "x");
    expect((await d.getDoctors(t.id))[0].photoAt).toBeUndefined();
    await d.setDoctorImage(t.id, doc.id, PNG, "x");
    const listed = (await d.getDoctors(t.id))[0];
    expect(listed.photoAt).toBeTruthy();
    expect(await d.getDoctorImage(t.id, doc.id)).toBe(PNG);
    expect(await d.getDoctorImage(t.id, "00000000-0000-0000-0000-000000000000")).toBeUndefined();
    const item = await saveItemByStaff(d, t.id, { name: "Kit", active: true }, PNG, "x");
    const usage = await d.getPhotoUsage(t.id);
    expect(usage.map((u) => [u.kind, u.id]).sort()).toEqual([["doctor", doc.id], ["item", item.id]].sort());
    expect(usage.every((u) => u.bytes > 50)).toBe(true);
    await d.setDoctorImage(t.id, doc.id, null, "x");
    expect((await d.getDoctors(t.id))[0].photoAt).toBeUndefined();
    await d.setDoctorImage(t.id, doc.id, PNG, "x");
    await d.removeDoctor(t.id, doc.id, "x");
    expect(await d.getDoctorImage(t.id, doc.id)).toBeUndefined();
    expect((await d.getPhotoUsage(t.id)).map((u) => u.kind)).toEqual(["item"]);
  });

  it("does not show one client's photos to another", async () => {
    const d = await backend(kind);
    const a = await clinic(d, "Hub A"), b = await clinic(d, "Hub B");
    const doc = await d.addDoctor(a.id, { name: "Dr A", specialty: "" }, "x");
    await d.setDoctorImage(a.id, doc.id, PNG, "x");
    expect(await d.getDoctorImage(b.id, doc.id)).toBeUndefined();
    expect(await d.getPhotoUsage(b.id)).toEqual([]);
    await expect(d.setDoctorImage(b.id, doc.id, PNG, "x")).rejects.toThrow();
  });

  it("imports catalogue rows: adds new, updates by name, keeps the photo, lists bad rows", async () => {
    const d = await backend(kind);
    const t = await clinic(d);
    const first = await saveItemByStaff(d, t.id, { name: "Whitening kit", price: "BHD 25", active: true }, PNG, "x");
    const csv = "name,name_ar,details,price,keywords,active\n" +
      "whitening KIT,طقم,Home kit,BHD 30,,yes\n" + "Brace check,,Yearly check,BHD 10,braces,no\n" + ",,no name here,,,\n";
    const r = await importItems(d, t.id, csv, "x");
    expect(r).toMatchObject({ added: 1, updated: 1, skipped: 1, errors: [{ line: 4, code: "no_name" }] });
    const items = await d.getItems(t.id);
    expect(items).toHaveLength(2);
    const kit = items.find((i) => i.id === first.id)!;
    expect(kit).toMatchObject({ price: "BHD 30", nameAr: "طقم", hasImage: true });
    expect(items.find((i) => i.name === "Brace check")).toMatchObject({ active: false, keywords: "braces" });
  });

  it("refuses a catalogue file without a name column and imports nothing", async () => {
    const d = await backend(kind);
    const t = await clinic(d);
    expect(await importItems(d, t.id, "title,price\nX,1\n", "x")).toMatchObject({ missingColumn: "name", added: 0 });
    expect(await d.getItems(t.id)).toEqual([]);
  });

  it("imports customers by phone: new, update with blank cells keeping values, bad rows reported", async () => {
    const d = await backend(kind);
    const t = await clinic(d);
    await saveCustomerByStaff(d, t.id, { name: "Sara", phone: "36001122", email: "sara@example.com", notes: "morning" }, "x");
    const csv = "name,phone,cpr,email,language,notes\n" +
      ",+973 3600 1122,,,ar,\n" + "Omar,39998877,,,en,new\n" + "Bad,123,,,,\n" + "Cpr,35550000,12,,,\n";
    const r = await importCustomers(d, t.id, csv, "x");
    expect(r).toMatchObject({ added: 1, updated: 1, skipped: 2 });
    expect(r.errors).toEqual([{ line: 4, code: "bad_phone" }, { line: 5, code: "bad_cpr" }]);
    const list = await d.getCustomers(t.id);
    const sara = list.find((c) => c.name === "Sara")!;
    expect(sara).toMatchObject({ email: "sara@example.com", notes: "morning", language: "ar" });
    expect(list).toHaveLength(2);
  });

  it("imports knowledge: adds, updates the same question in the same language, guesses Arabic", async () => {
    const d = await backend(kind);
    const t = await clinic(d);
    await d.addKnowledge(t.id, "Where are you?", "Manama", "en", "x");
    const csv = "question,answer,language\nWhere are you?,Building 12,en\nأين تقعون؟,في المنامة,\nOnly a question,,en\n";
    const r = await importKnowledge(d, t.id, csv, "x");
    expect(r).toMatchObject({ added: 1, updated: 1, skipped: 1, errors: [{ line: 4, code: "no_text" }] });
    const all = await d.getKnowledge(t.id);
    expect(all).toHaveLength(2);
    expect(all.find((k) => k.question === "Where are you?")?.answer).toBe("Building 12");
    expect(all.find((k) => k.question.startsWith("أين"))?.language).toBe("ar");
  });

  it("exports come back in through the importer (round trip) and the full export carries photos on request", async () => {
    const d = await backend(kind);
    const t = await clinic(d);
    await saveItemByStaff(d, t.id, { name: "=SUM(1)", details: 'He said "hi", twice', keywords: "a, b", active: false }, PNG, "x");
    await saveCustomerByStaff(d, t.id, { name: "Sara", phone: "36001122", notes: "line\nbreak" }, "x");
    await d.addKnowledge(t.id, "Q?", "A, with comma", "en", "x");
    const doc = await d.addDoctor(t.id, { name: "Dr Hana", specialty: "Dental" }, "x");
    await d.setDoctorImage(t.id, doc.id, PNG, "x");

    const other = await clinic(d, "Hub Other");
    expect(await importItems(d, other.id, itemsCsv(await d.getItems(t.id)), "x")).toMatchObject({ added: 1, skipped: 0 });
    expect(await importCustomers(d, other.id, customersCsv(await d.getCustomers(t.id)), "x")).toMatchObject({ added: 1, skipped: 0 });
    expect(await importKnowledge(d, other.id, knowledgeCsv(await d.getKnowledge(t.id)), "x")).toMatchObject({ added: 1, skipped: 0 });
    expect((await d.getItems(other.id))[0]).toMatchObject({ name: "=SUM(1)", details: 'He said "hi", twice', keywords: "a, b", active: false });
    expect((await d.getCustomers(other.id))[0].notes).toBe("line\nbreak");

    const plain = await buildFullExport(d, t, false, "2026-10-28T00:00:00Z");
    expect(plain.client.slug).toBe(t.slug);
    expect(plain.catalogue[0]).not.toHaveProperty("photo");
    expect(JSON.stringify(plain)).not.toContain(t.id);
    const withPhotos = await buildFullExport(d, t, true, "2026-10-28T00:00:00Z");
    expect(withPhotos.catalogue[0].photo).toBe(PNG);
    expect(withPhotos.doctors[0].photo).toBe(PNG);
  });

  it("the empty catalogue template imports as one example row", async () => {
    const d = await backend(kind);
    const t = await clinic(d);
    expect(await importItems(d, t.id, itemsTemplate(), "x")).toMatchObject({ added: 1, skipped: 0 });
  });
});

describe("Data screen texts", () => {
  it("has every data.* text in both languages with the same placeholders", () => {
    const en = Object.keys(dictionaries.en).filter((k) => k.startsWith("data."));
    expect(en.length).toBeGreaterThan(60);
    for (const k of en) {
      const a = (dictionaries.en as Record<string, string>)[k], b = (dictionaries.ar as Record<string, string>)[k];
      expect(b, k).toBeTruthy();
      expect((b.match(/\{\w+\}/g) ?? []).sort(), k).toEqual((a.match(/\{\w+\}/g) ?? []).sort());
    }
  });
});
