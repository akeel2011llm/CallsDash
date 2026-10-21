import { LOCAL_OFFSET_MIN, computeSlots, describeSlot, isOpenAt, isSlotFree, nextOpening, type Busy } from "./availability";
import { SlotTakenError } from "./errors";
import type { Calendar, EventInput } from "./google-calendar";
import type { Data } from "./data/demo";
import type { Booking, BookingSource, BookingStatus, DateRange, Doctor, Tenant } from "./types";

/** Error with a message safe to read back to the caller (the agent turns it into speech). */
export class ToolError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

const SLOT_MIN = 30;
const HORIZON_DAYS = 30;
const live = (b: Booking) => b.status === "confirmed" || b.status === "rescheduled";
const lastDigits = (p: string) => p.replace(/\D/g, "").slice(-8);
const DAY_MS = 86_400_000;
/** A doctor with their own hours works those; otherwise the clinic's opening hours. */
export const hoursFor = (tenant: Tenant, doctor: Doctor) => doctor.hours ?? tenant.openingHours;
export const isActive = (d: Doctor) => d.active !== false;

const plainName = (s: string) => s.toLowerCase().normalize("NFKC")
  .replace(/^\s*(?:(?:dr|doctor)\b\.?|الدكتورة|الدكتور|دكتورة|دكتور|د\.)\s*/u, "").replace(/[.\s]+/g, " ").trim();

/**
 * The doctor a tool call means. The agent is told to pass the id from check_availability, but a model sometimes passes
 * the doctor's name instead ("Dr. Hana"), so a unique name match is accepted too.
 */
export function matchDoctor<D extends Pick<Doctor, "id" | "name">>(doctors: D[], ref: string): D | undefined {
  const exact = doctors.find((d) => d.id === ref.trim());
  if (exact) return exact;
  const want = plainName(ref);
  if (!want) return undefined;
  const same = doctors.filter((d) => plainName(d.name) === want);
  if (same.length === 1) return same[0];
  const partial = doctors.filter((d) => plainName(d.name).split(" ").includes(want) || plainName(d.name).includes(want));
  return partial.length === 1 ? partial[0] : undefined;
}

/** A slot start from the agent. A time written without a zone ("2026-10-23T16:00") is Bahrain time, as the agent says it. */
export function parseStart(s: string): number {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(t)) {
    const sign = LOCAL_OFFSET_MIN >= 0 ? "+" : "-", m = Math.abs(LOCAL_OFFSET_MIN);
    return Date.parse(`${t.replace(" ", "T")}${sign}${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  }
  return Date.parse(t);
}
/** Whole local days (Bahrain, UTC+3) of leave and clinic closures, as busy time. */
const dayRanges = (ranges: DateRange[] | undefined): Busy[] =>
  (ranges ?? []).map((r) => ({ start: Date.parse(`${r.from}T00:00:00+03:00`), end: Date.parse(`${r.to}T00:00:00+03:00`) + DAY_MS }))
    .filter((r) => !Number.isNaN(r.start) && !Number.isNaN(r.end));

const WHO: Record<BookingSource, string> = { ai: "Booked by the AI receptionist", staff: "Booked by the clinic team", doctor: "Booked by the doctor" };

/** What the doctor sees in Google Calendar for a booking. Notifications come from the reminders on the event. */
export function eventFor(b: Booking): EventInput {
  const lines = [`Patient: ${b.patientName}`, `Phone: ${b.patientPhone}`, `Service: ${b.service}`];
  if (b.notes) lines.push(`Notes: ${b.notes}`);
  lines.push(WHO[b.source ?? "ai"]);
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  if (site) lines.push(`Manage: ${site}/app/bookings/${b.id}`);
  return { summary: `${b.service}: ${b.patientName}`, description: lines.join("\n"), startIso: b.startsAt, endIso: new Date(Date.parse(b.startsAt) + b.durationMin * 60_000).toISOString() };
}

/**
 * Booking operations behind the agent's tools. Bookings in CallsDash are the source of truth for the clinic's
 * availability; Google Calendar is read for busy time (staff may block slots there) and written to for each booking.
 */
export function createBookingService(data: Data, calendar: Calendar | null, nowFn: () => Date = () => new Date()) {
  async function busyFor(tenant: Tenant, doctor: Doctor, fromMs: number, toMs: number, ignoreBookingId?: string): Promise<Busy[]> {
    const busy: Busy[] = (await data.getBookings(tenant.id))
      .filter((b) => b.doctorId === doctor.id && live(b) && b.id !== ignoreBookingId)
      .map((b) => ({ start: Date.parse(b.startsAt), end: Date.parse(b.startsAt) + b.durationMin * 60_000 }));
    busy.push(...dayRanges(doctor.timeOff), ...dayRanges(tenant.closures));
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
    const match = doctorId ? matchDoctor(doctors, doctorId) : undefined;
    const picked = doctorId ? (match ? [match] : []) : doctors;
    if (doctorId && picked.length === 0) throw new ToolError("unknown_doctor", `That doctor was not found. The doctors are: ${doctors.filter(isActive).map((d) => `${d.name} (doctor_id ${d.id})`).join(", ")}.`);
    return { tenant, doctors: picked };
  }

  /** `onlyDoctorId` is set for a doctor's own sign-in: other doctors' bookings do not exist as far as they can tell. */
  async function found(tenantId: string, bookingId: string, onlyDoctorId?: string) {
    const { tenant, doctors } = await context(tenantId);
    const booking = (await data.getBookings(tenantId)).find((b) => b.id === bookingId && (!onlyDoctorId || b.doctorId === onlyDoctorId));
    const doctor = booking && doctors.find((d) => d.id === booking.doctorId);
    if (!booking || !doctor) throw new ToolError("not_found", "That booking was not found.");
    return { tenant, booking, doctor };
  }

  /** Moves a live booking to a free time, and moves its Google Calendar event with it. */
  async function moveBooking(tenantId: string, booking: Booking, doctor: Doctor, newStartsAt: string, actor: string) {
    const { tenant } = await context(tenantId);
    const startMs = parseStart(newStartsAt);
    if (Number.isNaN(startMs)) throw new ToolError("bad_time", "The start time must be an ISO date-time.");
    const busy = await busyFor(tenant, doctor, startMs, startMs + booking.durationMin * 60_000, booking.id);
    if (!isSlotFree({ openingHours: hoursFor(tenant, doctor), busy, startMs, durationMin: booking.durationMin, nowMs: nowFn().getTime() }))
      throw new ToolError("slot_taken", "That time is not available. Offer other slots.");
    let updated: Booking;
    try {
      updated = await data.updateBooking(tenantId, booking.id, { startsAt: new Date(startMs).toISOString(), status: "rescheduled" }, actor);
    } catch (e) {
      if (e instanceof SlotTakenError) throw new ToolError("slot_taken", "That time was just taken. Offer other slots.");
      throw e;
    }
    if (calendar && doctor.googleCalendarId && booking.calendarEventId) {
      try { await calendar.updateEvent(doctor.googleCalendarId, booking.calendarEventId, eventFor(updated)); }
      catch { await data.addAlert(tenantId, "warning", `Booking ${booking.id} was moved but its Google Calendar event was not updated.`); }
    }
    return updated;
  }

  return {
    /** Free slots for one doctor (or every doctor) over the next days, soonest first. */
    async checkAvailability(tenantId: string, p: { doctorId?: string; fromDate?: string; days?: number; locale?: "en" | "ar"; limit?: number }) {
      const { tenant, doctors: all } = await context(tenantId, p.doctorId);
      const doctors = all.filter(isActive);
      if (p.doctorId && doctors.length === 0) throw new ToolError("doctor_unavailable", "That doctor is not taking bookings. Offer another doctor.");
      const now = nowFn();
      const asked = p.fromDate && /^\d{4}-\d{2}-\d{2}$/.test(p.fromDate) ? Date.parse(`${p.fromDate}T00:00:00+03:00`) : now.getTime();
      if (Number.isNaN(asked)) throw new ToolError("bad_date", "The date must be YYYY-MM-DD.");
      // A day already over (the model guessed the year, or today's date was not given) means "from now".
      const from = asked + DAY_MS <= now.getTime() ? now.getTime() : asked;
      const days = Math.min(HORIZON_DAYS, Math.max(1, p.days ?? 7));
      const to = from + days * 86_400_000;
      const out: { doctorId: string; doctor: string; start: string; label: string }[] = [];
      for (const d of doctors) {
        const slots = computeSlots({
          openingHours: hoursFor(tenant, d), busy: await busyFor(tenant, d, from, to), fromMs: from, toMs: to,
          durationMin: SLOT_MIN, nowMs: now.getTime(), limit: p.limit ?? 6,
        });
        for (const s of slots) out.push({ doctorId: d.id, doctor: d.name, start: s, label: describeSlot(s, p.locale ?? "en") });
      }
      out.sort((a, b) => a.start.localeCompare(b.start));
      return { slots: out.slice(0, p.limit ?? 8) };
    },

    async bookAppointment(tenantId: string, p: { doctorId: string; startsAt: string; patientName: string; patientPhone: string; service?: string; conversationId?: string; notes?: string; source?: BookingSource; actor?: string }) {
      const { tenant, doctors } = await context(tenantId, p.doctorId);
      const doctor = doctors[0];
      if (!isActive(doctor)) throw new ToolError("doctor_unavailable", "That doctor is not taking bookings. Offer another doctor.");
      const startMs = parseStart(p.startsAt);
      if (Number.isNaN(startMs)) throw new ToolError("bad_time", "The start time must be an ISO date-time.");
      if (!p.patientName.trim() || lastDigits(p.patientPhone).length < 8) throw new ToolError("missing_details", "Ask the patient for their name and a full phone number.");
      const free = isSlotFree({ openingHours: hoursFor(tenant, doctor), busy: await busyFor(tenant, doctor, startMs, startMs + SLOT_MIN * 60_000), startMs, durationMin: SLOT_MIN, nowMs: nowFn().getTime() });
      if (!free) throw new ToolError("slot_taken", "That time is no longer available. Offer other slots.");
      let booking: Booking;
      try {
        booking = await data.createBooking(tenantId, {
          doctorId: doctor.id, patientName: p.patientName.trim().slice(0, 120), patientPhone: p.patientPhone.trim().slice(0, 30),
          service: (p.service ?? "Consultation").slice(0, 120), startsAt: new Date(startMs).toISOString(), durationMin: SLOT_MIN, status: "confirmed", conversationId: p.conversationId,
          notes: p.notes?.trim().slice(0, 1000) || undefined, source: p.source ?? "ai",
        }, p.actor ?? "agent");
      } catch (e) {
        if (e instanceof SlotTakenError) throw new ToolError("slot_taken", "That time was just taken. Offer other slots.");
        throw e;
      }
      if (calendar && doctor.googleCalendarId) {
        try {
          const eventId = await calendar.createEvent(doctor.googleCalendarId, eventFor(booking));
          booking = await data.updateBooking(tenantId, booking.id, { calendarEventId: eventId }, p.actor ?? "agent");
        } catch {
          // the booking stands; staff see an alert and add the event by hand
          await data.addAlert(tenantId, "warning", `Booking for ${booking.patientName} at ${booking.startsAt} was saved but not added to Google Calendar.`);
        }
      }
      return { bookingId: booking.id, doctor: doctor.name, start: booking.startsAt, label: describeSlot(booking.startsAt, "en"), calendarSaved: Boolean(booking.calendarEventId) };
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
      const { booking, doctor } = await owned(tenantId, p.bookingId, p.patientPhone);
      const updated = await moveBooking(tenantId, booking, doctor!, p.newStartsAt, "agent");
      return { bookingId: updated.id, start: updated.startsAt, label: describeSlot(updated.startsAt, "en") };
    },

    /** The clinic team (receptionist, manager or doctor) moves a booking. No phone check: they are signed in. */
    async staffReschedule(tenantId: string, bookingId: string, newStartsAt: string, actor: string, onlyDoctorId?: string) {
      const { booking, doctor } = await found(tenantId, bookingId, onlyDoctorId);
      if (!live(booking)) throw new ToolError("not_active", "Only an active booking can be moved. Restore it first.");
      return moveBooking(tenantId, booking, doctor, newStartsAt, actor);
    },

    /**
     * Completed, no-show and cancelled never block the doctor's time. Cancelling removes the Google Calendar event;
     * restoring a cancelled booking checks the time is still free and adds the event again.
     */
    async staffSetStatus(tenantId: string, bookingId: string, status: BookingStatus, actor: string, onlyDoctorId?: string) {
      if (!["confirmed", "completed", "no_show", "cancelled"].includes(status)) throw new ToolError("bad_status", "Unknown status.");
      const { booking, doctor, tenant } = await found(tenantId, bookingId, onlyDoctorId);
      if (booking.status === status) return booking;
      const wasCancelled = booking.status === "cancelled";
      if (status === "confirmed" && wasCancelled) {
        const startMs = Date.parse(booking.startsAt);
        const busy = await busyFor(tenant, doctor, startMs, startMs + booking.durationMin * 60_000, booking.id);
        if (!isSlotFree({ openingHours: hoursFor(tenant, doctor), busy, startMs, durationMin: booking.durationMin, nowMs: nowFn().getTime() }))
          throw new ToolError("slot_taken", "That time is no longer available. Book a new time instead.");
      }
      let updated: Booking;
      try {
        updated = await data.updateBooking(tenantId, booking.id, { status }, actor);
      } catch (e) {
        if (e instanceof SlotTakenError) throw new ToolError("slot_taken", "That time was taken by another booking.");
        throw e;
      }
      if (calendar && doctor.googleCalendarId) {
        try {
          if (status === "cancelled" && booking.calendarEventId) await calendar.deleteEvent(doctor.googleCalendarId, booking.calendarEventId);
          else if (status === "confirmed" && wasCancelled) updated = await data.updateBooking(tenantId, booking.id, { calendarEventId: await calendar.createEvent(doctor.googleCalendarId, eventFor(updated)) }, actor);
        } catch {
          await data.addAlert(tenantId, "warning", `Booking for ${booking.patientName} was set to ${status} but its Google Calendar event could not be updated.`);
        }
      }
      return updated;
    },

    async staffSetNotes(tenantId: string, bookingId: string, notes: string, actor: string, onlyDoctorId?: string) {
      const { booking, doctor } = await found(tenantId, bookingId, onlyDoctorId);
      const updated = await data.updateBooking(tenantId, booking.id, { notes: notes.trim().slice(0, 1000) }, actor);
      if (calendar && doctor.googleCalendarId && updated.calendarEventId && live(updated)) {
        try { await calendar.updateEvent(doctor.googleCalendarId, updated.calendarEventId, eventFor(updated)); }
        catch { await data.addAlert(tenantId, "warning", `Notes for ${booking.patientName} were saved but not copied to Google Calendar.`); }
      }
      return updated;
    },

    /**
     * Fixes the patient's details or the service, and can hand the booking to another doctor at the same time
     * (only if that doctor is free then). Moving doctors moves the Google Calendar event to the new doctor's calendar.
     */
    async staffUpdateDetails(tenantId: string, bookingId: string, p: { patientName?: string; patientPhone?: string; service?: string; doctorId?: string }, actor: string, onlyDoctorId?: string) {
      const { tenant, booking, doctor } = await found(tenantId, bookingId, onlyDoctorId);
      const patch: Partial<Booking> = {};
      if (p.patientName !== undefined) {
        const v = p.patientName.replace(/\s+/g, " ").trim().slice(0, 120);
        if (!v) throw new ToolError("missing_details", "The patient's name is required.");
        patch.patientName = v;
      }
      if (p.patientPhone !== undefined) {
        if (lastDigits(p.patientPhone).length < 8) throw new ToolError("missing_details", "Enter a full phone number.");
        patch.patientPhone = p.patientPhone.trim().slice(0, 30);
      }
      if (p.service !== undefined) patch.service = p.service.trim().slice(0, 120) || "Consultation";
      let target = doctor;
      if (p.doctorId && p.doctorId !== doctor.id) {
        if (onlyDoctorId) throw new ToolError("not_allowed", "Only the clinic team can give a booking to another doctor.");
        const next = (await data.getDoctors(tenantId)).find((d) => d.id === p.doctorId);
        if (!next) throw new ToolError("unknown_doctor", "That doctor was not found.");
        if (!isActive(next)) throw new ToolError("doctor_unavailable", "That doctor is not taking bookings.");
        if (live(booking)) {
          const startMs = Date.parse(booking.startsAt);
          const busy = await busyFor(tenant, next, startMs, startMs + booking.durationMin * 60_000, booking.id);
          if (!isSlotFree({ openingHours: hoursFor(tenant, next), busy, startMs, durationMin: booking.durationMin, nowMs: Math.min(nowFn().getTime(), startMs) }))
            throw new ToolError("slot_taken", "That doctor is not free at this time. Pick another time or doctor.");
        }
        patch.doctorId = next.id;
        target = next;
      }
      let updated: Booking;
      try {
        updated = await data.updateBooking(tenantId, booking.id, patch, actor);
      } catch (e) {
        if (e instanceof SlotTakenError) throw new ToolError("slot_taken", "That doctor already has a booking at this time.");
        throw e;
      }
      if (calendar && live(updated)) {
        try {
          if (target.id !== doctor.id) {
            if (doctor.googleCalendarId && booking.calendarEventId) await calendar.deleteEvent(doctor.googleCalendarId, booking.calendarEventId);
            const eventId = target.googleCalendarId ? await calendar.createEvent(target.googleCalendarId, eventFor(updated)) : undefined;
            updated = await data.updateBooking(tenantId, booking.id, { calendarEventId: eventId ?? "" }, actor);
          } else if (doctor.googleCalendarId && updated.calendarEventId) {
            await calendar.updateEvent(doctor.googleCalendarId, updated.calendarEventId, eventFor(updated));
          }
        } catch {
          await data.addAlert(tenantId, "warning", `Booking for ${updated.patientName} was changed but Google Calendar was not updated.`);
        }
      }
      return updated;
    },

    /** Removes a booking for good (made by mistake, a test, or a privacy request) and its Google Calendar event. */
    async staffDeleteBooking(tenantId: string, bookingId: string, actor: string) {
      const { booking, doctor } = await found(tenantId, bookingId);
      if (calendar && doctor.googleCalendarId && booking.calendarEventId) {
        try { await calendar.deleteEvent(doctor.googleCalendarId, booking.calendarEventId); }
        catch { await data.addAlert(tenantId, "warning", `Booking for ${booking.patientName} was deleted but its Google Calendar event could not be removed.`); }
      }
      await data.deleteBooking(tenantId, booking.id, actor);
      return { deleted: true };
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
