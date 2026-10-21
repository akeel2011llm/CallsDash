import { describe, expect, it } from "vitest";
import { agentVariables, initiationResponse } from "@/lib/agent-context";
import { buildAgentConfig, buildPrompt, greeting, knowledgeText, toolDefinitions } from "@/lib/agent-config";
import { resolveVoiceId } from "@/lib/voices";
import { agent } from "@/lib/seed";
import { DEFAULT_OPENING_HOURS } from "@/lib/availability";
import { DEFAULT_RULES } from "@/lib/flags";
import type { Tenant } from "@/lib/types";

const tenant = (o: Partial<Tenant> = {}): Tenant => ({
  id: "t", slug: "al-noor", name: "Al Noor Medical Center", status: "live",
  branding: { displayName: "Al Noor", displayNameAr: "مركز النور", primaryColor: "#000000" },
  plans: [], alertRules: structuredClone(DEFAULT_RULES), permissions: { editPrompt: true, editVoice: true, editBehaviour: true, editKnowledge: true },
  allowedDomains: ["Alnoor.example.bh", " alnoor.example.bh ", ""], zeroBalancePolicy: "pause", lowBalanceThreshold: 0.15, retentionDays: 90, calendarConnected: false,
  openingHours: DEFAULT_OPENING_HOURS, channels: { website: "pending", whatsapp: "off", instagram: "off", phone: "off" }, onboarding: { done: [] }, integrations: {}, createdAt: "2026-01-01T00:00:00Z", ...o,
});

describe("agent variables", () => {
  // Tuesday 20 Oct 2026, 10:00 Bahrain time
  const open = new Date("2026-10-20T07:00:00Z");
  it("says what day it is and whether the clinic is open, in Bahrain time", () => {
    const v = agentVariables(tenant(), open, { channel: "phone", callerPhone: "97336001122" });
    expect(v.today).toContain("Tuesday 20 October 2026");
    expect(v).toMatchObject({ open_now: "yes", hours_today: "08:00-21:00", channel: "phone", caller_phone: "+97336001122", next_opening: "" });
  });
  it("gives the next opening when closed", () => {
    const v = agentVariables(tenant(), new Date("2026-10-20T19:30:00Z"), { channel: "whatsapp" }); // 22:30 local
    expect(v.open_now).toBe("no");
    expect(v.next_opening).not.toBe("");
    expect(v.caller_phone).toBe("");
  });
  it("uses the local day, not the UTC day, just after midnight", () => {
    expect(agentVariables(tenant(), new Date("2026-10-20T21:30:00Z"), { channel: "x" }).today).toContain("Wednesday 21 October");
  });
});

describe("conversation start webhook answer", () => {
  it("fills the variables and marks phone calls", () => {
    const r = initiationResponse({ tenant: tenant(), balance: 10, body: { caller_id: "+97336001122", call_sid: "CA1" }, now: new Date("2026-10-20T07:00:00Z") });
    expect(r.type).toBe("conversation_initiation_client_data");
    expect(r.dynamic_variables.channel).toBe("phone");
    expect("conversation_config_override" in r).toBe(false);
  });
  it("pauses the agent when there are no credits (and the client is set to pause)", () => {
    const r = initiationResponse({ tenant: tenant(), balance: 0, body: {} });
    expect(JSON.stringify(r)).toContain("not available");
    expect(initiationResponse({ tenant: tenant({ zeroBalancePolicy: "overdraft" }), balance: 0, body: {} })).not.toHaveProperty("conversation_config_override");
    expect(initiationResponse({ tenant: tenant({ status: "suspended" }), balance: 99, body: {} })).toHaveProperty("conversation_config_override");
  });
});

describe("agent config", () => {
  const settings = agent("", "Al Noor Medical Center", { arabicWrittenStyle: "msa", replyLength: "short", formality: "formal", temperature: 0.4 });
  it("puts the client's settings into the prompt", () => {
    const p = buildPrompt(settings);
    expect(p).toContain("virtual receptionist of Al Noor Medical Center");
    expect(p).toContain("one or two short sentences");
    expect(p).toContain("formal and respectful");
    expect(p).toContain("Modern Standard Arabic");
    expect(p).toContain("{{today}}");
    expect(p).toContain("check_availability");
  });
  it("greets in each language, in the chosen Arabic style, and tells people the call is recorded", () => {
    const t = tenant();
    expect(greeting(t, "en", "gulf")).toContain("recorded");
    expect(greeting(t, "ar", "gulf")).toContain("مركز النور");
    expect(greeting(t, "ar", "gulf")).not.toBe(greeting(t, "ar", "msa"));
  });
  it("builds the body ElevenLabs needs", () => {
    const c = buildAgentConfig({ tenant: tenant(), settings, toolIds: ["tool_1", "tool_2"], knowledgeDoc: { id: "kb1", name: "Knowledge" }, appUrl: "https://www.callsdash.com", initSecret: "s3" });
    expect(c.name).toBe("CallsDash: Al Noor Medical Center");
    // ElevenLabs: English agents need the v2 model; the Arabic preset carries the multilingual v2.5 one
    expect(c.conversation_config.tts.model_id).toBe("eleven_flash_v2");
    expect(c.conversation_config.language_presets.ar.overrides.tts.model_id).toBe("eleven_flash_v2_5");
    expect(c.conversation_config.agent.prompt.tool_ids).toEqual(["tool_1", "tool_2"]);
    expect(c.conversation_config.agent.prompt.temperature).toBe(0.4);
    expect(c.conversation_config.agent.prompt.knowledge_base).toEqual([{ type: "text", name: "Knowledge", id: "kb1", usage_mode: "auto" }]);
    expect(c.conversation_config.language_presets.ar.overrides.agent.language).toBe("ar");
    expect(c.platform_settings.auth.allowlist).toEqual([{ hostname: "alnoor.example.bh" }]);
    expect(c.platform_settings.workspace_overrides.conversation_initiation_client_data_webhook).toEqual({
      url: "https://www.callsdash.com/api/webhooks/elevenlabs/init", request_headers: { Authorization: "Bearer s3" },
    });
    expect(c.platform_settings.data_collection.outcome.enum).toContain("handed_off");
    expect(Object.keys(c.conversation_config.agent.dynamic_variables.dynamic_variable_placeholders)).toEqual(["today", "open_now", "hours_today", "next_opening", "caller_phone", "channel"]);
  });
  it("sends no knowledge base when there is none", () => {
    expect(buildAgentConfig({ tenant: tenant(), settings, toolIds: [], appUrl: "https://x" }).conversation_config.agent.prompt.knowledge_base).toEqual([]);
  });
  it("turns knowledge items into one text document", () => {
    expect(knowledgeText([{ question: " Hours?\n", answer: "8  to 9" }, { question: "Parking?", answer: "Yes" }])).toBe("Q: Hours?\nA: 8 to 9\n\nQ: Parking?\nA: Yes");
  });
  it("defines all seven tools with the secret and the agent id variable", () => {
    const d = toolDefinitions("https://app.example", "sec");
    expect(Object.keys(d).sort()).toEqual(["book_appointment", "cancel_appointment", "check_availability", "find_patient_booking", "handoff_to_staff", "reschedule_appointment", "take_message"]);
    const t = d.book_appointment as { api_schema: { url: string; request_headers: Record<string, string>; request_body_schema: { required: string[]; properties: Record<string, { dynamic_variable?: string }> } } };
    expect(t.api_schema.url).toBe("https://app.example/api/agent-tools/book_appointment");
    expect(t.api_schema.request_headers.Authorization).toBe("Bearer sec");
    expect(t.api_schema.request_body_schema.properties.agent_id.dynamic_variable).toBe("system__agent_id");
    expect(t.api_schema.request_body_schema.required).toContain("patient_phone");
  });
});

describe("voices", () => {
  it("maps our labels to ElevenLabs ids, with overrides", () => {
    expect(resolveVoiceId("voice_en_f", "en", undefined)).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(resolveVoiceId("voice_ar_f", "ar", '{"voice_ar_f":"abc123"}')).toBe("abc123");
    expect(resolveVoiceId("RealElevenLabsId", "en", undefined)).toBe("RealElevenLabsId");
    expect(resolveVoiceId("voice_en_m", "en", "not json")).toMatch(/^[A-Za-z0-9]{20}$/);
  });
  it("sets only one of description or dynamic_variable on each tool property (ElevenLabs returns 422 otherwise)", () => {
    for (const [name, def] of Object.entries(toolDefinitions("https://app.example", "sec"))) {
      const props = (def as { api_schema: { request_body_schema: { properties: Record<string, Record<string, unknown>> } } }).api_schema.request_body_schema.properties;
      for (const [prop, cfg] of Object.entries(props)) {
        const exclusive = ["description", "dynamic_variable", "constant_value", "is_system_provided", "is_omitted"].filter((k) => cfg[k] !== undefined);
        expect(exclusive.length, `${name}.${prop}`).toBeLessThanOrEqual(1);
      }
    }
  });
});
