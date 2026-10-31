import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ID_CPR, idFormat, idName, idRuleOf, idify, normalizeId, type IdRule } from "@/lib/id-rule";
import { idTexts } from "@/lib/id-texts";
import { businessFromForm } from "@/lib/business-types";
import { buildPrompt, bookingRules, customerRules, toolDefinitions } from "@/lib/agent-config";
import { createBookingService } from "@/lib/booking";
import { lookupCustomer, lookupModeOf, saveCustomerByStaff } from "@/lib/customers";
import { createPgData, type Db, type Q } from "@/lib/data/pg";
import { dictionaries } from "@/lib/i18n";
import { agent } from "@/lib/seed";
import { makeDb } from "./helpers/pgdb";

const PASSPORT: IdRule = { kind: "custom", en: "Passport number", ar: "رقم الجواز", format: "text" };
const MEMBER: IdRule = { kind: "custom", en: "Membership number", ar: "رقم العضوية", format: "digits", length: 6 };
const NONE: IdRule = { kind: "none" };
const NOW = new Date("2026-10-21T00:00:00Z"); // Wednesday 03:00 Bahrain

async function setup(id?: IdRule) {
  const pg = await makeDb();
  const q: Q = async (sql, params) => (await pg.query(sql, params as unknown[])).rows as never;
  const db: Db = { q, tx: (fn) => pg.transaction((tx) => fn(async (sql, params) => (await tx.query(sql, params as unknown[])).rows as never)) };
  const data = createPgData(db);
  const t = await data.createTenant({ name: "Id Gym", nameAr: "", color: "#112233", domain: "", planType: "package", actor: "x" });
  if (id) await data.setBusiness(t.id, { type: "service", staffScheduling: true, id }, "x");
  await q(`insert into doctors (tenant_id, name) values ($1, 'Coach Sara')`, [t.id]);
  const svc = createBookingService(data, null, () => NOW);
  return { data, t, svc };
}

describe("the ID number a client asks for", () => {
  it("is the CPR number for every client made before the rule existed", () => {
    expect(idRuleOf(null)).toEqual(ID_CPR);
    expect(idRuleOf({ business: { type: "clinic" } as never })).toEqual(ID_CPR);
    expect(idRuleOf({ business: { type: "salon", id: { kind: "bogus" } } as never })).toEqual(ID_CPR);
  });

  it("checks numbers under each rule", () => {
    expect(normalizeId(ID_CPR, "850 123 456")).toBe("850123456");
    expect(normalizeId(ID_CPR, "12345")).toBeNull();
    expect(normalizeId(PASSPORT, "ab-123 4567")).toBe("AB1234567");
    expect(normalizeId(PASSPORT, "AB!12345")).toBeNull();
    expect(normalizeId(PASSPORT, "AAAAAAA")).toBeNull(); // a placeholder, not a number
    expect(normalizeId(MEMBER, "١٢٣٤٥٦")).toBe("123456"); // Arabic digits
    expect(normalizeId(MEMBER, "12345")).toBeNull(); // the exact length is 6
    expect(normalizeId(MEMBER, "AB1234")).toBeNull(); // digits only
    expect(normalizeId(NONE, "850123456")).toBeNull();
  });

  it("names the ID and its format in both languages", () => {
    expect(idName(ID_CPR, "en")).toBe("CPR number");
    expect(idName(PASSPORT, "ar")).toBe("رقم الجواز");
    expect(idFormat(MEMBER, "en")).toBe("6 digits");
    expect(idFormat(PASSPORT, "en")).toBe("letters and digits");
  });

  it("reads the Business tab's ID box", () => {
    const form = (v: Record<string, string>) => businessFromForm((k) => v[k] ?? "", (k) => k in v);
    expect(form({ businessType: "service", idShown: "1", idKind: "custom", idEn: "Passport number", idAr: "", idFormat: "text", idLength: "" }).id)
      .toEqual({ kind: "custom", en: "Passport number", ar: "Passport number", format: "text" });
    expect(form({ businessType: "service", idShown: "1", idKind: "custom", idEn: "Member no", idFormat: "digits", idLength: "6" }).id?.length).toBe(6);
    expect(form({ businessType: "retail", idShown: "1", idKind: "none" }).id).toEqual({ kind: "none" });
    expect(form({ businessType: "retail" }).id).toBeUndefined(); // a form without the box keeps what the client has
  });
});

describe("the assistant and the ID rule", () => {
  const settings = agent("", "X");

  it("keeps the CPR wording word for word for a client that asks for the CPR number", () => {
    const rules = [...bookingRules(ID_CPR), ...customerRules("cpr", ID_CPR)];
    expect(rules.join(" ")).toContain("CPR number (the 9-digit personal number on the Bahraini ID card)");
    expect(idify("Ask for the CPR number.", ID_CPR)).toBe("Ask for the CPR number.");
  });

  it("asks for another ID by its own name, and never says CPR", () => {
    const text = [...bookingRules(PASSPORT), ...customerRules("cpr", PASSPORT), ...customerRules("phone", PASSPORT)].join("\n");
    expect(text).not.toMatch(/CPR|Bahraini|9 digits|9-digit/);
    expect(text).toContain("passport number (letters and digits)");
    expect(text).toContain("character by character");
  });

  it("with no ID number, books and finds bookings by phone number", () => {
    const text = [...bookingRules(NONE), ...customerRules("cpr", NONE)].join("\n");
    expect(text).not.toMatch(/CPR|ID card/);
    expect(text).toContain("call find_patient_booking with it as patient_phone");
    expect(text).toContain("pass patient_cpr as an empty string");
  });

  it("puts the client's rule in the instructions", () => {
    const p = buildPrompt(settings, [], { business: { type: "service", id: MEMBER } } as never);
    expect(p.slice(p.indexOf("# Tools"))).not.toContain("CPR");
    expect(p).toContain("membership number (6 digits)");
  });

  it("describes patient_cpr in the shared tools without naming the CPR as the only ID", () => {
    const tools = JSON.stringify(toolDefinitions("https://x.test", "s"));
    expect(tools).not.toContain("Bahraini");
    expect(tools).toContain("ID number");
  });

  it("finds customers by phone number when the business asks for no ID number", () => {
    expect(lookupModeOf({ customerLookup: "cpr" }, NONE)).toBe("phone");
    expect(lookupModeOf({ customerLookup: "cpr" }, PASSPORT)).toBe("cpr");
  });
});

describe("bookings under each rule", () => {
  it("books, finds, moves and cancels with no ID number, by phone number alone", async () => {
    const { svc, t, data } = await setup(NONE);
    const b = await svc.bookAppointment(t.id, { doctorId: "Coach Sara", startsAt: "2026-10-21T10:00", patientName: "Ali", patientPhone: "+973 3912 3456", patientCpr: "" });
    expect((await data.getBookings(t.id)).find((x) => x.id === b.bookingId)?.patientCpr).toBeUndefined();
    await expect(svc.findPatientBookings(t.id, { patientCpr: "" })).rejects.toMatchObject({ code: "missing_details" });
    const found = await svc.findPatientBookings(t.id, { patientCpr: "", patientPhone: "39123456" });
    expect(found.bookings.map((x) => x.bookingId)).toEqual([b.bookingId]);
    expect((await svc.findPatientBookings(t.id, { patientCpr: "", patientPhone: "39000000" })).bookings).toEqual([]);
    await expect(svc.cancelAppointment(t.id, { bookingId: b.bookingId, patientCpr: "", patientPhone: "39000000" })).rejects.toMatchObject({ code: "not_found" });
    expect(await svc.cancelAppointment(t.id, { bookingId: b.bookingId, patientCpr: "", patientPhone: "+973 3912 3456" })).toEqual({ cancelled: true });
  });

  it("asks for the client's own ID by name, and finds a booking by it", async () => {
    const { svc, t } = await setup(PASSPORT);
    await expect(svc.bookAppointment(t.id, { doctorId: "Coach Sara", startsAt: "2026-10-21T10:00", patientName: "Ali", patientPhone: "+973 3912 3456", patientCpr: "" }))
      .rejects.toMatchObject({ code: "bad_cpr", message: expect.stringContaining("passport number") });
    const b = await svc.bookAppointment(t.id, { doctorId: "Coach Sara", startsAt: "2026-10-21T10:00", patientName: "Ali", patientPhone: "+973 3912 3456", patientCpr: "ab 1234567" });
    expect((await svc.findPatientBookings(t.id, { patientCpr: "AB1234567" })).bookings.map((x) => x.bookingId)).toEqual([b.bookingId]);
    await expect(svc.cancelAppointment(t.id, { bookingId: b.bookingId, patientCpr: "XY9999999" })).rejects.toMatchObject({ code: "not_found", message: expect.not.stringContaining("CPR") });
  });

  it("keeps the CPR rule for a client that never chose one", async () => {
    const { svc, t } = await setup();
    await expect(svc.bookAppointment(t.id, { doctorId: "Coach Sara", startsAt: "2026-10-21T10:00", patientName: "Ali", patientPhone: "+973 3912 3456", patientCpr: "AB1234567" }))
      .rejects.toMatchObject({ code: "bad_cpr" });
  });
});

describe("customers under each rule", () => {
  it("shares only the first name with no ID number, even when a number is on file", async () => {
    const { data, t } = await setup(NONE);
    await saveCustomerByStaff(data, t.id, { name: "Mona Saleh", phone: "36001122", notes: "likes mornings" }, "x", NONE);
    const r = await lookupCustomer(data, t.id, { phone: "+973 3600 1122", cpr: "850123456" }, "cpr", NONE);
    expect(r).toMatchObject({ found: true, verified: false, first_name: "Mona" });
    expect(JSON.stringify(r)).not.toContain("mornings");
  });

  it("keeps a number saved under an earlier rule while nobody changes it", async () => {
    const { data, t } = await setup();
    const c = await saveCustomerByStaff(data, t.id, { name: "Mona", phone: "36001122", cpr: "850123456" }, "x");
    await data.setBusiness(t.id, { type: "service", id: PASSPORT }, "x");
    const again = await saveCustomerByStaff(data, t.id, { id: c.id, name: "Mona S", phone: "36001122", cpr: "850123456" }, "x", PASSPORT);
    expect(again.cpr).toBe("850123456");
    const edited = await saveCustomerByStaff(data, t.id, { id: c.id, name: "Mona S", phone: "36001122", cpr: "ab123456" }, "x", PASSPORT);
    expect(edited.cpr).toBe("AB123456");
    // with no ID box, an edit keeps the number
    const kept = await saveCustomerByStaff(data, t.id, { id: c.id, name: "Mona", phone: "36001122" }, "x", NONE);
    expect(kept.cpr).toBe("AB123456");
  });
});

describe("screen texts for another ID", () => {
  it("only rewrites texts that exist, and leaves no CPR behind", () => {
    for (const r of [PASSPORT, NONE]) for (const locale of ["en", "ar"] as const) {
      const texts = idTexts(r, locale);
      for (const [k, v] of Object.entries(texts)) {
        expect(k in dictionaries.en, k).toBe(true);
        expect(v, k).not.toMatch(/CPR|\{id|\{format/);
      }
    }
    expect(idTexts(ID_CPR, "en")).toEqual({});
    expect(idTexts(PASSPORT, "en")["bookings.patientCpr"]).toBe("Passport number");
  });
});
