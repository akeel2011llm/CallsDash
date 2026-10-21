import { beforeEach, describe, expect, it, vi } from "vitest";

const { ensure } = vi.hoisted(() => ({ ensure: vi.fn(async (..._a: unknown[]) => undefined) }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => { void fn(); } }));
vi.mock("@/lib/data", () => ({
  getData: async () => ({
    findTenantByAgent: async () => ({ id: "t1" }), logToolCall: async () => undefined, getTenant: async () => undefined, getDoctors: async () => [],
  }),
}));
vi.mock("@/lib/booking-service", () => ({ sharedCalendar: () => null }));
vi.mock("@/lib/app-url", () => ({ appUrl: async () => "https://app.example" }));
vi.mock("@/lib/agent-sync", () => ({ ensureSharedTools: (...a: unknown[]) => ensure(...a) }));
vi.mock("@/lib/elevenlabs-api", () => ({ elevenLabsFromEnv: () => (process.env.ELEVENLABS_API_KEY ? {} : null) }));
vi.mock("@/lib/whatsapp", () => ({ sendBookingConfirmation: vi.fn() }));

async function call(tool: string, body: object) {
  const { POST } = await import("@/app/api/agent-tools/[tool]/route");
  const res = await POST(new Request("http://x", { method: "POST", headers: { authorization: "Bearer sec" }, body: JSON.stringify({ agent_id: "agent_1", ...body }) }), { params: Promise.resolve({ tool }) });
  return res.json() as Promise<Record<string, unknown>>;
}

beforeEach(() => {
  vi.resetModules(); // the route remembers when it last checked the tools
  ensure.mockClear();
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
