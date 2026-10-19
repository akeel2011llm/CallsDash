import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createBookingService, ToolError } from "@/lib/booking";
import { getData } from "@/lib/data";
import { googleCalendarFromEnv } from "@/lib/google-calendar";

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
  const tenant = await data.findTenantByAgent(str(body.agent_id));
  if (!tenant) return NextResponse.json({ error: "unknown agent" }, { status: 404 });
  const svc = createBookingService(data, googleCalendarFromEnvCached());

  try {
    switch (tool) {
      case "check_availability":
        return ok(await svc.checkAvailability(tenant.id, {
          doctorId: str(body.doctor_id) || undefined, fromDate: str(body.from_date) || undefined,
          days: Number(body.days) || undefined, locale: body.language === "ar" ? "ar" : "en",
        }));
      case "book_appointment":
        return ok(await svc.bookAppointment(tenant.id, {
          doctorId: str(body.doctor_id), startsAt: str(body.starts_at), patientName: str(body.patient_name),
          patientPhone: str(body.patient_phone), service: str(body.service) || undefined, conversationId: str(body.conversation_id) || undefined,
        }));
      case "find_patient_booking":
        return ok(await svc.findPatientBookings(tenant.id, { patientPhone: str(body.patient_phone) }));
      case "cancel_appointment":
        return ok(await svc.cancelAppointment(tenant.id, { bookingId: str(body.booking_id), patientPhone: str(body.patient_phone) }));
      case "reschedule_appointment":
        return ok(await svc.rescheduleAppointment(tenant.id, { bookingId: str(body.booking_id), patientPhone: str(body.patient_phone), newStartsAt: str(body.new_starts_at) }));
      default:
        return NextResponse.json({ error: "unknown tool" }, { status: 404 });
    }
  } catch (e) {
    if (e instanceof ToolError) return NextResponse.json({ ok: false, error: e.code, message: e.message });
    console.error("agent tool failed", tool, e);
    return NextResponse.json({ ok: false, error: "internal", message: "Something went wrong. Offer to take a message or hand over to staff." });
  }
}

const ok = (v: object) => NextResponse.json({ ok: true, ...v });

const g = globalThis as unknown as { __callsdashCalendar?: ReturnType<typeof googleCalendarFromEnv> };
const googleCalendarFromEnvCached = () => (g.__callsdashCalendar ??= googleCalendarFromEnv());
