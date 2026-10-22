import { after } from "next/server";
import { bookingRef } from "./booking-ref";
import type { BookingEvent } from "./booking";
import type { Data } from "./data/demo";
import { elevenLabsFromEnv, type ElevenLabsApi } from "./elevenlabs-api";
import { HINT_EN, failureHint, messageOf, planConfirmation, sendBookingConfirmation, type ConfirmationResult } from "./whatsapp";

type Clock = () => Date;
const nowIso = (now?: Clock) => (now ?? (() => new Date()))().toISOString();

/**
 * Sends a booking's WhatsApp confirmation now and records what happened on the booking (sent, failed, or why nothing was
 * sent). Returns the outcome, or null when the booking no longer exists. A failure also leaves a line in the audit trail and,
 * once, an alert for the clinic, since it usually means the template needs attention in WhatsApp Manager.
 */
export async function deliverConfirmation(d: { api: ElevenLabsApi; data: Data; now?: Clock }, tenantId: string, bookingId: string, actor: string): Promise<ConfirmationResult | null> {
  const booking = (await d.data.getBookings(tenantId)).find((b) => b.id === bookingId);
  if (!booking) return null;
  const doctor = (await d.data.getDoctors(tenantId)).find((x) => x.id === booking.doctorId);
  const result = await sendBookingConfirmation(d, tenantId, {
    patientName: booking.patientName, patientPhone: booking.patientPhone, doctorName: doctor?.name ?? "", startsAt: booking.startsAt,
    service: booking.service, reference: bookingRef(booking.id), language: booking.language,
  });
  const at = nowIso(d.now);
  // a note that said "sending" must never stay that way, even when nothing could be sent after all
  const record = messageOf(result, at) ?? (result.status === "skipped" && booking.message?.status === "sending" ? { status: "skipped" as const, at, detail: result.reason } : null);
  if (record) await d.data.setBookingMessage(tenantId, bookingId, record);
  if (result.status === "sent") await d.data.audit(actor, `WhatsApp confirmation sent to ${booking.patientName}`, tenantId);
  if (result.status === "failed") {
    await d.data.audit(actor, `WhatsApp confirmation failed: ${result.error.slice(0, 160)}`, tenantId);
    const hint = failureHint(result.error);
    const text = `A booking confirmation could not be sent on WhatsApp (${result.error.slice(0, 120)}). ${hint ? HINT_EN[hint] : "Check the template in WhatsApp Manager."}`;
    if (!(await d.data.getAlerts(tenantId)).some((a) => !a.resolved && a.message === text)) await d.data.addAlert(tenantId, "warning", text);
  }
  return result;
}

/**
 * What the booking service calls when an appointment is made or moved. It checks that a confirmation can go out, marks the
 * booking "sending" and hands the sending to `after`, which runs once the answer to the patient or the assistant has gone, so
 * WhatsApp never slows a booking down. Answers "queued" when a confirmation is on its way.
 */
export function bookingNotifier(d: { data: Data; api?: ElevenLabsApi | null; schedule?: (fn: () => Promise<unknown>) => void; now?: Clock }) {
  return async ({ booking, actor }: BookingEvent): Promise<"queued" | "not_sent"> => {
    const api = d.api === undefined ? elevenLabsFromEnv() : d.api;
    if (!api) return "not_sent";
    const plan = await planConfirmation(d, booking.tenantId, booking.patientPhone, booking.language);
    if (!plan.send) {
      const record = messageOf({ status: "skipped", reason: plan.reason }, nowIso(d.now));
      if (record) await d.data.setBookingMessage(booking.tenantId, booking.id, record);
      return "not_sent";
    }
    await d.data.setBookingMessage(booking.tenantId, booking.id, { status: "sending", at: nowIso(d.now), lang: plan.lang });
    (d.schedule ?? after)(() => deliverConfirmation({ api, data: d.data, now: d.now }, booking.tenantId, booking.id, actor).catch((e) => console.error("could not send the booking confirmation", e)));
    return "queued";
  };
}
