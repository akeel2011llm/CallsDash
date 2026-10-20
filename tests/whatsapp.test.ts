import { describe, expect, it } from "vitest";
import { confirmationParams, sendBookingConfirmation, whatsappUserId } from "@/lib/whatsapp";
import type { ElevenLabsApi } from "@/lib/elevenlabs-api";
import { DEFAULT_RULES } from "@/lib/flags";
import { agent } from "@/lib/seed";
import { DEFAULT_OPENING_HOURS } from "@/lib/availability";
import type { Tenant } from "@/lib/types";

describe("whatsappUserId", () => {
  it("keeps digits with the country code", () => {
    expect(whatsappUserId("+973 3600 1122")).toBe("97336001122");
    expect(whatsappUserId("0097336001122")).toBe("97336001122");
    expect(whatsappUserId("36001122")).toBe("97336001122");
    expect(whatsappUserId("+44 7700 900123")).toBe("447700900123");
  });
  it("rejects things that are not phone numbers", () => {
    for (const p of ["", "abc", "123", "+1234567890123456789"]) expect(whatsappUserId(p), p).toBe("");
  });
});

const tenant = (o: Partial<Tenant> = {}): Tenant => ({
  id: "t", slug: "s", name: "Al Noor Medical Center", status: "live",
  branding: { displayName: "Al Noor", displayNameAr: "النور", primaryColor: "#000000" },
  plans: [], alertRules: structuredClone(DEFAULT_RULES), permissions: { editPrompt: true, editVoice: true, editBehaviour: true, editKnowledge: true },
  allowedDomains: [], zeroBalancePolicy: "pause", lowBalanceThreshold: 0.15, retentionDays: 90, calendarConnected: false, openingHours: DEFAULT_OPENING_HOURS,
  channels: { website: "connected", whatsapp: "connected", instagram: "off", phone: "off" }, onboarding: { done: [] },
  integrations: { whatsapp: { phoneNumberId: "524", confirmTemplate: "booking_confirmation", confirmTemplateLang: "en" } }, createdAt: "2026-01-01T00:00:00Z", ...o,
});
const booking = { patientName: "Sara", patientPhone: "+973 3600 1122", doctorName: "Dr. Ali", startsAt: "2026-10-21T07:30:00.000Z" };
const run = (t: Tenant, agentId = "agent_1", api?: Partial<ElevenLabsApi>) => {
  const sent: unknown[] = [];
  const full = { sendWhatsappTemplate: async (i: unknown) => { sent.push(i); return { conversation_id: "c1" }; }, ...api } as ElevenLabsApi;
  return { sent, result: sendBookingConfirmation({ api: full, data: { getTenant: async () => t, getAgent: async () => agent(agentId, "x") } }, "t", booking) };
};

describe("booking confirmation", () => {
  it("sends the template with the booking details", async () => {
    const { sent, result } = run(tenant());
    expect(await result).toEqual({ status: "sent", conversationId: "c1" });
    expect(sent[0]).toMatchObject({ phoneNumberId: "524", userId: "97336001122", templateName: "booking_confirmation", languageCode: "en", agentId: "agent_1" });
    const params = (sent[0] as { params: ReturnType<typeof confirmationParams> }).params[0].parameters;
    expect(params.map((p) => p.parameter_name)).toEqual(["name", "clinic", "doctor", "time"]);
    expect(params.find((p) => p.parameter_name === "time")!.text).toContain("21 October");
  });
  it("uses Arabic wording when the template is Arabic", async () => {
    const { sent, result } = run(tenant({ integrations: { whatsapp: { phoneNumberId: "524", confirmTemplate: "booking_confirmation_ar", confirmTemplateLang: "ar" } } }));
    await result;
    expect((sent[0] as { params: ReturnType<typeof confirmationParams> }).params[0].parameters.find((p) => p.parameter_name === "clinic")!.text).toBe("النور");
  });
  it("skips quietly when the channel is off, unset, the phone is bad or there is no agent", async () => {
    expect(await run(tenant({ channels: { website: "connected", whatsapp: "pending", instagram: "off", phone: "off" } })).result).toEqual({ status: "skipped", reason: "channel_off" });
    expect(await run(tenant({ integrations: {} })).result).toEqual({ status: "skipped", reason: "not_configured" });
    expect(await run(tenant(), "").result).toEqual({ status: "skipped", reason: "no_agent" });
    const bad = sendBookingConfirmation({ api: {} as ElevenLabsApi, data: { getTenant: async () => tenant(), getAgent: async () => agent("a", "x") } }, "t", { ...booking, patientPhone: "n/a" });
    expect(await bad).toEqual({ status: "skipped", reason: "bad_phone" });
  });
  it("never throws when WhatsApp refuses", async () => {
    const r = await run(tenant(), "agent_1", { sendWhatsappTemplate: async () => { throw new Error("template not approved"); } }).result;
    expect(r).toEqual({ status: "failed", error: "template not approved" });
  });
});
