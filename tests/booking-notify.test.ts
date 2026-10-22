import { describe, expect, it } from "vitest";
import { createBookingService, type BookingEvent } from "@/lib/booking";
import { bookingNotifier, deliverConfirmation } from "@/lib/booking-notify";
import { bookingRef } from "@/lib/booking-ref";
import type { ElevenLabsApi } from "@/lib/elevenlabs-api";
import { createPgData, type Db, type Q } from "@/lib/data/pg";
import type { Data } from "@/lib/data/demo";
import type { WhatsappSettings } from "@/lib/types";
import { makeDb } from "./helpers/pgdb";

const NOW = new Date("2026-10-21T00:00:00Z"); // Wednesday 03:00 local
const WED_10 = "2026-10-21T07:00:00.000Z"; // 10:00 local
const WED_11 = "2026-10-21T08:00:00.000Z"; // 11:00 local
const PHONE = "+973 3600 1122";
const CPR = "850123456";
const WA: WhatsappSettings = {
  phoneNumberId: "524", confirmTemplate: "appointment_confirmation", confirmTemplateLang: "en", confirmWording: "full", templateLangs: ["en", "ar"],
  address: "Building 12, Road 3, Manama", phone: "+973 1700 0000",
};

async function setup(opts: { wa?: WhatsappSettings | null; channel?: "connected" | "pending"; agentId?: string; fail?: string | (() => Error) } = {}) {
  const pg = await makeDb();
  const q: Q = async (sql, params) => (await pg.query(sql, params as unknown[])).rows as never;
  const db: Db = { q, tx: (fn) => pg.transaction((tx) => fn(async (sql, params) => (await tx.query(sql, params as unknown[])).rows as never)) };
  const data = createPgData(db) as Data;
  const t = await data.createTenant({ name: "Al Noor Clinic", nameAr: "عيادة النور", color: "#112233", domain: "", planType: "package", actor: "x" });
  const doc = (await q<{ id: string }>(`insert into doctors (tenant_id, name) values ($1,'Dr. Ali') returning id`, [t.id]))[0].id;
  await data.saveAgent(t.id, { ...(await data.getAgent(t.id)), elevenLabsAgentId: opts.agentId ?? "agent_1" }, "x", "connect");
  if (opts.wa !== null) await data.setIntegrations(t.id, { whatsapp: opts.wa ?? WA }, "x", "whatsapp");
  await data.setChannelStatus(t.id, "whatsapp", opts.channel ?? "connected", "x");
  const sent: { templateName: string; languageCode: string; userId: string; params: { parameters: { parameter_name: string; text: string }[] }[]; dynamicVariables?: Record<string, string> }[] = [];
  let failWith = opts.fail;
  const api = {
    sendWhatsappTemplate: async (i: never) => {
      if (failWith) throw typeof failWith === "string" ? new Error(failWith) : failWith();
      sent.push(i);
      return { conversation_id: `conv_${sent.length}` };
    },
  } as unknown as ElevenLabsApi;
  const later: (() => Promise<unknown>)[] = [];
  const schedule = (fn: () => Promise<unknown>) => { later.push(fn); };
  const flush = async () => { while (later.length) await later.shift()!(); };
  const notify = bookingNotifier({ data, api, schedule, now: () => NOW });
  const svc = createBookingService(data, null, () => NOW, { notify });
  return { data, t, doc, svc, sent, later, flush, q, api, fail: (v: typeof failWith) => (failWith = v) };
}
const book = (s: Awaited<ReturnType<typeof setup>>, o: Record<string, unknown> = {}) =>
  s.svc.bookAppointment(s.t.id, { doctorId: s.doc, startsAt: WED_10, patientName: "Fatima Ali", patientPhone: PHONE, patientCpr: CPR, service: "Dental check", ...o });
const messageOf = async (s: Awaited<ReturnType<typeof setup>>, id: string) => (await s.data.getBookings(s.t.id)).find((b) => b.id === id)!.message;

describe("the confirmation after a booking", () => {
  it("is sent after the answer, with every detail, and recorded on the booking", async () => {
    const s = await setup();
    const booked = await book(s, { language: "en" });
    expect(booked.whatsappConfirmation).toBe(true);
    // while the booking answers the assistant, the message is only marked as sending
    expect(s.sent).toHaveLength(0);
    expect(await messageOf(s, booked.bookingId)).toMatchObject({ status: "sending", lang: "en" });
    await s.flush();
    expect(s.sent).toHaveLength(1);
    const by = Object.fromEntries(s.sent[0].params[0].parameters.map((p) => [p.parameter_name, p.text]));
    expect(by).toMatchObject({ name: "Fatima Ali", clinic: "Al Noor Clinic", doctor: "Dr. Ali", service: "Dental check", time: "10:00 AM", phone: "+973 1700 0000", reference: bookingRef(booked.bookingId) });
    expect(by.date).toContain("21 October 2026");
    expect(by.address).toBe("Building 12, Road 3, Manama");
    expect(s.sent[0]).toMatchObject({ templateName: "appointment_confirmation", languageCode: "en", userId: "97336001122" });
    expect(await messageOf(s, booked.bookingId)).toMatchObject({ status: "sent", conversationId: "conv_1", lang: "en" });
    expect((await s.data.getAudit(s.t.id)).some((a) => a.action.includes("WhatsApp confirmation sent to Fatima Ali"))).toBe(true);
  });

  it("is in the patient's language, which is kept on the booking", async () => {
    const s = await setup();
    const booked = await book(s, { language: "ar" });
    await s.flush();
    expect(s.sent[0].languageCode).toBe("ar");
    expect((await s.data.getBookings(s.t.id))[0].language).toBe("ar");
  });

  it("goes in the main language when the booking has none, or the clinic has no template in the patient's", async () => {
    const s = await setup({ wa: { ...WA, templateLangs: ["en"] } });
    await book(s, { language: "ar" });
    await s.flush();
    expect(s.sent[0].languageCode).toBe("en");
  });

  it("is not sent when the person booking says not to", async () => {
    const s = await setup();
    const booked = await book(s, { notify: false });
    expect(booked.whatsappConfirmation).toBe(false);
    await s.flush();
    expect(s.sent).toHaveLength(0);
    expect(await messageOf(s, booked.bookingId)).toBeUndefined();
  });

  it("tells the assistant nothing about WhatsApp when the clinic does not use it", async () => {
    for (const s of [await setup({ channel: "pending" }), await setup({ wa: { ...WA, confirmations: false } })]) {
      const booked = await book(s);
      expect(booked.whatsappConfirmation).toBe(false);
      await s.flush();
      expect(s.sent).toHaveLength(0);
      expect(await messageOf(s, booked.bookingId)).toBeUndefined(); // nothing to show: the clinic just does not use it
    }
  });

  it("notes why nothing was sent when someone can fix it", async () => {
    const noPhoneId = await setup({ wa: { ...WA, phoneNumberId: undefined } });
    const a = await book(noPhoneId);
    expect(a.whatsappConfirmation).toBe(false);
    expect(await messageOf(noPhoneId, a.bookingId)).toMatchObject({ status: "skipped", detail: "not_configured" });

    const badPhone = await setup();
    const b = await book(badPhone, { patientPhone: "+1234567890123456789" }); // a full booking phone, but too long for WhatsApp
    expect(b.whatsappConfirmation).toBe(false);
    expect(await messageOf(badPhone, b.bookingId)).toMatchObject({ status: "skipped", detail: "bad_phone" });

    const noAgent = await setup({ agentId: "" });
    const c = await book(noAgent);
    expect(await messageOf(noAgent, c.bookingId)).toMatchObject({ status: "skipped", detail: "no_agent" });
  });

  it("never undoes the booking when WhatsApp refuses: the reason is on the booking, in the audit trail and in one alert", async () => {
    const s = await setup({ fail: "ElevenLabs 422: {\"detail\":[{\"loc\":[\"body\"],\"msg\":\"Template does not exist\"}]}" });
    const first = await book(s);
    const second = await book(s, { startsAt: WED_11, patientName: "Omar", patientPhone: "+973 3999 0000" });
    await s.flush();
    const bookings = await s.data.getBookings(s.t.id);
    expect(bookings).toHaveLength(2);
    expect(bookings.every((b) => b.status === "confirmed")).toBe(true);
    expect(await messageOf(s, first.bookingId)).toMatchObject({ status: "failed", detail: "Template does not exist" });
    expect(await messageOf(s, second.bookingId)).toMatchObject({ status: "failed" });
    const alerts = (await s.data.getAlerts(s.t.id)).filter((a) => a.message.includes("could not be sent on WhatsApp"));
    expect(alerts).toHaveLength(1); // not one per booking
    expect(alerts[0].message).toContain("Check the template's name and language in WhatsApp Manager");
    expect((await s.data.getAudit(s.t.id)).some((a) => a.action.startsWith("WhatsApp confirmation failed"))).toBe(true);
  });

  it("does not fail a booking if the notifier itself breaks", async () => {
    const s = await setup();
    const svc = createBookingService(s.data, null, () => NOW, { notify: async () => { throw new Error("boom"); } });
    const booked = await svc.bookAppointment(s.t.id, { doctorId: s.doc, startsAt: WED_10, patientName: "Fatima", patientPhone: PHONE, patientCpr: CPR });
    expect(booked.bookingId).toBeTruthy();
    expect(booked.whatsappConfirmation).toBe(false);
  });

  it("does nothing without an ElevenLabs key", async () => {
    const s = await setup();
    await book(s, { notify: false });
    const event: BookingEvent = { kind: "booked", booking: (await s.data.getBookings(s.t.id))[0], doctor: (await s.data.getDoctors(s.t.id))[0], actor: "x" };
    const notify = bookingNotifier({ data: s.data, api: null, schedule: (fn) => { s.later.push(fn); } });
    expect(await notify(event)).toBe("not_sent");
    expect(s.later).toHaveLength(0);
  });
});

describe("a booking that is moved", () => {
  it("sends the new time, from the assistant and from staff, unless staff say not to", async () => {
    const s = await setup();
    const booked = await book(s, { language: "en" });
    await s.flush();
    expect(s.sent).toHaveLength(1);

    const moved = await s.svc.rescheduleAppointment(s.t.id, { bookingId: booked.bookingId, patientCpr: CPR, newStartsAt: WED_11, language: "ar" });
    expect(moved.whatsappConfirmation).toBe(true);
    await s.flush();
    expect(s.sent).toHaveLength(2);
    expect(s.sent[1].languageCode).toBe("ar"); // the language the patient is now using is kept
    expect(s.sent[1].params[0].parameters.find((p) => p.parameter_name === "time")!.text).toContain("11:00");

    await s.svc.staffReschedule(s.t.id, booked.bookingId, "2026-10-21T09:00:00.000Z", "Reem", undefined, { notify: false });
    await s.flush();
    expect(s.sent).toHaveLength(2);

    await s.svc.staffReschedule(s.t.id, booked.bookingId, "2026-10-21T10:00:00.000Z", "Reem");
    await s.flush();
    expect(s.sent).toHaveLength(3);
    expect(s.sent[2].languageCode).toBe("ar"); // staff moves keep the language the patient last used
    expect(s.sent[2].params[0].parameters.find((p) => p.parameter_name === "time")!.text).toContain("1:00");
    expect(await messageOf(s, booked.bookingId)).toMatchObject({ status: "sent", conversationId: "conv_3" });
  });
});

describe("a booking that changes hands", () => {
  const params = (s: Awaited<ReturnType<typeof setup>>, i: number) => Object.fromEntries(s.sent[i].params[0].parameters.map((p) => [p.parameter_name, p.text]));
  const noor = (s: Awaited<ReturnType<typeof setup>>) => s.q<{ id: string }>(`insert into doctors (tenant_id, name) values ($1,'Dr. Noor') returning id`, [s.t.id]).then((r) => r[0].id);

  it("sends a fresh confirmation when staff give it to another doctor or correct the phone number, and nothing for other fixes", async () => {
    const s = await setup();
    const other = await noor(s);
    const booked = await book(s, { language: "en" });
    await s.flush();
    expect(s.sent).toHaveLength(1);

    await s.svc.staffUpdateDetails(s.t.id, booked.bookingId, { patientName: "Fatima A. Ali", service: "Cleaning" }, "Reem");
    await s.flush();
    expect(s.sent).toHaveLength(1); // a spelling or service fix tells the patient nothing new

    await s.svc.staffUpdateDetails(s.t.id, booked.bookingId, { doctorId: other }, "Reem");
    await s.flush();
    expect(s.sent).toHaveLength(2);
    expect(params(s, 1)).toMatchObject({ doctor: "Dr. Noor", service: "Cleaning", name: "Fatima A. Ali", time: "10:00 AM" });

    await s.svc.staffUpdateDetails(s.t.id, booked.bookingId, { patientPhone: "+973 3999 0011" }, "Reem");
    await s.flush();
    expect(s.sent).toHaveLength(3);
    expect(s.sent[2].userId).toBe("97339990011"); // to the corrected number

    await s.svc.staffUpdateDetails(s.t.id, booked.bookingId, { patientPhone: "3999 0011" }, "Reem");
    await s.flush();
    expect(s.sent).toHaveLength(3); // the same number written another way is not a change

    await s.svc.staffUpdateDetails(s.t.id, booked.bookingId, { doctorId: s.doc }, "Reem", undefined, { notify: false });
    await s.flush();
    expect(s.sent).toHaveLength(3); // staff said not to
    expect((await s.data.getBookings(s.t.id))[0].doctorId).toBe(s.doc);
  });

  it("sends nothing for a booking that is no longer active", async () => {
    const s = await setup();
    const other = await noor(s);
    const booked = await book(s);
    await s.flush();
    await s.svc.staffSetStatus(s.t.id, booked.bookingId, "cancelled", "Reem");
    await s.svc.staffUpdateDetails(s.t.id, booked.bookingId, { doctorId: other, patientPhone: "+973 3999 0011" }, "Reem");
    await s.flush();
    expect(s.sent).toHaveLength(1);
  });
});

describe("sending again", () => {
  it("replaces a failure with the new outcome", async () => {
    const s = await setup({ fail: "template not approved" });
    const booked = await book(s);
    await s.flush();
    expect(await messageOf(s, booked.bookingId)).toMatchObject({ status: "failed", detail: "template not approved" });
    s.fail(undefined);
    const r = await deliverConfirmation({ api: s.api, data: s.data, now: () => NOW }, s.t.id, booked.bookingId, "Reem");
    expect(r).toMatchObject({ status: "sent" });
    expect(await messageOf(s, booked.bookingId)).toMatchObject({ status: "sent" });
  });

  it("leaves no booking stuck on 'sending' when nothing could be sent after all", async () => {
    const s = await setup();
    const booked = await book(s);
    expect(await messageOf(s, booked.bookingId)).toMatchObject({ status: "sending" });
    await s.data.setChannelStatus(s.t.id, "whatsapp", "pending", "x"); // switched off between the booking and the sending
    await s.flush();
    expect(await messageOf(s, booked.bookingId)).toMatchObject({ status: "skipped", detail: "channel_off" });
  });

  it("does nothing for a booking that is gone", async () => {
    const s = await setup();
    expect(await deliverConfirmation({ api: s.api, data: s.data }, s.t.id, "00000000-0000-0000-0000-000000000000", "x")).toBeNull();
  });
});

describe("the booking record", () => {
  it("keeps the language and the message apart from the other details", async () => {
    const s = await setup();
    const booked = await book(s, { language: "ar", notify: false });
    await s.data.setBookingMessage(s.t.id, booked.bookingId, { status: "failed", at: NOW.toISOString(), detail: "x", lang: "ar" });
    // later edits do not wipe either
    const edited = await s.svc.staffUpdateDetails(s.t.id, booked.bookingId, { service: "Cleaning" }, "Reem");
    expect(edited).toMatchObject({ language: "ar", service: "Cleaning" });
    const again = (await s.data.getBookings(s.t.id))[0];
    expect(again.message).toMatchObject({ status: "failed", detail: "x" });
    expect((await s.svc.staffUpdateDetails(s.t.id, booked.bookingId, { language: "en" }, "Reem")).language).toBe("en");
    expect((await s.svc.staffUpdateDetails(s.t.id, booked.bookingId, { language: "fr" }, "Reem")).language).toBe("en"); // an unknown language is ignored
  });

  it("gives a booking made before any of this no language and no message", async () => {
    const s = await setup();
    await s.q(`insert into bookings (tenant_id, doctor_id, patient_name, patient_phone, service, starts_at, duration_min, status) values ($1,$2,'Old','+97336001122','Visit','2026-10-22T07:00:00Z',30,'confirmed')`, [s.t.id, s.doc]);
    const old = (await s.data.getBookings(s.t.id))[0];
    expect(old.language).toBeUndefined();
    expect(old.message).toBeUndefined();
  });
});

describe("the short booking reference", () => {
  it("is eight capitals and digits taken from the id", () => {
    expect(bookingRef("3f2a9c1e-77aa-4d1f-9b0c-0123456789ab")).toBe("3F2A9C1E");
    expect(bookingRef("b_12")).toBe("B12");
    expect(bookingRef("")).toBe("");
  });
});
