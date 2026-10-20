import { computeSlots, describeSlot, isOpenAt, isSlotFree, nextOpening, type Busy } from "./availability";
import { SlotTakenError } from "./errors";
import type { Calendar } from "./google-calendar";
import type { Data } from "./data/demo";
import type { Booking, Doctor, Tenant } from "./types";

/** Error with a message safe to read back to the caller (the agent turns it into speech). */
export class ToolError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

const SLOT_MIN = 30;
const HORIZON_DAYS = 30;
const live = (b: Booking) => b.status === "confirmed" || b.status === "rescheduled";
const lastDigits = (p: string) => p.replace(/\D/g, "").slice(-8);

/**
 * Booking operations behind the agent's tools. Bookings in CallsDash are the source of truth for the clinic's
 * availability; Google Calendar is read for busy time (staff may block slots there) and written to for each booking.
 */
export function createBookingService(data: Data, calendar: Calendar | null, nowFn: () => Date = () => new Date()) {
  async function busyFor(tenant: Tenant, doctor: Doctor, fromMs: number, toMs: number, ignoreBookingId?: string): Promise<Busy[]> {
    const busy: Busy[] = (await data.getBookings(tenant.id))
      .filter((b) => b.doctorId === doctor.id && live(b) && b.id !== ignoreBookingId)
      .map((b) => ({ start: Date.parse(b.startsAt), end: Date.parse(b.startsAt) + b.durationMin * 60_000 }));
    if (calendar && doctor.googleCalendarId) {
      try {
        for (const x of await calendar.busy(doctor.googleCalendarId, new Date(fromMs).toISOString(), new Date(toMs).toISOString()))
          busy.push({ start: Date.parse(x.start), end: Date.parse(x.end) });
      } catch {
        // never book blind: if the clinic's calendar cannot be read, tell the agent so it can offer a callback
        await data.addAlert(tenant.id, "error", `Google Calendar for ${doctor.name} could not be read. Check that the calendar is shared with the service account.`);
        throw new ToolError("calendar_unavailable", "The clinic calendar is not reachable right now. Offer to take a message or hand over to staff.");
      }
    }
    return busy;
  }

  async function context(tenantId: string, doctorId?: string) {
    const tenant = await data.getTenant(tenantId);
    if (!tenant) throw new ToolError("unknown_clinic", "Unknown clinic.");
    const doctors = await data.getDoctors(tenantId);
    const picked = doctorId ? doctors.filter((d) => d.id === doctorId) : doctors;
    if (doctorId && picked.length === 0) throw new ToolError("unknown_doctor", "That doctor was not found.");
    return { tenant, doctors: picked };
  }

  return {
    /** Free slots for one doctor (or every doctor) over the next days, soonest first. */
    async checkAvailability(tenantId: string, p: { doctorId?: string; fromDate?: string; days?: number; locale?: "en" | "ar" }) {
      const { tenant, doctors } = await context(tenantId, p.doctorId);
      const now = nowFn();
      const from = p.fromDate && /^\d{4}-\d{2}-\d{2}$/.test(p.fromDate) ? Date.parse(`${p.fromDate}T00:00:00+03:00`) : now.getTime();
      if (Number.isNaN(from)) throw new ToolError("bad_date", "The date must be YYYY-MM-DD.");
      const days = Math.min(HORIZON_DAYS, Math.max(1, p.days ?? 7));
      const to = from + days * 86_400_000;
      const out: { doctorId: string; doctor: string; start: string; label: string }[] = [];
      for (const d of doctors) {
        const slots = computeSlots({
          openingHours: tenant.openingHours, busy: await busyFor(tenant, d, from, to), fromMs: from, toMs: to,
          durationMin: SLOT_MIN, nowMs: now.getTime(), limit: 6,
        });
        for (const s of slots) out.push({ doctorId: d.id, doctor: d.name, start: s, label: describeSlot(s, p.locale ?? "en") });
      }
      out.sort((a, b) => a.start.localeCompare(b.start));
      return { slots: out.slice(0, 8) };
    },

    async bookAppointment(tenantId: string, p: { doctorId: string; startsAt: string; patientName: string; patientPhone: string; service?: string; conversationId?: string }) {
      const { tenant, doctors } = await context(tenantId, p.doctorId);
      const doctor = doctors[0];
      const startMs = Date.parse(p.startsAt);
      if (Number.isNaN(startMs)) throw new ToolError("bad_time", "The start time must be an ISO date-time.");
      if (!p.patientName.trim() || lastDigits(p.patientPhone).length < 8) throw new ToolError("missing_details", "Ask the patient for their name and a full phone number.");
      const free = isSlotFree({ openingHours: tenant.openingHours, busy: await busyFor(tenant, doctor, startMs, startMs + SLOT_MIN * 60_000), startMs, durationMin: SLOT_MIN, nowMs: nowFn().getTime() });
      if (!free) throw new ToolError("slot_taken", "That time is no longer available. Offer other slots.");
      let booking: Booking;
      try {
        booking = await data.createBooking(tenantId, {
          doctorId: doctor.id, patientName: p.patientName.trim().slice(0, 120), patientPhone: p.patientPhone.trim().slice(0, 30),
          service: (p.service ?? "Consultation").slice(0, 120), startsAt: new Date(startMs).toISOString(), durationMin: SLOT_MIN, status: "confirmed", conversationId: p.conversationId,
        }, "agent");
      } catch (e) {
        if (e instanceof SlotTakenError) throw new ToolError("slot_taken", "That time was just taken. Offer other slots.");
        throw e;
      }
      if (calendar && doctor.googleCalendarId) {
        try {
          const eventId = await calendar.createEvent(doctor.googleCalendarId, {
            summary: `${booking.service}: ${booking.patientName}`, description: `Phone: ${booking.patientPhone}\nBooked by the AI receptionist`,
            startIso: booking.startsAt, endIso: new Date(startMs + SLOT_MIN * 60_000).toISOString(),
          });
          booking = await data.updateBooking(tenantId, booking.id, { calendarEventId: eventId }, "agent");
        } catch {
          // the booking stands; staff see an alert and add the event by hand
          await data.addAlert(tenantId, "warning", `Booking for ${booking.patientName} at ${booking.startsAt} was saved but not added to Google Calendar.`);
        }
      }
      return { bookingId: booking.id, doctor: doctor.name, start: booking.startsAt, label: describeSlot(booking.startsAt, "en") };
    },

    /** Upcoming bookings for a phone number. */
    async findPatientBookings(tenantId: string, p: { patientPhone: string }) {
      await context(tenantId);
      const digits = lastDigits(p.patientPhone);
      if (digits.length < 8) throw new ToolError("missing_details", "Ask the patient for their full phone number.");
      const doctors = new Map((await data.getDoctors(tenantId)).map((d) => [d.id, d.name]));
      const now = nowFn().getTime();
      return {
        bookings: (await data.getBookings(tenantId))
          .filter((b) => live(b) && lastDigits(b.patientPhone) === digits && Date.parse(b.startsAt) > now)
          .map((b) => ({ bookingId: b.id, doctor: doctors.get(b.doctorId) ?? "", start: b.startsAt, label: describeSlot(b.startsAt, "en"), service: b.service })),
      };
    },

    /** Leaves a message for the clinic team. It appears in the dashboard inbox. */
    async takeMessage(tenantId: string, p: { name: string; phone: string; message: string; language?: string; conversationId?: string }) {
      const r = await staffRequest(tenantId, "message", { name: p.name, phone: p.phone, text: p.message, language: p.language, conversationId: p.conversationId });
      return { requestId: r.id, message: "The message is saved for the team. Tell the caller they will be contacted on the number given." };
    },

    /**
     * Asks a person to call the patient back. Live transfer to a phone line is not available yet, so this is a
     * callback request, marked urgent when the agent says so. The reply tells the agent what to promise.
     */
    async handoffToStaff(tenantId: string, p: { name: string; phone: string; reason: string; urgent?: boolean; language?: string; conversationId?: string }) {
      const { tenant } = await context(tenantId);
      const r = await staffRequest(tenantId, "handoff", { name: p.name, phone: p.phone, text: p.reason, urgent: p.urgent, language: p.language, conversationId: p.conversationId });
      const nowMs = nowFn().getTime();
      const open = isOpenAt(tenant.openingHours, nowMs);
      const next = open ? null : nextOpening(tenant.openingHours, nowMs);
      return {
        requestId: r.id, open, transferred: false,
        message: open
          ? "A team member has been asked to call the caller back on the number given, shortly. Do not promise a live transfer."
          : `The clinic is closed now${next ? `; it opens ${describeSlot(next, p.language === "ar" ? "ar" : "en")}` : ""}. A team member will call the caller back after it opens. Do not promise a live transfer.`,
      };
    },

    async cancelAppointment(tenantId: string, p: { bookingId: string; patientPhone: string }) {
      const { booking, doctor } = await owned(tenantId, p.bookingId, p.patientPhone);
      await data.updateBooking(tenantId, booking.id, { status: "cancelled" }, "agent");
      if (calendar && doctor?.googleCalendarId && booking.calendarEventId) {
        try { await calendar.deleteEvent(doctor.googleCalendarId, booking.calendarEventId); }
        catch { await data.addAlert(tenantId, "warning", `Booking ${booking.id} was cancelled but its Google Calendar event could not be removed.`); }
      }
      return { cancelled: true };
    },

    async rescheduleAppointment(tenantId: string, p: { bookingId: string; patientPhone: string; newStartsAt: string }) {
      const { tenant, doctors } = await context(tenantId);
      void doctors;
      const { booking, doctor } = await owned(tenantId, p.bookingId, p.patientPhone);
      const startMs = Date.parse(p.newStartsAt);
      if (Number.isNaN(startMs)) throw new ToolError("bad_time", "The start time must be an ISO date-time.");
      const busy = await busyFor(tenant, doctor!, startMs, startMs + SLOT_MIN * 60_000, booking.id);
      if (!isSlotFree({ openingHours: tenant.openingHours, busy, startMs, durationMin: booking.durationMin, nowMs: nowFn().getTime() }))
        throw new ToolError("slot_taken", "That time is not available. Offer other slots.");
      let updated: Booking;
      try {
        updated = await data.updateBooking(tenantId, booking.id, { startsAt: new Date(startMs).toISOString(), status: "rescheduled" }, "agent");
      } catch (e) {
        if (e instanceof SlotTakenError) throw new ToolError("slot_taken", "That time was just taken. Offer other slots.");
        throw e;
      }
      if (calendar && doctor?.googleCalendarId && booking.calendarEventId) {
        try { await calendar.moveEvent(doctor.googleCalendarId, booking.calendarEventId, updated.startsAt, new Date(startMs + updated.durationMin * 60_000).toISOString()); }
        catch { await data.addAlert(tenantId, "warning", `Booking ${booking.id} was moved but its Google Calendar event was not updated.`); }
      }
      return { bookingId: updated.id, start: updated.startsAt, label: describeSlot(updated.startsAt, "en") };
    },
  };

  /** Used by the staff tools below. */
  async function staffRequest(tenantId: string, kind: "message" | "handoff", p: { name: string; phone: string; text: string; urgent?: boolean; language?: string; conversationId?: string }) {
    await context(tenantId);
    const name = p.name.replace(/\s+/g, " ").trim().slice(0, 120);
    const text = p.text.trim().slice(0, 1000);
    if (lastDigits(p.phone).length < 8) throw new ToolError("missing_details", "Ask the caller for a phone number staff can call back on.");
    if (!name) throw new ToolError("missing_details", "Ask the caller for their name.");
    if (!text) throw new ToolError("missing_details", kind === "message" ? "Ask what the message should say." : "Ask the caller what they need help with.");
    return data.addStaffRequest(tenantId, {
      kind, name, phone: p.phone.trim().slice(0, 40), text, urgent: Boolean(p.urgent), language: p.language === "ar" ? "ar" : "en",
      conversationId: p.conversationId?.slice(0, 120) || undefined,
    });
  }

  /** A booking can only be changed by someone who knows the phone number it was made with. */
  async function owned(tenantId: string, bookingId: string, phone: string) {
    const booking = (await data.getBookings(tenantId)).find((b) => b.id === bookingId);
    if (!booking || !live(booking) || lastDigits(booking.patientPhone) !== lastDigits(phone) || lastDigits(phone).length < 8)
      throw new ToolError("not_found", "No active booking matches that reference and phone number.");
    const doctor = (await data.getDoctors(tenantId)).find((d) => d.id === booking.doctorId);
    return { booking, doctor };
  }
}

export type BookingService = ReturnType<typeof createBookingService>;
