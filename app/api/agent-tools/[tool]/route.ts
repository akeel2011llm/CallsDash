import { timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { createBookingService, ToolError } from "@/lib/booking";
import { getData } from "@/lib/data";
import { sharedCalendar } from "@/lib/booking-service";
import { elevenLabsFromEnv } from "@/lib/elevenlabs-api";
import { sendBookingConfirmation } from "@/lib/whatsapp";
import { asciiDigits } from "@/lib/cpr";

export const dynamic = "force-dynamic";

/**
 * Server tools called by the ElevenLabs agent during a conversation (see docs/agent-tools.md).
 * Auth: `Authorization: Bearer $AGENT_TOOLS_SECRET`. The clinic is identified by the `agent_id` in the body.
 * Failures that the agent should talk about return 200 with ok:false and a message; only auth and malformed calls use HTTP errors.
 */
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const str = (v: unknown) => (typeof v === "string" ? v : "");

export async function POST(req: Request, ctx: { params: Promise<{ tool: string }> }) {
  const secret = process.env.AGENT_TOOLS_SECRET;
  if (!secret) return NextResponse.json({ error: "AGENT_TOOLS_SECRET is not configured" }, { status: 503 });
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  if (!same(given, secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { tool } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const data = await getData();
  const started = Date.now();
  const asked = summarize(body);
  // Written after the answer is sent, so the log never slows the agent down; a failed write is only lost.
  const log = (tenantId: string | undefined, res: Record<string, unknown>) => after(() => data.logToolCall({
    tenantId, tool, ok: res.ok === true, code: typeof res.error === "string" ? res.error : undefined,
    detail: `${asked}${res.ok === true ? ` -> ${outcome(res)}` : ` -> ${String(res.detail ?? res.message ?? res.error ?? "")}`}`.slice(0, 600), ms: Date.now() - started,
  }).catch(() => undefined));

  const tenant = await data.findTenantByAgent(str(body.agent_id));
  if (!tenant) {
    log(undefined, { ok: false, error: "unknown_agent", message: `No client has agent "${str(body.agent_id).slice(0, 60)}". Press Sync for the client.` });
    return NextResponse.json({ error: "unknown agent" }, { status: 404 });
  }
  const res = await run(tool, body, data, tenant.id);
  if (!res) return NextResponse.json({ error: "unknown tool" }, { status: 404 });
  log(tenant.id, res);
  const { detail: _internal, ...answer } = res; // the log keeps the internal error; the caller never hears it
  return NextResponse.json(answer);
}

/** The tool's answer for the agent, or null for a tool that does not exist. */
async function run(tool: string, body: Record<string, unknown>, data: Awaited<ReturnType<typeof getData>>, tenantId: string): Promise<Record<string, unknown> | null> {
  const tenant = { id: tenantId };
  const svc = createBookingService(data, sharedCalendar());
  try {
    switch (tool) {
      case "check_availability": {
        const { slots } = await svc.checkAvailability(tenant.id, {
          doctorId: str(body.doctor_id) || undefined, fromDate: str(body.from_date) || undefined,
          days: Number(body.days) || undefined, locale: body.language === "ar" ? "ar" : "en",
        });
        // Field names match book_appointment's inputs, so the model copies doctor_id and starts_at across unchanged.
        return ok({
          slots: slots.map((x) => ({ doctor_id: x.doctorId, doctor: x.doctor, starts_at: x.start, label: x.label })),
          ...(slots.length ? {} : { message: "No free times in these days. Try later dates (from_date) or another doctor, or offer to take a message." }),
        });
      }
      case "book_appointment": {
        const booked = await svc.bookAppointment(tenant.id, {
          doctorId: str(body.doctor_id), startsAt: str(body.starts_at), patientName: str(body.patient_name),
          patientPhone: str(body.patient_phone), patientCpr: str(body.patient_cpr), service: str(body.service) || undefined, conversationId: str(body.conversation_id) || undefined,
        });
        // The confirmation goes out after the agent has its answer, and a failure only leaves a note: it never undoes the booking.
        const api = elevenLabsFromEnv();
        if (api) after(async () => {
          const r = await sendBookingConfirmation({ api, data }, tenant.id, { patientName: str(body.patient_name), patientPhone: str(body.patient_phone), doctorName: booked.doctor, startsAt: booked.start });
          if (r.status === "sent") await data.audit("agent", `WhatsApp confirmation sent to ${str(body.patient_name)}`, tenant.id);
          if (r.status === "failed") {
            await data.audit("agent", `WhatsApp confirmation failed: ${r.error.slice(0, 160)}`, tenant.id);
            await data.addAlert(tenant.id, "warning", `A booking confirmation could not be sent on WhatsApp (${r.error.slice(0, 120)}). Check the template in WhatsApp Manager.`);
          }
        });
        return ok(booked);
      }
      case "find_patient_booking": {
        const { bookings } = await svc.findPatientBookings(tenant.id, {
          patientCpr: str(body.patient_cpr), patientPhone: str(body.patient_phone) || undefined, locale: body.language === "ar" ? "ar" : "en",
        });
        // Field names match cancel_appointment and reschedule_appointment's inputs, so the model copies booking_id and doctor_id across unchanged.
        return ok({
          bookings: bookings.map((b) => ({ booking_id: b.bookingId, doctor_id: b.doctorId, doctor: b.doctor, starts_at: b.start, label: b.label, service: b.service })),
          ...(bookings.length ? {} : { message: "No upcoming booking was found for this CPR number. Read the number back to the patient to check it, then offer to book a new appointment or take a message." }),
        });
      }
      case "cancel_appointment":
        return ok(await svc.cancelAppointment(tenant.id, { bookingId: str(body.booking_id), patientCpr: str(body.patient_cpr), patientPhone: str(body.patient_phone) || undefined }));
      case "reschedule_appointment":
        return ok(await svc.rescheduleAppointment(tenant.id, {
          bookingId: str(body.booking_id), patientCpr: str(body.patient_cpr), patientPhone: str(body.patient_phone) || undefined,
          newStartsAt: str(body.new_starts_at), doctorId: str(body.doctor_id) || undefined,
        }));
      case "take_message":
        return ok(await svc.takeMessage(tenant.id, {
          name: str(body.patient_name), phone: str(body.patient_phone), message: str(body.message),
          language: str(body.language), conversationId: str(body.conversation_id) || undefined,
        }));
      case "handoff_to_staff":
        return ok(await svc.handoffToStaff(tenant.id, {
          name: str(body.patient_name), phone: str(body.patient_phone), reason: str(body.reason), urgent: body.urgent === true || body.urgent === "true",
          language: str(body.language), conversationId: str(body.conversation_id) || undefined,
        }));
      default:
        return null;
    }
  } catch (e) {
    if (e instanceof ToolError) return { ok: false, error: e.code, message: e.message };
    console.error("agent tool failed", tool, e);
    return { ok: false, error: "internal", message: "Something went wrong. Offer to take a message or hand over to staff.", detail: (e instanceof Error ? e.message : "").slice(0, 200) };
  }
}

const ok = (v: object): Record<string, unknown> => ({ ok: true, ...v });

/** What the agent asked, for the log: the fields that decide a booking, with only the last 3 digits of a phone or CPR number. */
function summarize(body: Record<string, unknown>) {
  const keys = ["doctor_id", "from_date", "days", "starts_at", "new_starts_at", "booking_id", "patient_name", "patient_phone", "patient_cpr", "service", "urgent"];
  return keys.filter((k) => body[k] !== undefined && body[k] !== "").map((k) => {
    const v = String(body[k]).slice(0, 60);
    return `${k}=${k === "patient_phone" || k === "patient_cpr" ? `…${asciiDigits(v).replace(/\D/g, "").slice(-3)}` : v}`;
  }).join(" ") || "(no details)";
}

function outcome(res: Record<string, unknown>) {
  if (res.moved) return `moved to ${String(res.label ?? res.start ?? "")}${res.doctor ? ` with ${String(res.doctor)}` : ""}`;
  if (Array.isArray(res.slots)) return `${res.slots.length} free times${res.slots[0] ? `, first ${(res.slots[0] as { label?: string }).label}` : ""}`;
  if (res.bookingId) return `booked ${String(res.label ?? res.start ?? "")} (${String(res.bookingId)})${res.calendarSaved === false ? ", not on Google Calendar" : ""}`;
  if (Array.isArray(res.bookings)) return `${res.bookings.length} bookings found`;
  if (res.cancelled) return "cancelled";
  if (res.requestId) return "saved for staff";
  return "ok";
}
