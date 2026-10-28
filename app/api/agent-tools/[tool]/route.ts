import { timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { createBookingService, ToolError } from "@/lib/booking";
import { bookingNotifier } from "@/lib/booking-notify";
import { getData } from "@/lib/data";
import { sharedCalendar } from "@/lib/booking-service";
import { elevenLabsFromEnv } from "@/lib/elevenlabs-api";
import { asciiDigits } from "@/lib/cpr";
import { appUrl } from "@/lib/app-url";
import { ensureSharedTools } from "@/lib/agent-sync";
import { badHeaderSetting } from "@/lib/header-safe";
import { findItems } from "@/lib/items";
import { CustomerError, lookupCustomer, lookupModeOf, saveCustomerFromAssistant } from "@/lib/customers";

export const dynamic = "force-dynamic";

/**
 * Server tools called by the ElevenLabs agent during a conversation (see docs/agent-tools.md).
 * Auth: `Authorization: Bearer $AGENT_TOOLS_SECRET`. The clinic is identified by the `agent_id` in the body.
 * Failures that the agent should talk about return 200 with ok:false and a message; only auth and malformed calls use HTTP errors.
 */
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const str = (v: unknown) => (typeof v === "string" ? v : "");
/** The language the patient is speaking or writing, when the assistant says it. Anything else is left out. */
const lang = (v: unknown) => (v === "ar" || v === "en" ? v : undefined);

/** The tools that need the patient's CPR number. A call without the field comes from a tool definition made before CPR numbers were asked. */
const CPR_TOOLS = new Set(["book_appointment", "find_patient_booking", "cancel_appointment", "reschedule_appointment"]);
let toolsCheckedAt = 0;

/**
 * Updates the shared booking tools in ElevenLabs after the answer is sent, so a release that adds a field reaches every
 * client's agent without anyone pressing Sync. At most once a minute; does nothing when the keys or address are not usable.
 */
async function refreshSharedTools(data: Awaited<ReturnType<typeof getData>>) {
  const api = elevenLabsFromEnv();
  const toolsSecret = process.env.AGENT_TOOLS_SECRET;
  if (!api || !toolsSecret || badHeaderSetting() || Date.now() - toolsCheckedAt < 60_000) return;
  const url = await appUrl();
  if (!url.startsWith("https://")) return;
  toolsCheckedAt = Date.now();
  after(() => ensureSharedTools({ api, data, appUrl: url, toolsSecret }).catch((e) => console.error("could not update the booking tools", e)));
}

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
  if (CPR_TOOLS.has(tool) && !("patient_cpr" in body)) {
    await refreshSharedTools(data);
    const res = {
      ok: false, error: "tools_outdated",
      message: "The booking tools are being updated and this call could not be completed. Do not try again. Apologise, and use take_message so the team can follow up on the booking.",
    };
    log(tenant.id, res);
    return NextResponse.json(res);
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
  // A booking or a move also sends the patient their WhatsApp confirmation, after the assistant has its answer (lib/booking-notify.ts).
  const svc = createBookingService(data, sharedCalendar(), undefined, { notify: bookingNotifier({ data }) });
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
        return ok(await svc.bookAppointment(tenant.id, {
          doctorId: str(body.doctor_id), startsAt: str(body.starts_at), patientName: str(body.patient_name),
          patientPhone: str(body.patient_phone), patientCpr: str(body.patient_cpr), service: str(body.service) || undefined, conversationId: str(body.conversation_id) || undefined,
          language: lang(body.language),
        }));
      }
      case "find_patient_booking": {
        const { bookings } = await svc.findPatientBookings(tenant.id, {
          patientCpr: str(body.patient_cpr), patientPhone: str(body.patient_phone) || undefined, locale: body.language === "ar" ? "ar" : "en",
        });
        // Field names match cancel_appointment and reschedule_appointment's inputs, so the model copies booking_id and doctor_id across unchanged.
        return ok({
          bookings: bookings.map((b) => ({ booking_id: b.bookingId, doctor_id: b.doctorId, doctor: b.doctor, starts_at: b.start, label: b.label, service: b.service })),
          ...(bookings.length ? {} : { message: str(body.patient_phone)
            ? "No upcoming booking was found for this CPR number and phone number. Read the CPR number back to the patient to check it, then offer to book a new appointment or take a message."
            : "No upcoming booking was found for this CPR number. Read the number back to the patient to check it. If they are sure they have a booking, ask for the phone number it was made with and call find_patient_booking again with both. Otherwise offer to book a new appointment or take a message." }),
        });
      }
      case "cancel_appointment":
        return ok(await svc.cancelAppointment(tenant.id, { bookingId: str(body.booking_id), patientCpr: str(body.patient_cpr), patientPhone: str(body.patient_phone) || undefined }));
      case "reschedule_appointment":
        return ok(await svc.rescheduleAppointment(tenant.id, {
          bookingId: str(body.booking_id), patientCpr: str(body.patient_cpr), patientPhone: str(body.patient_phone) || undefined,
          newStartsAt: str(body.new_starts_at), doctorId: str(body.doctor_id) || undefined, language: lang(body.language),
        }));
      case "lookup_customer":
        return ok(await lookupCustomer(data, tenant.id, { phone: str(body.patient_phone), cpr: str(body.patient_cpr) || undefined }, lookupModeOf(await data.getAgent(tenant.id))));
      case "save_customer": {
        const r = await saveCustomerFromAssistant(data, tenant.id, {
          phone: str(body.patient_phone), name: str(body.patient_name) || undefined, cpr: str(body.patient_cpr) || undefined, email: str(body.email) || undefined,
          note: str(body.note) || undefined, language: lang(body.language), conversationId: str(body.conversation_id) || undefined,
        }, lookupModeOf(await data.getAgent(tenant.id)));
        return ok({
          saved: true, created: r.created,
          ...(str(body.patient_cpr) && !r.cprSaved && !r.customer.cpr ? { message: "The CPR number was not saved: it must be 9 digits, and staff add it to an existing customer's record. Do not mention this to the customer." } : {}),
        });
      }
      case "find_item": {
        const t = await data.getTenant(tenant.id);
        if (!t) return null;
        return ok(await findItems(data, { id: t.id, slug: t.slug }, { query: str(body.query), language: body.language === "ar" ? "ar" : "en" }, await appUrl()));
      }
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
    if (e instanceof CustomerError) return { ok: false, error: e.code, message: CUSTOMER_MESSAGES[e.code] };
    console.error("agent tool failed", tool, e);
    return { ok: false, error: "internal", message: "Something went wrong. Offer to take a message or hand over to staff.", detail: (e instanceof Error ? e.message : "").slice(0, 200) };
  }
}

const ok = (v: object): Record<string, unknown> => ({ ok: true, ...v });

const CUSTOMER_MESSAGES: Record<CustomerError["code"], string> = {
  bad_phone: "That is not a full phone number. Ask the customer for it again.",
  bad_cpr: "That is not a valid CPR number. Read it back to the customer.",
  bad_email: "That is not a valid email address. Ask the customer to spell it.",
  duplicate_phone: "Another customer already has this phone number.",
  cpr_mismatch: "The CPR number does not match the one on file for this phone number, so nothing was changed. Do not share anything about this customer.",
  unknown: "No such customer.",
};

/** What the agent asked, for the log: the fields that decide a booking, with only the last 3 digits of a phone or CPR number. */
function summarize(body: Record<string, unknown>) {
  const keys = ["doctor_id", "from_date", "days", "starts_at", "new_starts_at", "booking_id", "patient_name", "patient_phone", "patient_cpr", "service", "urgent", "query"];
  return keys.filter((k) => body[k] !== undefined && body[k] !== "").map((k) => {
    const v = String(body[k]).slice(0, 60);
    return `${k}=${k === "patient_phone" || k === "patient_cpr" ? `…${asciiDigits(v).replace(/\D/g, "").slice(-3)}` : v}`;
  }).join(" ") || "(no details)";
}

function outcome(res: Record<string, unknown>) {
  if (res.moved) return `moved to ${String(res.label ?? res.start ?? "")}${res.doctor ? ` with ${String(res.doctor)}` : ""}${res.whatsappConfirmation ? ", WhatsApp confirmation queued" : ""}`;
  if (Array.isArray(res.slots)) return `${res.slots.length} free times${res.slots[0] ? `, first ${(res.slots[0] as { label?: string }).label}` : ""}`;
  if (res.bookingId) return `booked ${String(res.label ?? res.start ?? "")} (${String(res.bookingId)})${res.calendarSaved === false ? ", not on Google Calendar" : ""}${res.whatsappConfirmation ? ", WhatsApp confirmation queued" : ""}`;
  if (Array.isArray(res.bookings)) return `${res.bookings.length} bookings found`;
  if (res.cancelled) return "cancelled";
  if (res.requestId) return "saved for staff";
  if (Array.isArray(res.items)) return `${res.items.length} catalogue items found`;
  if (res.saved) return res.created ? "customer added" : "customer updated";
  if ("found" in res) return res.found ? (res.verified ? "customer found, verified by CPR" : "customer found") : "no customer";
  return "ok";
}
