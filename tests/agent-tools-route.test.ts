import { beforeEach, describe, expect, it, vi } from "vitest";

const { ensure, book, move, logged, makeService, notify } = vi.hoisted(() => {
  const book = vi.fn(async (..._a: unknown[]) => ({ bookingId: "b1", label: "Sat 24 Oct, 4:00 PM", whatsappConfirmation: true }));
  const move = vi.fn(async (..._a: unknown[]) => ({ moved: true, label: "Sat 24 Oct, 5:00 PM", whatsappConfirmation: false }));
  return {
    ensure: vi.fn(async (..._a: unknown[]) => undefined),
    book, move, notify: vi.fn(async (..._a: unknown[]) => "queued"),
    logged: vi.fn(async (..._a: unknown[]) => undefined),
    makeService: vi.fn((..._a: unknown[]) => ({ bookAppointment: book, rescheduleAppointment: move })),
  };
});
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => { void fn(); } }));
vi.mock("@/lib/data", () => ({
  getData: async () => ({
    findTenantByAgent: async () => ({ id: "t1" }), logToolCall: (...a: unknown[]) => logged(...a), getTenant: async () => undefined, getDoctors: async () => [],
  }),
}));
vi.mock("@/lib/booking", async (orig) => ({ ...(await orig<typeof import("@/lib/booking")>()), createBookingService: (...a: unknown[]) => makeService(...a) }));
vi.mock("@/lib/booking-service", () => ({ sharedCalendar: () => null }));
vi.mock("@/lib/booking-notify", () => ({ bookingNotifier: () => notify }));
vi.mock("@/lib/app-url", () => ({ appUrl: async () => "https://app.example" }));
vi.mock("@/lib/agent-sync", () => ({ ensureSharedTools: (...a: unknown[]) => ensure(...a) }));
vi.mock("@/lib/elevenlabs-api", () => ({ elevenLabsFromEnv: () => (process.env.ELEVENLABS_API_KEY ? {} : null) }));

async function call(tool: string, body: object) {
  const { POST } = await import("@/app/api/agent-tools/[tool]/route");
  const res = await POST(new Request("http://x", { method: "POST", headers: { authorization: "Bearer sec" }, body: JSON.stringify({ agent_id: "agent_1", ...body }) }), { params: Promise.resolve({ tool }) });
  return res.json() as Promise<Record<string, unknown>>;
}

beforeEach(() => {
  vi.resetModules(); // the route remembers when it last checked the tools
  ensure.mockClear();
  book.mockClear();
  move.mockClear();
  logged.mockClear();
  makeService.mockClear();
  process.env.AGENT_TOOLS_SECRET = "sec";
  process.env.ELEVENLABS_API_KEY = "key";
});

describe("a booking tool called without a CPR number", () => {
  it("updates the shared tools once, and tells the agent to take a message", async () => {
    for (const tool of ["book_appointment", "find_patient_booking", "cancel_appointment", "reschedule_appointment"]) {
      expect(await call(tool, { patient_phone: "+973 3912 3456" })).toMatchObject({ ok: false, error: "tools_outdated", message: expect.stringContaining("take_message") });
    }
    expect(ensure).toHaveBeenCalledTimes(1); // not once per call: a looping agent must not hammer ElevenLabs
    expect(ensure.mock.calls[0][0]).toMatchObject({ appUrl: "https://app.example", toolsSecret: "sec" });
  });

  it("only answers when the ElevenLabs key is not set", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    expect(await call("book_appointment", {})).toMatchObject({ error: "tools_outdated" });
    expect(ensure).not.toHaveBeenCalled();
  });

  it("is not triggered by a call that has the field, even empty, or by tools that do not use it", async () => {
    expect(await call("find_patient_booking", { patient_cpr: "" })).not.toMatchObject({ error: "tools_outdated" });
    expect(await call("take_message", {})).not.toMatchObject({ error: "tools_outdated" });
    expect(await call("check_availability", {})).not.toMatchObject({ error: "tools_outdated" });
    expect(ensure).not.toHaveBeenCalled();
  });
});

describe("the WhatsApp confirmation of a booking made by the assistant", () => {
  const booking = { doctor_id: "d1", starts_at: "2026-10-24T13:00:00.000Z", patient_name: "Fatima", patient_phone: "+973 3912 3456", patient_cpr: "900101234" };

  it("builds the booking service with the WhatsApp notifier, so a booking and a move send the confirmation", async () => {
    await call("book_appointment", booking);
    expect(makeService).toHaveBeenCalledTimes(1);
    expect(makeService.mock.calls[0][3]).toEqual({ notify });
  });

  it("passes on the language the patient is using, and tells the assistant that a confirmation is on its way", async () => {
    const res = await call("book_appointment", { ...booking, language: "ar" });
    expect(book.mock.calls[0][1]).toMatchObject({ language: "ar", patientCpr: "900101234" });
    expect(res).toMatchObject({ ok: true, bookingId: "b1", whatsappConfirmation: true });
    await call("reschedule_appointment", { booking_id: "b1", patient_cpr: "900101234", new_starts_at: "2026-10-24T14:00:00.000Z", language: "en" });
    expect(move.mock.calls[0][1]).toMatchObject({ language: "en" });
  });

  it("leaves out a language it does not support, so the clinic's main language is used", async () => {
    await call("book_appointment", { ...booking, language: "fr" });
    await call("book_appointment", booking);
    expect((book.mock.calls[0][1] as { language?: string }).language).toBeUndefined();
    expect((book.mock.calls[1][1] as { language?: string }).language).toBeUndefined();
  });

  it("notes in the tool log that a confirmation was queued, without the patient's number or CPR", async () => {
    await call("book_appointment", booking);
    const detail = String((logged.mock.calls[0][0] as { detail: string }).detail);
    expect(detail).toContain("WhatsApp confirmation queued");
    expect(detail).not.toContain("900101234");
    expect(detail).not.toContain("3912");
  });

  it("does not claim a confirmation when none is on its way", async () => {
    const res = await call("reschedule_appointment", { booking_id: "b1", patient_cpr: "900101234", new_starts_at: "2026-10-24T14:00:00.000Z" });
    expect(res).toMatchObject({ ok: true, moved: true, whatsappConfirmation: false });
    expect(String((logged.mock.calls[0][0] as { detail: string }).detail)).not.toContain("WhatsApp");
  });
});
