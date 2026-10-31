import { timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { createBookingService, ToolError } from "@/lib/booking";
import { bookingNotifier } from "@/lib/booking-notify";
import { getData } from "@/lib/data";
import { sharedCalendar } from "@/lib/booking-service";
import { elevenLabsFromEnv } from "@/lib/elevenlabs-api";
import { asciiDigits } from "@/lib/cpr";
import { asksId, idRuleOf, idify, type IdRule } from "@/lib/id-rule";
import { cleanExtra, describeField, extraFieldsOf, parseDetails } from "@/lib/extra-fields";
import { appUrl } from "@/lib/app-url";
import { ensureSharedTools } from "@/lib/agent-sync";
import { badHeaderSetting } from "@/lib/header-safe";
import { findItems, itemPageUrl } from "@/lib/items";
import { findRecords } from "@/lib/custom-tables";
import { sendItemPhoto } from "@/lib/whatsapp-photo";
import { CustomerError, lookupCustomer, lookupModeOf, saveCustomerFromAssistant } from "@/lib/customers";

const PHOTO_SKIP: Record<string, string> = {
  no_token: "no WhatsApp access token is saved (Channels, WhatsApp, Photos in WhatsApp chats).",
  no_phone_id: "the phone number ID is missing on the Channels page.",
  no_recipient: "ElevenLabs did not pass the customer's WhatsApp number to CallsDash (caller_phone was empty).",
  no_photo: "the item has no photo.",
  format: "the photo is not JPEG or PNG; upload it again.",
  channel_off: "the client was not found.",
};

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
  const rule = idRuleOf(tenant);
  // a business that asks for no ID number never sends one, so only a client that asks for one can have outdated tools
  if (CPR_TOOLS.has(tool) && asksId(rule) && !("patient_cpr" in body)) {
    await refreshSharedTools(data);
    const res = {
      ok: false, error: "tools_outdated",
      message: "The booking tools are being updated and this call could not be completed. Do not try again. Apologise, and use take_message so the team can follow up on the booking.",
    };
    log(tenant.id, res);
    return NextResponse.json(res);
  }
  const res = await run(tool, body, data, tenant.id, rule);
  if (!res) return NextResponse.json({ error: "unknown tool" }, { status: 404 });
  log(tenant.id, res);
  const { detail: _internal, ...answer } = res; // the log keeps the internal error; the caller never hears it
  return NextResponse.json(answer);
}

/** The tool's answer for the agent, or null for a tool that does not exist. */
async function run(tool: string, body: Record<string, unknown>, data: Awaited<ReturnType<typeof getData>>, tenantId: string, rule: IdRule): Promise<Record<string, unknown> | null> {
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
          language: lang(body.language), extra: parseDetails(extraFieldsOf(await data.getTenant(tenant.id), "booking"), body.details),
        }));
      }
      case "find_patient_booking": {
        const { bookings } = await svc.findPatientBookings(tenant.id, {
          patientCpr: str(body.patient_cpr), patientPhone: str(body.patient_phone) || undefined, locale: body.language === "ar" ? "ar" : "en",
        });
        // Field names match cancel_appointment and reschedule_appointment's inputs, so the model copies booking_id and doctor_id across unchanged.
        return ok({
          bookings: bookings.map((b) => ({ booking_id: b.bookingId, doctor_id: b.doctorId, doctor: b.doctor, starts_at: b.start, label: b.label, service: b.service })),
          ...(bookings.length ? {} : { message: !asksId(rule)
            ? "No upcoming booking was found for this phone number. Read the number back to the customer to check it, then offer to book a new appointment or take a message."
            : idify(str(body.patient_phone)
              ? "No upcoming booking was found for this CPR number and phone number. Read the CPR number back to the patient to check it, then offer to book a new appointment or take a message."
              : "No upcoming booking was found for this CPR number. Read the number back to the patient to check it. If they are sure they have a booking, ask for the phone number it was made with and call find_patient_booking again with both. Otherwise offer to book a new appointment or take a message.", rule) }),
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
        return ok(await lookupCustomer(data, tenant.id, { phone: str(body.patient_phone), cpr: str(body.patient_cpr) || undefined }, lookupModeOf(await data.getAgent(tenant.id), rule), rule));
      case "save_customer": {
        // only the fields the assistant is told to ask for; a value that does not fit is left out and named in the answer
        const asked = extraFieldsOf(await data.getTenant(tenant.id), "customer").filter((f) => f.ask);
        const answers = cleanExtra(asked, parseDetails(asked, body.details), "none");
        const r = await saveCustomerFromAssistant(data, tenant.id, {
          extra: Object.fromEntries(Object.entries(answers.values).filter(([, v]) => v)),
          phone: str(body.patient_phone), name: str(body.patient_name) || undefined, cpr: str(body.patient_cpr) || undefined, email: str(body.email) || undefined,
          note: str(body.note) || undefined, language: lang(body.language), conversationId: str(body.conversation_id) || undefined,
        }, lookupModeOf(await data.getAgent(tenant.id), rule), rule);
        return ok({
          saved: true, created: r.created,
          ...(str(body.patient_cpr) && asksId(rule) && !r.cprSaved && !r.customer.cpr ? { message: idify("The CPR number was not saved: it must be 9 digits, and staff add it to an existing customer's record. Do not mention this to the customer.", rule) } : {}),
          ...(answers.errors.length ? { details_not_saved: `These details were not saved because the answer did not fit; ask again if needed: ${asked.filter((f) => answers.errors.some((e) => e.key === f.key)).map(describeField).join("; ")}.` } : {}),
        });
      }
      case "find_item": {
        const t = await data.getTenant(tenant.id);
        if (!t) return null;
        return ok(await findItems(data, { id: t.id, slug: t.slug }, { query: str(body.query), language: body.language === "ar" ? "ar" : "en" }, await appUrl()));
      }
      case "find_record":
        return ok(await findRecords(data, tenant.id, { query: str(body.query), table: str(body.table), language: body.language === "ar" ? "ar" : "en" }));
      case "send_item_photo": {
        const t = await data.getTenant(tenant.id);
        if (!t) return null;
        const origin = await appUrl();
        const language = lang(body.language);
        const r = await sendItemPhoto(data, tenant.id, { itemId: str(body.item_id), to: str(body.caller_phone), language }, origin);
        if (r.status === "sent") return ok({ sent: true, message: "The photo is being sent on WhatsApp. Do not add a link." });
        // the reason (a refused token, a closed 24-hour window) goes to the admin's alerts; the customer still gets the item through a link
        if (!(r.status === "skipped" && r.reason === "no_item")) {
          const why = r.status === "failed" ? `Meta refused it: ${r.error.slice(0, 200)}` : PHOTO_SKIP[r.status === "skipped" ? r.reason : "no_token"] ?? "unknown reason";
          const text = `A WhatsApp photo was not sent, so the customer got a link instead. Reason: ${why}`;
          if (!(await data.getAlerts(tenant.id)).some((a) => !a.resolved && a.message === text)) await data.addAlert(tenant.id, "warning", text).catch(() => undefined);
        }
        const link = r.status === "skipped" && r.reason === "no_item" ? undefined : itemPageUrl(origin, t.slug, str(body.item_id), language);
        return ok({
          sent: false,
          ...(link ? { link, message: "The photo could not be sent here. Put this link in your reply so the customer can see the item." } : { message: "That item is not available. Do not offer it." }),
          detail: r.status === "failed" ? r.error : r.status === "skipped" ? r.reason : undefined,
        });
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
    if (e instanceof CustomerError) return { ok: false, error: e.code, message: idify(CUSTOMER_MESSAGES[e.code], rule) };
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
  bad_extra: "Some details did not fit their field. Ask the customer again.",
  unknown: "No such customer.",
};

/** What the agent asked, for the log: the fields that decide a booking, with only the last 3 digits of a phone or CPR number. */
function summarize(body: Record<string, unknown>) {
  const keys = ["doctor_id", "from_date", "days", "starts_at", "new_starts_at", "booking_id", "patient_name", "patient_phone", "patient_cpr", "service", "urgent", "query", "table", "item_id"];
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
  if ("sent" in res) return res.sent ? "photo sent on WhatsApp" : `photo not sent (${String(res.detail ?? "")})`;
  if (Array.isArray(res.items)) return `${res.items.length} catalogue items found`;
  if (Array.isArray(res.results)) return `${(res.results as { records: unknown[] }[]).reduce((n, r) => n + r.records.length, 0)} table records found${res.more ? ` (${String(res.more)} more)` : ""}`;
  if (Array.isArray(res.tables)) return res.found ? `${res.tables.length} tables listed` : res.tables.length ? "no table records found" : "no tables for the assistant";
  if (res.saved) return res.created ? "customer added" : "customer updated";
  if ("found" in res) return res.found ? (res.verified ? "customer found, verified by CPR" : "customer found") : "no customer";
  return "ok";
}
