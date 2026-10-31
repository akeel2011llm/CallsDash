import { describe, expect, it } from "vitest";
import { cleanExtra, extraFieldsOf, extraFromLines, extraLines, mergeExtra, parseDetails, type ExtraField } from "@/lib/extra-fields";
import { buildPrompt, extraRules, toolDefinitions } from "@/lib/agent-config";
import { createBookingService } from "@/lib/booking";
import { saveCustomerByStaff, saveCustomerFromAssistant } from "@/lib/customers";
import { customersRows, customersTemplateRows, importCustomers } from "@/lib/data-hub";
import { createPgData, type Db, type Q } from "@/lib/data/pg";
import { agent } from "@/lib/seed";
import { makeDb } from "./helpers/pgdb";

const NOW = new Date("2026-10-21T00:00:00Z");
const line = (o: Partial<{ key: string; label: string; labelAr: string; type: string; options: string; required: boolean; remove: boolean; order: number; ask: boolean }>) =>
  ({ key: "", label: "", labelAr: "", type: "text", options: "", required: false, remove: false, order: 0, ask: false, ...o });

const INSURANCE: ExtraField = { key: "insurance", label: "Insurance company", labelAr: "شركة التأمين", type: "choice", options: ["Bupa", "Axa", "None"], required: true, ask: true };
const PLATE: ExtraField = { key: "car_plate", label: "Car plate", type: "text" }; // staff only
const DOB: ExtraField = { key: "date_of_birth", label: "Date of birth", labelAr: "تاريخ الميلاد", type: "date", ask: true };
const LANGS: ExtraField = { key: "languages", label: "Languages spoken", type: "text", ask: true };
const GENDER: ExtraField = { key: "internal_code", label: "Internal code", type: "text" }; // not told to customers

async function setup() {
  const pg = await makeDb();
  const q: Q = async (sql, params) => (await pg.query(sql, params as unknown[])).rows as never;
  const db: Db = { q, tx: (fn) => pg.transaction((tx) => fn(async (sql, params) => (await tx.query(sql, params as unknown[])).rows as never)) };
  const data = createPgData(db);
  const t = await data.createTenant({ name: "Fields Clinic", nameAr: "", color: "#112233", domain: "", planType: "package", actor: "x" });
  await data.setBusiness(t.id, { type: "clinic", fields: { booking: [INSURANCE, PLATE], customer: [DOB], team: [LANGS, GENDER] } }, "x");
  await q(`insert into doctors (tenant_id, name) values ($1, 'Dr. Hana Ali')`, [t.id]);
  const svc = createBookingService(data, null, () => NOW);
  const tenant = (await data.getTenant(t.id))!;
  return { data, t, tenant, svc };
}
const book = { doctorId: "Dr Hana", startsAt: "2026-10-21T10:00", patientName: "Fatima", patientPhone: "+973 3912 3456", patientCpr: "850123456" };

describe("designing a client's own fields", () => {
  it("makes fields from the designer's lines, with keys, order and the assistant box", () => {
    const f = extraFromLines([
      line({ label: "Insurance company", labelAr: "شركة التأمين", type: "choice", options: "Bupa\nAxa", required: true, ask: true, order: 2 }),
      line({ label: "Car plate", order: 1 }),
      line({ label: "Stock", type: "stock" }), // no stock on a booking: becomes text
      line({ label: "" }), // an empty new line is skipped
    ]);
    expect(f.map((x) => [x.key, x.type, Boolean(x.ask)])).toEqual([["car_plate", "text", false], ["insurance_company", "choice", true], ["stock", "text", false]]);
    expect(f[1].options).toEqual(["Bupa", "Axa"]);
  });

  it("refuses a choice without answers and two fields with the same name", () => {
    expect(() => extraFromLines([line({ label: "Size", type: "choice" })])).toThrow("bad_field");
    expect(() => extraFromLines([line({ label: "Plate" }), line({ label: "plate" })])).toThrow("duplicate_label");
  });

  it("keeps a field's key when it is renamed, so its answers stay with it", () => {
    const f = extraFromLines([line({ key: "car_plate", label: "Vehicle number", ask: true })]);
    expect(f).toEqual([{ key: "car_plate", label: "Vehicle number", type: "text", ask: true }]);
  });
});

describe("answers", () => {
  it("checks required answers for staff, and only the asked ones for the assistant", () => {
    expect(cleanExtra([INSURANCE, PLATE], {}, "all").errors.map((e) => e.key)).toEqual(["insurance"]);
    expect(cleanExtra([INSURANCE, { ...PLATE, required: true }], {}, "asked").errors.map((e) => e.key)).toEqual(["insurance"]);
    expect(cleanExtra([INSURANCE], { insurance: "bupa" }).values).toEqual({ insurance: "Bupa" });
    expect(cleanExtra([INSURANCE], { insurance: "Daman" }).errors[0].code).toBe("bad_choice");
    expect(cleanExtra([INSURANCE, PLATE], { car_plate: "12345" }, "none").values).toEqual({ car_plate: "12345" });
  });

  it("keeps answers to removed fields, and a blank clears a shown one", () => {
    expect(mergeExtra({ old: "x", car_plate: "1" }, [PLATE], { car_plate: "" })).toEqual({ old: "x" });
    expect(mergeExtra({ old: "x" }, [PLATE], { car_plate: "22" })).toEqual({ old: "x", car_plate: "22" });
  });

  it("reads what the assistant passes: JSON, lines, or names in either language", () => {
    expect(parseDetails([INSURANCE, PLATE], '{"insurance":"Axa","car_plate":"777"}')).toEqual({ insurance: "Axa", car_plate: "777" });
    expect(parseDetails([INSURANCE, PLATE], "Insurance company: Bupa\ncar plate = 12")).toEqual({ insurance: "Bupa", car_plate: "12" });
    expect(parseDetails([INSURANCE], { "شركة التأمين": "Axa", other: "x" })).toEqual({ insurance: "Axa" });
    expect(parseDetails([INSURANCE], "")).toEqual({});
  });

  it("shows answers with their labels in the screen's language", () => {
    expect(extraLines([INSURANCE, { key: "vip", label: "VIP", labelAr: "مميز", type: "yesno" }], { insurance: "Axa", vip: "yes" }, "ar", { yes: "نعم", no: "لا" }))
      .toEqual([{ key: "insurance", label: "شركة التأمين", value: "Axa" }, { key: "vip", label: "مميز", value: "نعم" }]);
  });
});

describe("bookings with the client's own fields", () => {
  it("makes staff fill required fields, and keeps the answers", async () => {
    const { svc, t, data } = await setup();
    await expect(svc.bookAppointment(t.id, { ...book, source: "staff", extra: {} })).rejects.toMatchObject({ code: "bad_extra", message: "Insurance company" });
    const b = await svc.bookAppointment(t.id, { ...book, source: "staff", extra: { insurance: "axa", car_plate: "55" } });
    const saved = (await data.getBookings(t.id)).find((x) => x.id === b.bookingId)!;
    expect(saved.extra).toEqual({ insurance: "Axa", car_plate: "55" });
    await svc.staffUpdateDetails(t.id, b.bookingId, { extra: { insurance: "Bupa", car_plate: "" } }, "x");
    expect((await data.getBookings(t.id)).find((x) => x.id === b.bookingId)!.extra).toEqual({ insurance: "Bupa" });
  });

  it("tells the assistant which details to ask for, by key, and books once it has them", async () => {
    const { svc, t, data } = await setup();
    const err = await svc.bookAppointment(t.id, { ...book }).catch((e) => e);
    expect(err.code).toBe("bad_extra");
    expect(err.message).toContain("`insurance`");
    expect(err.message).toContain("one of: Bupa, Axa, None");
    expect(err.message).not.toContain("car_plate"); // staff only
    const b = await svc.bookAppointment(t.id, { ...book, extra: parseDetails(extraFieldsOf((await data.getTenant(t.id))!, "booking"), '{"insurance":"None"}') });
    expect((await data.getBookings(t.id)).find((x) => x.id === b.bookingId)!.extra).toEqual({ insurance: "None" });
  });
});

describe("customers and team members with the client's own fields", () => {
  it("saves customer answers from staff and from the assistant", async () => {
    const { data, t } = await setup();
    await expect(saveCustomerByStaff(data, t.id, { name: "Mona", phone: "36001122", extra: { date_of_birth: "31/02/1990" } }, "x", undefined, [DOB]))
      .rejects.toMatchObject({ code: "bad_extra", detail: "Date of birth" });
    const c = await saveCustomerByStaff(data, t.id, { name: "Mona", phone: "36001122", extra: { date_of_birth: "01/02/1990" } }, "x", undefined, [DOB]);
    expect(c.extra).toEqual({ date_of_birth: "1990-02-01" });
    const r = await saveCustomerFromAssistant(data, t.id, { phone: "39000001", name: "Ali", extra: { date_of_birth: "1985-05-05" } });
    expect(r.customer.extra).toEqual({ date_of_birth: "1985-05-05" });
  });

  it("exports and imports customer answers in their own column", async () => {
    const { data, t } = await setup();
    expect(customersTemplateRows([DOB])[0]).toContain("date_of_birth");
    const res = await importCustomers(data, t.id, "name,phone,Date of birth\nSara,36005555,1992-03-04\n", "x", undefined, [DOB]);
    expect(res.added).toBe(1);
    const rows = customersRows(await data.getCustomers(t.id), [DOB]);
    expect(rows[1][rows[0].indexOf("date_of_birth")]).toBe("1992-03-04");
  });

  it("puts the asked fields in the assistant's rules and the told team details in its team list", async () => {
    const { tenant, data, t } = await setup();
    const [hana] = await data.getDoctors(t.id);
    await data.updateDoctor(t.id, hana.id, { extra: { languages: "Arabic, French", internal_code: "Z9" } }, "x");
    const rules = extraRules(tenant).join("\n");
    expect(rules).toContain("Before calling book_appointment, also ask for these details");
    expect(rules).toContain("Date of birth (in Arabic تاريخ الميلاد): key `date_of_birth`, a date, YYYY-MM-DD");
    expect(rules).not.toContain("Car plate");
    const prompt = buildPrompt(agent("", "X"), await data.getDoctors(t.id), tenant);
    expect(prompt).toContain("Dr. Hana Ali; Languages spoken: Arabic, French (doctor_id:");
    expect(prompt).not.toContain("Z9");
    expect(Object.keys((toolDefinitions("https://x.test", "s").book_appointment as { api_schema: { request_body_schema: { properties: object } } }).api_schema.request_body_schema.properties)).toContain("details");
  });

  it("adds nothing to the instructions for a client without fields", () => {
    expect(extraRules({ business: { type: "clinic" } } as never)).toEqual([]);
  });
});
