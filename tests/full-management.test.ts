import { describe, expect, it } from "vitest";
import { createBookingService } from "@/lib/booking";
import type { Calendar } from "@/lib/google-calendar";
import { createPgData, type Db, type Q } from "@/lib/data/pg";
import { createFakeAuthAdmin } from "@/lib/auth-admin";
import { createUser, updateUser, type UserActor, type UserDeps } from "@/lib/users";
import { makeDb } from "./helpers/pgdb";

const NOW = new Date("2026-10-21T00:00:00Z"); // Wednesday 03:00 local
const WED_10 = "2026-10-21T07:00:00.000Z"; // 10:00 local
const phone = "+973 3912 3456";

async function setup() {
  const pg = await makeDb();
  const q: Q = async (sql, params) => (await pg.query(sql, params as unknown[])).rows as never;
  const db: Db = { q, tx: (fn) => pg.transaction((tx) => fn(async (sql, params) => (await tx.query(sql, params as unknown[])).rows as never)) };
  const data = createPgData(db);
  const t = await data.createTenant({ name: "Manage Clinic", nameAr: "", color: "#112233", domain: "", planType: "package", actor: "x" });
  const a = await data.addDoctor(t.id, { name: "Dr. A", specialty: "GP" }, "x");
  const b = await data.addDoctor(t.id, { name: "Dr. B", specialty: "Dentist" }, "x");
  await data.setDoctorCalendar(t.id, a.id, "cal-a", "x");
  await data.setDoctorCalendar(t.id, b.id, "cal-b", "x");
  const events: Record<string, { calendar: string; start: string }> = {};
  let n = 0;
  const calendar: Calendar = {
    async busy() { return []; },
    async createEvent(c, e) { const id = `ev${++n}`; events[id] = { calendar: c, start: e.startIso }; return id; },
    async updateEvent(c, id, e) { events[id] = { calendar: c, start: e.startIso }; },
    async deleteEvent(_c, id) { delete events[id]; },
  };
  const svc = createBookingService(data, calendar, () => NOW);
  return { pg, data, t, a, b, svc, events };
}

describe("doctor availability", () => {
  it("offers nothing for a doctor who is not taking bookings, and refuses to book them", async () => {
    const { data, svc, t, a, b } = await setup();
    await data.updateDoctor(t.id, a.id, { active: false }, "x");
    expect((await data.getDoctors(t.id)).find((d) => d.id === a.id)?.active).toBe(false);
    await expect(svc.checkAvailability(t.id, { doctorId: a.id, days: 1 })).rejects.toMatchObject({ code: "doctor_unavailable" });
    const all = (await svc.checkAvailability(t.id, { days: 1, limit: 50 })).slots;
    expect(all.every((s) => s.doctorId === b.id)).toBe(true);
    await expect(svc.bookAppointment(t.id, { doctorId: a.id, startsAt: WED_10, patientName: "X", patientPhone: phone })).rejects.toMatchObject({ code: "doctor_unavailable" });
  });

  it("uses a doctor's own hours instead of the clinic's", async () => {
    const { data, svc, t, a } = await setup();
    await data.updateDoctor(t.id, a.id, { hours: { "3": [["14:00", "16:00"]] } }, "x");
    const slots = (await svc.checkAvailability(t.id, { doctorId: a.id, days: 1, limit: 50 })).slots.map((s) => s.start);
    expect(slots[0]).toBe("2026-10-21T11:00:00.000Z"); // 14:00 local
    expect(slots).toHaveLength(4);
    await expect(svc.bookAppointment(t.id, { doctorId: a.id, startsAt: WED_10, patientName: "X", patientPhone: phone })).rejects.toMatchObject({ code: "slot_taken" });
    await data.updateDoctor(t.id, a.id, { hours: null }, "x");
    expect((await svc.checkAvailability(t.id, { doctorId: a.id, days: 1 })).slots[0].start).toBe("2026-10-21T05:00:00.000Z");
  });

  it("blocks whole days of leave and clinic closures", async () => {
    const { data, svc, t, a, b } = await setup();
    await data.updateDoctor(t.id, a.id, { timeOff: [{ from: "2026-10-21", to: "2026-10-22", note: "Conference" }] }, "x");
    const aSlots = (await svc.checkAvailability(t.id, { doctorId: a.id, days: 3, limit: 1 })).slots;
    expect(aSlots[0].start).toBe("2026-10-23T13:00:00.000Z"); // Wed and Thu are leave; Friday opens at 16:00 local
    expect((await data.getDoctors(t.id)).find((d) => d.id === a.id)?.timeOff).toEqual([{ from: "2026-10-21", to: "2026-10-22", note: "Conference" }]);

    await data.updateTenant(t.id, { closures: [{ from: "2026-10-21", to: "2026-10-21" }] }, "x");
    expect((await data.getTenant(t.id))?.closures).toEqual([{ from: "2026-10-21", to: "2026-10-21" }]);
    const bSlots = (await svc.checkAvailability(t.id, { doctorId: b.id, days: 2, limit: 1 })).slots;
    expect(bSlots[0].start).toBe("2026-10-22T05:00:00.000Z"); // Thursday 08:00 local
    await expect(svc.bookAppointment(t.id, { doctorId: b.id, startsAt: WED_10, patientName: "X", patientPhone: phone })).rejects.toMatchObject({ code: "slot_taken" });
  });
});

describe("staff booking edits", () => {
  it("fixes patient details and hands a booking to another free doctor, moving the calendar event", async () => {
    const { svc, t, a, b, events, data } = await setup();
    const { bookingId } = await svc.bookAppointment(t.id, { doctorId: a.id, startsAt: WED_10, patientName: "Fatma", patientPhone: phone });
    const updated = await svc.staffUpdateDetails(t.id, bookingId, { patientName: "Fatima Ali", patientPhone: "+973 3900 1111", service: "Check-up", doctorId: b.id }, "staff");
    expect(updated).toMatchObject({ patientName: "Fatima Ali", patientPhone: "+973 3900 1111", service: "Check-up", doctorId: b.id });
    expect(Object.values(events)).toEqual([{ calendar: "cal-b", start: WED_10 }]);
    expect((await data.getBookings(t.id)).find((x) => x.id === bookingId)?.calendarEventId).toBe(Object.keys(events)[0]);
  });

  it("refuses a doctor who is busy then, an empty name, and a doctor changing doctors", async () => {
    const { svc, t, a, b } = await setup();
    const one = await svc.bookAppointment(t.id, { doctorId: a.id, startsAt: WED_10, patientName: "One", patientPhone: phone });
    await svc.bookAppointment(t.id, { doctorId: b.id, startsAt: WED_10, patientName: "Two", patientPhone: "+973 3888 7777" });
    await expect(svc.staffUpdateDetails(t.id, one.bookingId, { doctorId: b.id }, "staff")).rejects.toMatchObject({ code: "slot_taken" });
    await expect(svc.staffUpdateDetails(t.id, one.bookingId, { patientName: "  " }, "staff")).rejects.toMatchObject({ code: "missing_details" });
    await expect(svc.staffUpdateDetails(t.id, one.bookingId, { doctorId: b.id }, "doctor", a.id)).rejects.toMatchObject({ code: "not_allowed" });
    await expect(svc.staffUpdateDetails(t.id, one.bookingId, { patientName: "Other" }, "doctor", b.id)).rejects.toMatchObject({ code: "not_found" });
  });

  it("deletes a booking and its calendar event", async () => {
    const { svc, t, a, events, data } = await setup();
    const { bookingId } = await svc.bookAppointment(t.id, { doctorId: a.id, startsAt: WED_10, patientName: "Test", patientPhone: phone });
    await svc.staffDeleteBooking(t.id, bookingId, "manager");
    expect(events).toEqual({});
    expect(await data.getBookings(t.id)).toEqual([]);
    expect((await data.getAudit(t.id)).some((x) => x.action.startsWith("Booking deleted"))).toBe(true);
  });
});

describe("edit and delete in the data layer", () => {
  it("edits a doctor, a client and a knowledge item", async () => {
    const { data, t, a } = await setup();
    const d = await data.updateDoctor(t.id, a.id, { name: "Dr. Amal", specialty: "Paediatrics", color: "#123456" }, "x");
    expect(d).toMatchObject({ name: "Dr. Amal", specialty: "Paediatrics", color: "#123456", active: true, timeOff: [] });
    await data.updateTenant(t.id, { name: "Manage Clinic WLL", retentionDays: 30, lowBalanceThreshold: 0.2, status: "suspended" }, "x");
    expect(await data.getTenant(t.id)).toMatchObject({ name: "Manage Clinic WLL", retentionDays: 30, lowBalanceThreshold: 0.2, status: "suspended" });
    await data.addKnowledge(t.id, "Parking?", "Yes", "en", "x");
    const k = (await data.getKnowledge(t.id))[0];
    await data.updateKnowledge(t.id, k.id, { question: "Is there parking?", answer: "Free, behind the clinic.", language: "en" }, "x");
    expect((await data.getKnowledge(t.id))[0]).toMatchObject({ id: k.id, question: "Is there parking?", answer: "Free, behind the clinic." });
  });

  it("deletes a message, and a conversation without touching the bill", async () => {
    const { data, t } = await setup();
    const conv = await data.recordConversation(t.id, {
      channel: "website", mode: "voice", language: "en", outcome: "answered", transcript: [], startedAt: NOW.toISOString(),
      durationSec: 60, messages: 0, summary: "s", sentiment: "neutral", elevenLabsConversationId: "c-del",
    });
    const r = await data.addStaffRequest(t.id, { kind: "message", name: "A", phone, text: "Call me", urgent: false, language: "en", conversationId: conv.conversation.id });
    await data.deleteConversation(t.id, conv.conversation.id, "manager");
    expect(await data.getConversation(t.id, conv.conversation.id)).toBeUndefined();
    expect((await data.getLedger(t.id)).some((l) => l.kind === "usage")).toBe(true);
    expect((await data.getStaffRequests(t.id))[0].conversationId).toBeUndefined();
    await data.deleteStaffRequest(t.id, r.id, "manager");
    expect(await data.getStaffRequests(t.id)).toEqual([]);
  });

  it("corrects a balance both ways with a reason in the history", async () => {
    const { data, t } = await setup();
    await data.adjustCredits(t.id, 100, "Refund for failed calls", "admin");
    expect((await data.getWallet(t.id)).balance).toBe(2600);
    await data.adjustCredits(t.id, -250.5, "Billing correction", "admin");
    expect((await data.getWallet(t.id)).balance).toBe(2349.5);
    const adj = (await data.getLedger(t.id)).filter((l) => l.kind === "adjustment").map((l) => [l.credits, l.note]);
    expect(adj).toEqual(expect.arrayContaining([[100, "Refund for failed calls"], [-250.5, "Billing correction"]]));
  });

  it("declines a top-up request and deletes only an unused package", async () => {
    const { data, t } = await setup();
    await data.requestTopUp(t.id, 500, "staff");
    const req = (await data.getTopUpRequests())[0];
    await data.declineTopUpRequest(req.id, "admin");
    expect(await data.getTopUpRequests()).toEqual([]);
    expect((await data.getWallet(t.id)).balance).toBe(2500);

    const fresh = await data.savePackage({ type: "package", name: "Trial", nameAr: "", description: "", includedCredits: 100, monthlyPriceBhd: 10, pricePerCreditBhd: 0.1, rolloverCap: 0 }, "admin");
    expect(await data.deletePackage(fresh.id, "admin")).toBe(true);
    expect((await data.listPackages()).some((p) => p.id === fresh.id)).toBe(false);
    const used = (await data.getTenant(t.id))!.plans[0].packageId;
    if (used) expect(await data.deletePackage(used, "admin")).toBe(false);
  });
});

describe("editing people", () => {
  async function people() {
    const s = await setup();
    const fake = createFakeAuthAdmin();
    const auth: typeof fake = { ...fake, createUser: async (i) => { const u = await fake.createUser(i); await s.pg.query(`insert into auth.users (id, email) values ($1,$2)`, [u.id, i.email]); return u; } };
    const deps: UserDeps = { auth, data: s.data };
    const admin: UserActor = { role: "admin", label: "admin" };
    return { ...s, auth, fake, deps, admin };
  }

  it("changes a doctor's name, sign-in email and linked doctor", async () => {
    const { deps, admin, t, a, b, data, fake } = await people();
    const { profile } = await createUser(deps, admin, { email: "amal@clinic.bh", fullName: "Amal", role: "doctor", tenantId: t.id, doctorId: a.id });
    await updateUser(deps, admin, profile.id, { fullName: "Dr Amal Hasan", email: "Amal.Hasan@Clinic.bh", doctorId: b.id });
    expect(await data.getProfile(profile.id)).toMatchObject({ fullName: "Dr Amal Hasan", email: "amal.hasan@clinic.bh", doctorId: b.id });
    expect(fake.users.get(profile.id)?.email).toBe("amal.hasan@clinic.bh");
  });

  it("refuses a taken email, a bad email, and a doctor that already has a sign-in", async () => {
    const { deps, admin, t, a, b } = await people();
    const one = (await createUser(deps, admin, { email: "one@clinic.bh", fullName: "One", role: "doctor", tenantId: t.id, doctorId: a.id })).profile;
    await createUser(deps, admin, { email: "two@clinic.bh", fullName: "Two", role: "doctor", tenantId: t.id, doctorId: b.id });
    await expect(updateUser(deps, admin, one.id, { email: "two@clinic.bh" })).rejects.toMatchObject({ code: "email_taken" });
    await expect(updateUser(deps, admin, one.id, { email: "nope" })).rejects.toMatchObject({ code: "email_invalid" });
    await expect(updateUser(deps, admin, one.id, { doctorId: b.id })).rejects.toMatchObject({ code: "doctor_taken" });
  });

  it("lets a clinic manager edit their doctors and receptionists, but not other managers", async () => {
    const { deps, admin, t, a } = await people();
    const doc = (await createUser(deps, admin, { email: "doc@clinic.bh", fullName: "Doc", role: "doctor", tenantId: t.id, doctorId: a.id })).profile;
    const boss = (await createUser(deps, admin, { email: "boss@clinic.bh", fullName: "Boss", role: "manager", tenantId: t.id })).profile;
    const other = (await createUser(deps, admin, { email: "other@clinic.bh", fullName: "Other", role: "manager", tenantId: t.id })).profile;
    const manager: UserActor = { role: "manager", tenantId: t.id, label: "staff", userId: boss.id };
    await updateUser(deps, manager, doc.id, { fullName: "Doctor A" });
    await expect(updateUser(deps, manager, other.id, { fullName: "X" })).rejects.toMatchObject({ code: "forbidden" });
  });
});
