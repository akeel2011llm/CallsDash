import { describe, expect, it, vi } from "vitest";
import { createDemoData, type Data } from "@/lib/data/demo";
import { createPgData, type Db, type Q } from "@/lib/data/pg";
import type { BookingMessage } from "@/lib/types";
import { makeDb } from "./helpers/pgdb";

vi.mock("server-only", () => ({}));
const NOBODY = "00000000-0000-4000-8000-000000000000";

/** The same booking, language and WhatsApp note must behave identically in the demo store and in Postgres. */
async function backend(kind: "demo" | "postgres"): Promise<{ data: Data; tenant: string; doctor: string }> {
  if (kind === "demo") return { data: await createDemoData(), tenant: "t_alnoor", doctor: "d_hana" };
  const pg = await makeDb();
  const q: Q = async (sql, params) => (await pg.query(sql, params as unknown[])).rows as never;
  const db: Db = { q, tx: (fn) => pg.transaction((tx) => fn(async (sql, params) => (await tx.query(sql, params as unknown[])).rows as never)) };
  const data = createPgData(db) as Data;
  const t = await data.createTenant({ name: "Al Noor", nameAr: "", color: "#112233", domain: "", planType: "package", actor: "x" });
  const doctor = (await q<{ id: string }>(`insert into doctors (tenant_id, name) values ($1,'Dr. Ali') returning id`, [t.id]))[0].id;
  return { data, tenant: t.id, doctor };
}

describe.each(["demo", "postgres"] as const)("a booking's language and WhatsApp note (%s)", (kind) => {
  const base = (doctorId: string, startsAt: string) => ({
    doctorId, patientName: "Fatima", patientPhone: "+973 3600 1122", service: "Check-up", startsAt, durationMin: 30, status: "confirmed" as const, source: "ai" as const,
  });
  const sending: BookingMessage = { status: "sending", at: "2031-01-01T08:00:00.000Z", lang: "ar" };

  it("keeps the language the patient used, and no note until one is written", async () => {
    const { data, tenant, doctor } = await backend(kind);
    const withLang = await data.createBooking(tenant, { ...base(doctor, "2031-01-05T08:00:00.000Z"), language: "ar" }, "x");
    const without = await data.createBooking(tenant, base(doctor, "2031-01-05T09:00:00.000Z"), "x");
    expect(withLang).toMatchObject({ language: "ar" });
    expect(withLang.message).toBeUndefined();
    expect(without.language).toBeUndefined();
    const read = await data.getBookings(tenant);
    expect(read.find((b) => b.id === withLang.id)).toMatchObject({ language: "ar" });
    expect(read.find((b) => b.id === without.id)!.language).toBeUndefined();
  });

  it("records the last attempt, replaces it, and leaves it alone when the booking is edited", async () => {
    const { data, tenant, doctor } = await backend(kind);
    const b = await data.createBooking(tenant, { ...base(doctor, "2031-01-06T08:00:00.000Z"), language: "ar" }, "x");
    expect((await data.setBookingMessage(tenant, b.id, sending))?.message).toEqual(sending);
    const failed: BookingMessage = { status: "failed", at: "2031-01-01T08:00:05.000Z", detail: "Template does not exist", lang: "ar" };
    await data.setBookingMessage(tenant, b.id, failed);
    const edited = await data.updateBooking(tenant, b.id, { notes: "Bring the previous X-ray" }, "x");
    expect(edited.message).toEqual(failed);
    expect(edited.language).toBe("ar");
    const english = await data.updateBooking(tenant, b.id, { language: "en" }, "x");
    expect(english.language).toBe("en");
    expect((await data.getBookings(tenant)).find((x) => x.id === b.id)!.message).toEqual(failed);
  });

  it("writes a note only on a booking of that clinic that exists", async () => {
    const { data, tenant, doctor } = await backend(kind);
    const b = await data.createBooking(tenant, base(doctor, "2031-01-07T08:00:00.000Z"), "x");
    expect(await data.setBookingMessage(NOBODY, b.id, sending)).toBeUndefined();
    expect(await data.setBookingMessage(tenant, NOBODY, sending)).toBeUndefined();
    expect((await data.getBookings(tenant)).find((x) => x.id === b.id)!.message).toBeUndefined();
  });
});
