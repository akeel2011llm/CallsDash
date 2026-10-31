import { LOCAL_OFFSET_MIN, computeSlots, describeSlot, isOpenAt, isSlotFree, nextOpening, type Busy } from "./availability";
import { SlotTakenError } from "./errors";
import { asciiDigits } from "./cpr";
import { asksId, idRuleOf, idify, normalizeId, type IdRule } from "./id-rule";
import { cleanExtra, describeField, extraFieldsOf, mergeExtra, type ExtraValues } from "./extra-fields";
import type { Calendar, EventInput } from "./google-calendar";
import type { Data } from "./data/demo";
import type { Booking, BookingSource, BookingStatus, DateRange, Doctor, Locale, Tenant } from "./types";

/** Error with a message safe to read back to the caller (the agent turns it into speech). */
export class ToolError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

/** Something happened to a patient's appointment that they should be told about. */
export interface BookingEvent { kind: "booked" | "moved" | "changed"; booking: Booking; doctor: Doctor; /** Who did it, for the audit trail. */ actor: string }

export interface BookingHooks {
  /**
   * Called after an appointment is made, moved, or given to another doctor or phone number. Sends the patient their confirmation (lib/booking-notify.ts) and answers
   * whether one is on its way. It must be quick and must not fail the booking, so the service ignores anything it throws.
   */
  notify?: (e: BookingEvent) => Promise<"queued" | "not_sent">;
}

/** Options a person (not the assistant) can choose for one change. */
export interface ChangeOptions { /** False when the patient should not be sent a confirmation. Missing = send. */ notify?: boolean }

const SLOT_MIN = 30;
const HORIZON_DAYS = 30;
const live = (b: Booking) => b.status === "confirmed" || b.status === "rescheduled";
const lastDigits = (p: string) => asciiDigits(p).replace(/\D/g, "").slice(-8);
const ASK_CPR = "Ask for the patient's CPR number: the 9 digits on their Bahraini ID card. Read it back to confirm.";
/** What the assistant is told when the ID number is missing or not valid, in the client's own ID (lib/id-rule.ts). */
const askId = (r: IdRule) => idify(ASK_CPR, r);
const ASK_PHONE = "Ask for the phone number the booking was made with, and pass it as patient_phone.";

/**
 * The client's own booking fields (lib/extra-fields.ts) from what was given. Staff must fill every required field; the
 * assistant only those it is told to ask for. A problem names the fields, so the assistant knows what to ask again.
 */
function bookingExtra(tenant: Tenant, raw: Record<string, unknown> | undefined, byAssistant: boolean, before?: ExtraValues): ExtraValues | undefined {
  const fields = extraFieldsOf(tenant, "booking");
  if (!fields.length) return before;
  const { values, errors } = cleanExtra(fields, raw ?? {}, byAssistant ? "asked" : "all");
  if (errors.length) {
    const bad = fields.filter((f) => errors.some((e) => e.key === f.key));
    throw new ToolError("bad_extra", byAssistant
      ? `Ask the customer for these details and pass them in details, as a JSON object by key: ${bad.map(describeField).join("; ")}.`
      : bad.map((f) => f.label).join(", "));
  }
  const out = mergeExtra(before, fields, values);
  return Object.keys(out).length ? out : undefined;
}
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
export function createBookingService(data: Data, calendar: Calendar | null, nowFn: () => Date = () => new Date(), hooks: BookingHooks = {}) {
  /** Tells the patient about an appointment, unless the caller said not to. True when a confirmation is on its way. */
  async function tell(kind: BookingEvent["kind"], booking: Booking, doctor: Doctor, actor: string, notify = true): Promise<boolean> {
    if (!notify || !hooks.notify) return false;
    try { return (await hooks.notify({ kind, booking, doctor, actor })) === "queued"; }
    catch { return false; } // a confirmation that cannot be sent never undoes the booking
  }

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

  /**
   * Moves a booking's Google Calendar event from one doctor's calendar to another's. The new event is made first and the
   * old one removed after, so a failure on either side never leaves the booking with no event at all.
   */
  async function moveEvent(tenantId: string, booking: Booking, from: Doctor, to: Doctor, updated: Booking, actor: string): Promise<Booking> {
    if (!calendar) return updated;
    try {
      const eventId = to.googleCalendarId ? await calendar.createEvent(to.googleCalendarId, eventFor(updated)) : undefined;
      updated = await data.updateBooking(tenantId, booking.id, { calendarEventId: eventId ?? "" }, actor);
    } catch {
      await data.addAlert(tenantId, "warning", `Booking for ${booking.patientName} was moved to ${to.name} but Google Calendar was not updated. Its event is still in ${from.name}'s calendar.`);
      return updated;
    }
    if (from.googleCalendarId && booking.calendarEventId) {
      try { await calendar.deleteEvent(from.googleCalendarId, booking.calendarEventId); }
      catch { await data.addAlert(tenantId, "warning", `Booking for ${booking.patientName} was moved to ${to.name}, but its old event could not be removed from ${from.name}'s Google Calendar.`); }
    }
    return updated;
  }

  /**
   * Moves a live booking to a free time, and moves its Google Calendar event with it. With `target`, the booking goes
   * to that doctor at the new time, and its event moves from the old doctor's calendar to the new one's.
   */
  async function moveBooking(tenantId: string, booking: Booking, doctor: Doctor, newStartsAt: string, actor: string, target: Doctor = doctor) {
    const { tenant } = await context(tenantId);
    const startMs = parseStart(newStartsAt);
    if (Number.isNaN(startMs)) throw new ToolError("bad_time", "The start time must be an ISO date-time.");
    const busy = await busyFor(tenant, target, startMs, startMs + booking.durationMin * 60_000, booking.id);
    if (!isSlotFree({ openingHours: hoursFor(tenant, target), busy, startMs, durationMin: booking.durationMin, nowMs: nowFn().getTime() }))
      throw new ToolError("slot_taken", "That time is not available. Offer other slots.");
    const otherDoctor = target.id !== doctor.id;
    let updated: Booking;
    try {
      updated = await data.updateBooking(tenantId, booking.id, { startsAt: new Date(startMs).toISOString(), status: "rescheduled", ...(otherDoctor ? { doctorId: target.id } : {}) }, actor);
    } catch (e) {
      if (e instanceof SlotTakenError) throw new ToolError("slot_taken", "That time was just taken. Offer other slots.");
      throw e;
    }
    if (calendar && otherDoctor) updated = await moveEvent(tenantId, booking, doctor, target, updated, actor);
    else if (calendar && doctor.googleCalendarId && booking.calendarEventId) {
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
      // Every doctor's Google Calendar is read at the same time: one after another, a slow Google could pass ElevenLabs' 20 second wait.
      const perDoctor = await Promise.all(doctors.map(async (d) => ({
        d, busy: await busyFor(tenant, d, from, to),
      })));
      for (const { d, busy } of perDoctor) {
        const slots = computeSlots({
          openingHours: hoursFor(tenant, d), busy, fromMs: from, toMs: to,
          durationMin: SLOT_MIN, nowMs: now.getTime(), limit: p.limit ?? 6,
        });
        for (const s of slots) out.push({ doctorId: d.id, doctor: d.name, start: s, label: describeSlot(s, p.locale ?? "en") });
      }
      out.sort((a, b) => a.start.localeCompare(b.start));
      return { slots: out.slice(0, p.limit ?? 8) };
    },

    async bookAppointment(tenantId: string, p: ChangeOptions & { doctorId: string; startsAt: string; patientName: string; patientPhone: string; patientCpr?: string; service?: string; conversationId?: string; notes?: string; source?: BookingSource; actor?: string; language?: Locale; extra?: Record<string, unknown> }) {
      const { tenant, doctors } = await context(tenantId, p.doctorId);
      const doctor = doctors[0];
      if (!isActive(doctor)) throw new ToolError("doctor_unavailable", "That doctor is not taking bookings. Offer another doctor.");
      const startMs = parseStart(p.startsAt);
      if (Number.isNaN(startMs)) throw new ToolError("bad_time", "The start time must be an ISO date-time.");
      if (!p.patientName.trim() || lastDigits(p.patientPhone).length < 8) throw new ToolError("missing_details", "Ask the patient for their name and a full phone number.");
      // The receptionist can book a patient who has no CPR number (a visitor); the AI always asks, so a number can be found again later.
      // A business that asks for no ID number books with the name and phone number alone.
      const rule = idRuleOf(tenant);
      const cprGiven = asksId(rule) ? (p.patientCpr ?? "").trim() : "";
      const cpr = normalizeId(rule, cprGiven);
      if (asksId(rule) && !cpr && (cprGiven || (p.source ?? "ai") === "ai")) throw new ToolError("bad_cpr", cprGiven ? idify("The CPR number must be 9 digits, or left empty for a visitor.", rule) : askId(rule));
      const extra = bookingExtra(tenant, p.extra, (p.source ?? "ai") === "ai");
      const free = isSlotFree({ openingHours: hoursFor(tenant, doctor), busy: await busyFor(tenant, doctor, startMs, startMs + SLOT_MIN * 60_000), startMs, durationMin: SLOT_MIN, nowMs: nowFn().getTime() });
      if (!free) throw new ToolError("slot_taken", "That time is no longer available. Offer other slots.");
      let booking: Booking;
      try {
        booking = await data.createBooking(tenantId, {
          doctorId: doctor.id, patientName: p.patientName.trim().slice(0, 120), patientPhone: p.patientPhone.trim().slice(0, 30), patientCpr: cpr ?? undefined,
          service: (p.service ?? "Consultation").slice(0, 120), startsAt: new Date(startMs).toISOString(), durationMin: SLOT_MIN, status: "confirmed", conversationId: p.conversationId,
          notes: p.notes?.trim().slice(0, 1000) || undefined, source: p.source ?? "ai", language: p.language === "ar" || p.language === "en" ? p.language : undefined,
          ...(extra ? { extra } : {}),
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
      const whatsappConfirmation = await tell("booked", booking, doctor, p.actor ?? "agent", p.notify);
      return { bookingId: booking.id, doctor: doctor.name, start: booking.startsAt, label: describeSlot(booking.startsAt, "en"), calendarSaved: Boolean(booking.calendarEventId), whatsappConfirmation };
    },

    /**
     * A patient's upcoming bookings, found by CPR number. Bookings made before the CPR was asked have none; they are
     * found by the phone number they were made with, when the patient gives it too.
     */
    async findPatientBookings(tenantId: string, p: { patientCpr: string; patientPhone?: string; locale?: "en" | "ar" }) {
      const { tenant } = await context(tenantId);
      const rule = idRuleOf(tenant);
      const cpr = normalizeId(rule, p.patientCpr);
      const phone = lastDigits(p.patientPhone ?? "");
      if (asksId(rule) && !cpr) throw new ToolError("bad_cpr", askId(rule));
      if (!asksId(rule) && phone.length < 8) throw new ToolError("missing_details", ASK_PHONE);
      const doctors = new Map((await data.getDoctors(tenantId)).map((d) => [d.id, d.name]));
      const now = nowFn().getTime();
      return {
        bookings: (await data.getBookings(tenantId))
          .filter((b) => live(b) && belongsTo(b, cpr, phone) && Date.parse(b.startsAt) > now)
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
          .map((b) => ({ bookingId: b.id, doctorId: b.doctorId, doctor: doctors.get(b.doctorId) ?? "", start: b.startsAt, label: describeSlot(b.startsAt, p.locale ?? "en"), service: b.service })),
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

    async cancelAppointment(tenantId: string, p: { bookingId: string; patientCpr: string; patientPhone?: string }) {
      const { booking, doctor } = await owned(tenantId, p.bookingId, p.patientCpr, p.patientPhone);
      await data.updateBooking(tenantId, booking.id, { status: "cancelled" }, "agent");
      if (calendar && doctor.googleCalendarId && booking.calendarEventId) {
        try { await calendar.deleteEvent(doctor.googleCalendarId, booking.calendarEventId); }
        catch { await data.addAlert(tenantId, "warning", `Booking ${booking.id} was cancelled but its Google Calendar event could not be removed.`); }
      }
      return { cancelled: true };
    },

    /** Moves the patient's booking to a new time, and to another doctor when `doctorId` names one. */
    async rescheduleAppointment(tenantId: string, p: { bookingId: string; patientCpr: string; patientPhone?: string; newStartsAt: string; doctorId?: string; language?: Locale }) {
      const { booking, doctor } = await owned(tenantId, p.bookingId, p.patientCpr, p.patientPhone);
      let target = doctor;
      if (p.doctorId && p.doctorId !== doctor.id) {
        target = (await context(tenantId, p.doctorId)).doctors[0];
        if (!isActive(target)) throw new ToolError("doctor_unavailable", "That doctor is not taking bookings. Offer another doctor.");
      }
      let updated = await moveBooking(tenantId, booking, doctor, p.newStartsAt, "agent", target);
      // the patient is writing or speaking this language now, which is the one their confirmation should be in
      if ((p.language === "ar" || p.language === "en") && updated.language !== p.language) updated = await data.updateBooking(tenantId, updated.id, { language: p.language }, "agent");
      const whatsappConfirmation = await tell("moved", updated, target, "agent");
      return { bookingId: updated.id, moved: true, doctor: target.name, start: updated.startsAt, label: describeSlot(updated.startsAt, "en"), whatsappConfirmation };
    },

    /** The clinic team (receptionist, manager or doctor) moves a booking. No phone check: they are signed in. */
    async staffReschedule(tenantId: string, bookingId: string, newStartsAt: string, actor: string, onlyDoctorId?: string, opts: ChangeOptions = {}) {
      const { booking, doctor } = await found(tenantId, bookingId, onlyDoctorId);
      if (!live(booking)) throw new ToolError("not_active", "Only an active booking can be moved. Restore it first.");
      const updated = await moveBooking(tenantId, booking, doctor, newStartsAt, actor);
      await tell("moved", updated, doctor, actor, opts.notify);
      return updated;
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
     * A new doctor or a corrected phone number means the patient's confirmation is wrong or went astray, so a fresh one is sent
     * (unless `opts.notify` is false). Other fixes, such as a spelling in the name, send nothing.
     */
    async staffUpdateDetails(tenantId: string, bookingId: string, p: { patientName?: string; patientPhone?: string; patientCpr?: string; service?: string; doctorId?: string; language?: string; extra?: Record<string, unknown> }, actor: string, onlyDoctorId?: string, opts: ChangeOptions = {}) {
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
      // Left empty, the CPR stays as it is: a booking made before the CPR was asked can still be edited without one.
      const rule = idRuleOf(tenant);
      if (p.patientCpr?.trim() && asksId(rule)) {
        const cpr = normalizeId(rule, p.patientCpr);
        if (!cpr) throw new ToolError("bad_cpr", idify("The CPR number must be 9 digits.", rule));
        patch.patientCpr = cpr;
      }
      if (p.service !== undefined) patch.service = p.service.trim().slice(0, 120) || "Consultation";
      if (p.language === "ar" || p.language === "en") patch.language = p.language;
      if (p.extra) patch.extra = bookingExtra(tenant, p.extra, false, booking.extra) ?? {};
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
        if (target.id !== doctor.id) updated = await moveEvent(tenantId, booking, doctor, target, updated, actor);
        else if (doctor.googleCalendarId && updated.calendarEventId) {
          try { await calendar.updateEvent(doctor.googleCalendarId, updated.calendarEventId, eventFor(updated)); }
          catch { await data.addAlert(tenantId, "warning", `Booking for ${updated.patientName} was changed but Google Calendar was not updated.`); }
        }
      }
      const newPhone = patch.patientPhone !== undefined && lastDigits(patch.patientPhone) !== lastDigits(booking.patientPhone);
      if (live(updated) && (target.id !== doctor.id || newPhone)) await tell("changed", updated, target, actor, opts.notify);
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

  /** A booking can only be changed by someone who knows the CPR number it was made with (or, before CPR was asked, its phone number). */
  async function owned(tenantId: string, bookingId: string, cprGiven: string, phone = "") {
    const { tenant } = await context(tenantId);
    const rule = idRuleOf(tenant);
    const cpr = normalizeId(rule, cprGiven);
    if (asksId(rule) && !cpr) throw new ToolError("bad_cpr", askId(rule));
    if (!asksId(rule) && lastDigits(phone).length < 8) throw new ToolError("missing_details", ASK_PHONE);
    const booking = (await data.getBookings(tenantId)).find((b) => b.id === bookingId);
    const doctor = booking && (await data.getDoctors(tenantId)).find((d) => d.id === booking.doctorId);
    if (!booking || !doctor || !live(booking) || !belongsTo(booking, cpr, lastDigits(phone)))
      throw new ToolError("not_found", asksId(rule)
        ? idify("No active booking matches that booking and CPR number. Call find_patient_booking with the patient's CPR number (and patient_phone for a booking made before CPR numbers were asked).", rule)
        : "No active booking matches that booking and phone number. Call find_patient_booking with the phone number the booking was made with.");
    return { booking, doctor };
  }
}

/**
 * Whether a booking is the patient's: the same ID number, or for a booking that has none, the same phone number. With no ID
 * number asked (`cpr` null: the business asks for none), the phone number decides for every booking.
 */
function belongsTo(b: Booking, cpr: string | null, phoneDigits: string) {
  if (cpr && b.patientCpr) return b.patientCpr === cpr;
  return phoneDigits.length >= 8 && lastDigits(b.patientPhone) === phoneDigits;
}

export type BookingService = ReturnType<typeof createBookingService>;
