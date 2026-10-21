import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createBookingService, ToolError } from "@/lib/booking";
import { createGoogleCalendar, DEFAULT_REMINDERS, type Calendar, type EventInput } from "@/lib/google-calendar";
import { createPgData, type Db, type Q } from "@/lib/data/pg";
import { makeDb } from "./helpers/pgdb";

const NOW = new Date("2026-10-21T00:00:00Z"); // Wednesday 03:00 local

async function setup() {
  const pg = await makeDb();
  const q: Q = async (sql, params) => (await pg.query(sql, params as unknown[])).rows as never;
  const db: Db = { q, tx: (fn) => pg.transaction((tx) => fn(async (sql, params) => (await tx.query(sql, params as unknown[])).rows as never)) };
  const data = createPgData(db);
  const t = await data.createTenant({ name: "Cal Clinic", nameAr: "", color: "#112233", domain: "", planType: "package", actor: "x" });
  const doc = (await q<{ id: string }>(`insert into doctors (tenant_id, name, google_calendar_id) values ($1,'Dr. A','cal-a') returning id`, [t.id]))[0].id;
  const events: Record<string, { start: string; end: string }> = {};
  const full: Record<string, EventInput> = {};
  let nextEvent = 0;
  const blocked: { start: string; end: string }[] = [];
  let failBusy = false;
  const calendar: Calendar = {
    async busy() { if (failBusy) throw new Error("403"); return blocked; },
    async createEvent(_c, e) { const id = `ev${++nextEvent}`; events[id] = { start: e.startIso, end: e.endIso }; full[id] = e; return id; },
    async updateEvent(_c, id, e) { events[id] = { start: e.startIso, end: e.endIso }; full[id] = e; },
    async deleteEvent(_c, id) { delete events[id]; },
  };
  const svc = createBookingService(data, calendar, () => NOW);
  return { data, t, doc, svc, events, full, blocked, fail: (v: boolean) => (failBusy = v), q };
}
const WED_10 = "2026-10-21T07:00:00.000Z"; // 10:00 local
const phone = "+973 3912 3456";

describe("booking service", () => {
  it("offers slots, books one, writes the calendar event, and stops offering it", async () => {
    const { svc, t, doc, events, blocked } = await setup();
    blocked.push({ start: "2026-10-21T05:00:00Z", end: "2026-10-21T06:00:00Z" }); // 08:00-09:00 local blocked in Google Calendar
    const first = (await svc.checkAvailability(t.id, { doctorId: doc, days: 1 })).slots;
    expect(first[0].start).toBe("2026-10-21T06:00:00.000Z"); // 09:00 local: 08:00-09:00 is blocked
    const b = await svc.bookAppointment(t.id, { doctorId: doc, startsAt: WED_10, patientName: "Fatima", patientPhone: phone });
    expect(b.bookingId).toBeTruthy();
    expect(Object.values(events)).toEqual([{ start: WED_10, end: "2026-10-21T07:30:00.000Z" }]);
    const after = (await svc.checkAvailability(t.id, { doctorId: doc, days: 1 })).slots.map((s) => s.start);
    expect(after).not.toContain(WED_10);
  });

  it("refuses a taken or off-grid slot and incomplete details", async () => {
    const { svc, t, doc } = await setup();
    await svc.bookAppointment(t.id, { doctorId: doc, startsAt: WED_10, patientName: "A", patientPhone: phone });
    await expect(svc.bookAppointment(t.id, { doctorId: doc, startsAt: WED_10, patientName: "B", patientPhone: "+973 3999 0000" })).rejects.toMatchObject({ code: "slot_taken" });
    await expect(svc.bookAppointment(t.id, { doctorId: doc, startsAt: "2026-10-21T07:10:00Z", patientName: "B", patientPhone: phone })).rejects.toMatchObject({ code: "slot_taken" });
    await expect(svc.bookAppointment(t.id, { doctorId: doc, startsAt: "2026-10-21T08:00:00Z", patientName: "B", patientPhone: "123" })).rejects.toMatchObject({ code: "missing_details" });
  });

  it("two simultaneous bookings of one slot: exactly one wins", async () => {
    const { svc, t, doc } = await setup();
    const res = await Promise.allSettled([
      svc.bookAppointment(t.id, { doctorId: doc, startsAt: WED_10, patientName: "A", patientPhone: phone }),
      svc.bookAppointment(t.id, { doctorId: doc, startsAt: WED_10, patientName: "B", patientPhone: "+973 3888 7777" }),
    ]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = res.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(ToolError);
  });

  it("finds, reschedules and cancels only with the matching phone number", async () => {
    const { svc, t, doc, events } = await setup();
    const b = await svc.bookAppointment(t.id, { doctorId: doc, startsAt: WED_10, patientName: "Fatima", patientPhone: phone });
    expect((await svc.findPatientBookings(t.id, { patientPhone: "39123456" })).bookings).toHaveLength(1);
    await expect(svc.cancelAppointment(t.id, { bookingId: b.bookingId, patientPhone: "+973 3000 0000" })).rejects.toMatchObject({ code: "not_found" });
    const moved = await svc.rescheduleAppointment(t.id, { bookingId: b.bookingId, patientPhone: "39123456", newStartsAt: "2026-10-21T08:00:00Z" });
    expect(moved.start).toBe("2026-10-21T08:00:00.000Z");
    expect(Object.values(events)[0].start).toBe("2026-10-21T08:00:00.000Z");
    await svc.cancelAppointment(t.id, { bookingId: b.bookingId, patientPhone: phone });
    expect(Object.keys(events)).toHaveLength(0);
    expect((await svc.findPatientBookings(t.id, { patientPhone: phone })).bookings).toHaveLength(0);
    // the freed slot can be booked again
    await svc.bookAppointment(t.id, { doctorId: doc, startsAt: "2026-10-21T08:00:00Z", patientName: "C", patientPhone: "+973 3555 4444" });
  });

  it("lets staff book, move, complete, cancel and restore, keeping the doctor's calendar in step", async () => {
    const { svc, t, doc, events, full, data } = await setup();
    const made = await svc.bookAppointment(t.id, { doctorId: doc, startsAt: WED_10, patientName: "Maryam", patientPhone: phone, service: "Check-up", notes: "Prefers a female nurse", source: "staff", actor: "reception@x" });
    expect(made.calendarSaved).toBe(true);
    const id = made.bookingId;
    expect((await data.getBookings(t.id))[0]).toMatchObject({ source: "staff", notes: "Prefers a female nurse" });
    expect(Object.values(full)[0].description).toMatch(/Notes: Prefers a female nurse[\s\S]*Booked by the clinic team/);

    const moved = await svc.staffReschedule(t.id, id, "2026-10-21T08:00:00Z", "reception@x");
    expect(moved).toMatchObject({ status: "rescheduled", startsAt: "2026-10-21T08:00:00.000Z" });
    expect(Object.values(events)).toEqual([{ start: "2026-10-21T08:00:00.000Z", end: "2026-10-21T08:30:00.000Z" }]);
    await svc.bookAppointment(t.id, { doctorId: doc, startsAt: WED_10, patientName: "Other", patientPhone: "+973 3777 8888", source: "staff" });
    await expect(svc.staffReschedule(t.id, id, WED_10, "x")).rejects.toMatchObject({ code: "slot_taken" });

    await svc.staffSetNotes(t.id, id, "Bring insurance card", "reception@x");
    expect(Object.values(full).some((e) => /Notes: Bring insurance card/.test(e.description ?? ""))).toBe(true);

    expect((await svc.staffSetStatus(t.id, id, "cancelled", "reception@x")).status).toBe("cancelled");
    expect(Object.keys(events)).toHaveLength(1); // only the other patient's event is left
    await expect(svc.staffReschedule(t.id, id, "2026-10-21T09:00:00Z", "x")).rejects.toMatchObject({ code: "not_active" });
    const restored = await svc.staffSetStatus(t.id, id, "confirmed", "reception@x");
    expect(restored.status).toBe("confirmed");
    expect(restored.calendarEventId).toBeTruthy();
    expect(Object.keys(events)).toHaveLength(2);

    // a cancelled booking cannot come back onto a time somebody else has taken since
    await svc.staffSetStatus(t.id, id, "cancelled", "x");
    await svc.bookAppointment(t.id, { doctorId: doc, startsAt: "2026-10-21T08:00:00Z", patientName: "Third", patientPhone: "+973 3000 1111", source: "staff" });
    await expect(svc.staffSetStatus(t.id, id, "confirmed", "x")).rejects.toMatchObject({ code: "slot_taken" });

    await svc.staffSetStatus(t.id, (await svc.bookAppointment(t.id, { doctorId: doc, startsAt: "2026-10-21T09:00:00Z", patientName: "Z", patientPhone: "+973 3222 3333" })).bookingId, "completed", "x");
    await expect(svc.staffSetStatus(t.id, id, "bogus" as never, "x")).rejects.toMatchObject({ code: "bad_status" });
    await expect(svc.staffSetStatus(t.id, "00000000-0000-0000-0000-000000000000", "cancelled", "x")).rejects.toMatchObject({ code: "not_found" });
  });

  it("keeps a doctor's own sign-in to their own bookings", async () => {
    const { svc, t, doc, q } = await setup();
    const other = (await q<{ id: string }>(`insert into doctors (tenant_id, name) values ($1,'Dr. B') returning id`, [t.id]))[0].id;
    const mine = (await svc.bookAppointment(t.id, { doctorId: doc, startsAt: WED_10, patientName: "P", patientPhone: phone, source: "doctor", actor: "doctor:1" })).bookingId;
    await expect(svc.staffSetStatus(t.id, mine, "completed", "doctor:2", other)).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.staffSetNotes(t.id, mine, "x", "doctor:2", other)).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.staffReschedule(t.id, mine, "2026-10-21T08:00:00Z", "doctor:2", other)).rejects.toMatchObject({ code: "not_found" });
    expect((await svc.staffSetStatus(t.id, mine, "completed", "doctor:1", doc)).status).toBe("completed");
  });

  it("never books blind when the calendar cannot be read", async () => {
    const { svc, t, doc, fail, data } = await setup();
    fail(true);
    await expect(svc.checkAvailability(t.id, { doctorId: doc })).rejects.toMatchObject({ code: "calendar_unavailable" });
    await expect(svc.bookAppointment(t.id, { doctorId: doc, startsAt: WED_10, patientName: "A", patientPhone: phone })).rejects.toMatchObject({ code: "calendar_unavailable" });
    expect((await data.getAlerts(t.id)).some((a) => a.severity === "error")).toBe(true);
    expect(await data.getBookings(t.id)).toHaveLength(0);
  });

  it("keeps the booking and raises an alert if only the calendar write fails", async () => {
    const { data, t, doc } = await setup();
    const broken: Calendar = { busy: async () => [], createEvent: async () => { throw new Error("quota"); }, updateEvent: async () => {}, deleteEvent: async () => {} };
    const svc = createBookingService(data, broken, () => NOW);
    await svc.bookAppointment(t.id, { doctorId: doc, startsAt: WED_10, patientName: "A", patientPhone: phone });
    expect(await data.getBookings(t.id)).toHaveLength(1);
    expect((await data.getAlerts(t.id)).some((a) => /not added to Google Calendar/.test(a.message))).toBe(true);
  });
});

describe("google calendar client", () => {
  it("exchanges a signed JWT for a token and calls freeBusy, events with it", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url === "https://oauth2.googleapis.com/token") return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
      if (url.endsWith("/freeBusy")) return new Response(JSON.stringify({ calendars: { "cal@x": { busy: [{ start: "a", end: "b" }] } } }));
      if (url.endsWith("/events")) return new Response(JSON.stringify({ id: "evt1" }));
      return new Response("", { status: 204 });
    }) as unknown as typeof fetch;
    const cal = createGoogleCalendar({ client_email: "svc@p.iam", private_key: pem }, fake, () => 1_800_000_000_000);
    expect(await cal.busy("cal@x", "2026-10-21T00:00:00Z", "2026-10-22T00:00:00Z")).toEqual([{ start: "a", end: "b" }]);
    expect(await cal.createEvent("cal@x", { summary: "s", startIso: "x", endIso: "y" })).toBe("evt1");
    const eventCall = calls.find((x) => x.url.endsWith("/events"))!;
    expect(JSON.parse(String(eventCall.init.body)).reminders).toEqual({ useDefault: false, overrides: DEFAULT_REMINDERS });

    const form = new URLSearchParams(String(calls[0].init.body));
    const [h, c, sig] = form.get("assertion")!.split(".");
    expect(JSON.parse(Buffer.from(c, "base64url").toString())).toMatchObject({ iss: "svc@p.iam", scope: "https://www.googleapis.com/auth/calendar" });
    const v = (await import("node:crypto")).createVerify("RSA-SHA256").update(`${h}.${c}`);
    expect(v.verify(publicKey, sig, "base64url")).toBe(true);
    expect(calls.filter((x) => x.url.includes("oauth2")).length).toBe(1); // token cached
    expect((calls[1].init.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });

  it("reports a calendar that is not shared with the service account", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const fake = (async (url: string) =>
      url.includes("oauth2") ? new Response(JSON.stringify({ access_token: "t", expires_in: 3600 })) :
      new Response(JSON.stringify({ calendars: { c: { errors: [{ reason: "notFound" }] } } }))) as unknown as typeof fetch;
    const cal = createGoogleCalendar({ client_email: "s", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() }, fake);
    await expect(cal.busy("c", "a", "b")).rejects.toThrow(/not shared/);
  });

  it("takes messages and hand-offs into the staff inbox, and tells the agent what to promise", async () => {
    const { svc, t, data } = await setup();
    await expect(svc.takeMessage(t.id, { name: "Sara", phone: "123", message: "Call me" })).rejects.toMatchObject({ code: "missing_details" });
    await expect(svc.takeMessage(t.id, { name: "", phone, message: "Call me" })).rejects.toMatchObject({ code: "missing_details" });
    const m = await svc.takeMessage(t.id, { name: "Sara", phone, message: "Please call about my invoice", language: "ar", conversationId: "conv_1" });
    expect(m.requestId).toBeTruthy();
    const closed = await svc.handoffToStaff(t.id, { name: "Hessa", phone, reason: "Chest pain", urgent: true }); // NOW is Wednesday 03:00 local: closed
    expect(closed).toMatchObject({ open: false, transferred: false });
    expect(closed.message).toContain("closed");
    const openSvc = createBookingService(data, null, () => new Date("2026-10-21T07:00:00Z"));
    expect(await openSvc.handoffToStaff(t.id, { name: "Hessa", phone, reason: "Test results" })).toMatchObject({ open: true });
    const inbox = await data.getStaffRequests(t.id);
    expect(inbox).toHaveLength(3);
    expect(inbox.find((r) => r.kind === "message")).toMatchObject({ name: "Sara", language: "ar", conversationId: "conv_1", status: "open", urgent: false });
    expect(inbox.find((r) => r.urgent)).toMatchObject({ kind: "handoff", text: "Chest pain" });
    await data.setStaffRequestStatus(t.id, m.requestId, "done", "staff");
    expect((await data.getStaffRequests(t.id)).find((r) => r.id === m.requestId)).toMatchObject({ status: "done" });
    const other = await data.createTenant({ name: "Elsewhere", nameAr: "", color: "#112233", domain: "", planType: "payg", actor: "x" });
    await data.setStaffRequestStatus(other.id, inbox[0].id, "done", "staff"); // another clinic cannot touch it
    expect((await data.getStaffRequests(t.id)).filter((r) => r.status === "open")).toHaveLength(2);
  });

  it("saves opening hours, which change what is offered", async () => {
    const { svc, t, data, doc } = await setup();
    await data.setOpeningHours(t.id, { "0": [], "1": [], "2": [], "3": [["10:00", "11:00"]], "4": [], "5": [], "6": [] }, "staff");
    expect((await data.getTenant(t.id))!.openingHours["3"]).toEqual([["10:00", "11:00"]]);
    const slots = (await svc.checkAvailability(t.id, { doctorId: doc, days: 1 })).slots.map((s) => s.start);
    expect(slots).toEqual(["2026-10-21T07:00:00.000Z", "2026-10-21T07:30:00.000Z"]);
  });
});
