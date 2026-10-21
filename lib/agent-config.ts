import { variablePlaceholders } from "./agent-context";
import { resolveVoiceId } from "./voices";
import type { AgentSettings, KnowledgeItem, Tenant } from "./types";

const REPLY_LENGTH = {
  short: "Keep every reply to one or two short sentences.",
  normal: "Keep replies brief: usually two or three sentences.",
  detailed: "Give complete answers, but stay clear and well organised.",
} as const;
const FORMALITY = {
  casual: "Be friendly and relaxed.",
  polite: "Be polite and warm.",
  formal: "Be formal and respectful.",
} as const;
const ARABIC_STYLE = {
  gulf: "When you speak or write Arabic, use natural Gulf (Bahraini) dialect.",
  msa: "When you speak or write Arabic, use clear Modern Standard Arabic.",
} as const;

const TOOL_RULES = [
  "Always call check_availability before offering times. Never invent slots.",
  "Confirm doctor, time, patient name and phone number back to the patient before calling book_appointment.",
  "If a tool returns ok:false, follow its message. Never promise a booking that a tool did not confirm.",
  "Use take_message when the patient wants staff to call back. Use handoff_to_staff when a person must take over; there is no live transfer, so say that staff will call back.",
  "For a medical emergency tell the caller to call 999 immediately and also call handoff_to_staff with urgent set to true.",
];

/** The agent's instructions: the client's own sections, the style settings, live context and the tool rules. */
export function buildPrompt(settings: AgentSettings): string {
  const p = settings.prompt;
  return [
    `# Role\n${p.identity}`,
    `# Languages\n${p.languages}\n${ARABIC_STYLE[settings.arabicWrittenStyle]}`,
    `# You may\n${p.mayDo}`,
    `# You must never\n${p.neverDo}`,
    `# Emergencies\n${p.emergencies}`,
    `# Handing over\n${p.handoff}`,
    `# Style\n${REPLY_LENGTH[settings.replyLength]} ${FORMALITY[settings.formality]} Answer only from the knowledge base and the facts below; if you do not know, say so and offer to take a message.`,
    `# Facts for this conversation\nToday is {{today}}. The clinic is open now: {{open_now}}. Opening hours today: {{hours_today}}. If closed, it next opens {{next_opening}}. Channel: {{channel}}. The caller's phone number, if known: {{caller_phone}} (ask them to confirm it before booking).`,
    `# Tools\n${TOOL_RULES.map((r) => `- ${r}`).join("\n")}`,
  ].join("\n\n");
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

export function greeting(tenant: Pick<Tenant, "name" | "branding">, lang: "en" | "ar", style: "gulf" | "msa"): string {
  if (lang === "en") return `Hello, you are speaking with the AI assistant of ${tenant.branding.displayName || tenant.name}. This conversation is recorded to help us serve you. How can I help?`;
  const name = tenant.branding.displayNameAr || tenant.name;
  return style === "gulf"
    ? `هلا والله، معك المساعد الذكي لـ ${name}. المحادثة مسجلة لتحسين خدمتك. شلون أقدر أساعدك؟`
    : `مرحباً بك، معك المساعد الذكي لـ ${name}. تُسجَّل هذه المحادثة لتحسين خدمتك. كيف يمكنني مساعدتك؟`;
}

/** The knowledge base as one text document, question and answer pairs, for ElevenLabs to index. */
export function knowledgeText(items: Pick<KnowledgeItem, "question" | "answer">[]): string {
  return items.map((k) => `Q: ${clean(k.question)}\nA: ${clean(k.answer)}`).join("\n\n");
}

export interface AgentConfigInput {
  tenant: Tenant;
  settings: AgentSettings;
  toolIds: string[];
  knowledgeDoc?: { id: string; name: string };
  appUrl: string;
  /** Sent by ElevenLabs to the conversation-start webhook as a bearer token. */
  initSecret?: string;
  llm?: string;
}

/** Hostnames the website widget may run on. */
export const widgetHostnames = (t: Pick<Tenant, "allowedDomains">) => [...new Set(t.allowedDomains.map((d) => d.trim().toLowerCase()).filter(Boolean))];

/** The body for creating or updating the client's agent in ElevenLabs. Updating sends the same body, so the agent always matches CallsDash. */
export function buildAgentConfig(i: AgentConfigInput) {
  const { tenant, settings } = i;
  const style = settings.arabicWrittenStyle;
  return {
    name: `CallsDash: ${tenant.name}`.slice(0, 120),
    tags: ["callsdash", tenant.slug],
    conversation_config: {
      agent: {
        first_message: greeting(tenant, "en", style),
        language: "en",
        dynamic_variables: { dynamic_variable_placeholders: variablePlaceholders() },
        prompt: {
          prompt: buildPrompt(settings),
          llm: i.llm ?? process.env.ELEVENLABS_LLM ?? "gemini-2.5-flash",
          temperature: settings.temperature,
          tool_ids: i.toolIds,
          built_in_tools: { language_detection: { name: "language_detection", description: "", params: { system_tool_type: "language_detection" } } },
          knowledge_base: i.knowledgeDoc ? [{ type: "text", name: i.knowledgeDoc.name, id: i.knowledgeDoc.id, usage_mode: "auto" }] : [],
        },
      },
      language_presets: {
        ar: {
          overrides: {
            agent: { first_message: greeting(tenant, "ar", style), language: "ar" },
            tts: { voice_id: resolveVoiceId(settings.voiceAr, "ar") },
          },
        },
      },
      tts: { voice_id: resolveVoiceId(settings.voiceEn, "en"), model_id: "eleven_flash_v2_5" },
      conversation: { max_duration_seconds: 900 },
    },
    platform_settings: {
      auth: { enable_auth: false, allowlist: widgetHostnames(tenant).map((hostname) => ({ hostname })) },
      overrides: {
        enable_conversation_initiation_client_data_from_webhook: true,
        conversation_config_override: {
          agent: { first_message: true, language: true, prompt: { prompt: true } },
          tts: { voice_id: true },
          conversation: { text_only: true },
        },
      },
      workspace_overrides: {
        conversation_initiation_client_data_webhook: {
          url: `${i.appUrl}/api/webhooks/elevenlabs/init`,
          request_headers: i.initSecret ? { Authorization: `Bearer ${i.initSecret}` } : {},
        },
      },
      // lib/elevenlabs.ts reads this to record how each conversation ended
      data_collection: {
        outcome: {
          type: "string", enum: ["booked", "answered", "handed_off", "abandoned"],
          description: "How the conversation ended: booked (an appointment was booked or changed), answered (questions answered), handed_off (staff will follow up or a message was taken), abandoned (the person left without a request).",
        },
      },
    },
  };
}

// ElevenLabs accepts only one of description, dynamic_variable, constant_value, is_system_provided or is_omitted per property.
type Prop = { type: "string" | "boolean" | "integer"; description?: string; dynamic_variable?: string };
const str = (description: string): Prop => ({ type: "string", description });
const agentId: Prop = { type: "string", dynamic_variable: "system__agent_id" };
const conversationId: Prop = { type: "string", dynamic_variable: "system__conversation_id" };

/** The seven booking and hand-over tools (docs/agent-tools.md), as ElevenLabs webhook tool configs. One shared set serves every client; `agent_id` tells them apart. */
export function toolDefinitions(appUrl: string, secret: string): Record<string, Record<string, unknown>> {
  const tool = (name: string, description: string, properties: Record<string, Prop>, required: string[]) => ({
    type: "webhook", name, description,
    api_schema: {
      url: `${appUrl}/api/agent-tools/${name}`, method: "POST",
      request_headers: { Authorization: `Bearer ${secret}` },
      request_body_schema: { type: "object", required: ["agent_id", ...required], properties: { agent_id: agentId, ...properties } },
    },
  });
  return {
    check_availability: tool("check_availability", "List free appointment slots. Call before offering any time.", {
      doctor_id: str("Doctor id, if the patient asked for a specific doctor."), from_date: str("First day to look at, YYYY-MM-DD."),
      days: { type: "integer", description: "How many days to look at, 1 to 30." }, language: str("en or ar, the language the slot labels should be in."),
    }, []),
    book_appointment: tool("book_appointment", "Book an appointment in a slot returned by check_availability.", {
      doctor_id: str("Doctor id from the slot."), starts_at: str("Slot start (ISO) exactly as returned by check_availability."),
      patient_name: str("Patient's full name."), patient_phone: str("Patient's phone number."), service: str("Reason for the visit."), conversation_id: conversationId,
    }, ["doctor_id", "starts_at", "patient_name", "patient_phone"]),
    find_patient_booking: tool("find_patient_booking", "Find a patient's upcoming bookings by phone number.", { patient_phone: str("Patient's phone number.") }, ["patient_phone"]),
    cancel_appointment: tool("cancel_appointment", "Cancel a booking.", { booking_id: str("Booking id."), patient_phone: str("Patient's phone number, as proof of identity.") }, ["booking_id", "patient_phone"]),
    reschedule_appointment: tool("reschedule_appointment", "Move a booking to a new slot returned by check_availability.", {
      booking_id: str("Booking id."), patient_phone: str("Patient's phone number."), new_starts_at: str("New slot start (ISO)."),
    }, ["booking_id", "patient_phone", "new_starts_at"]),
    take_message: tool("take_message", "Take a message for the clinic staff to answer later.", {
      patient_name: str("Caller's name."), patient_phone: str("Caller's phone number."), message: str("What the caller wants."), language: str("en or ar."), conversation_id: conversationId,
    }, ["patient_name", "patient_phone", "message"]),
    handoff_to_staff: tool("handoff_to_staff", "Ask staff to take over. There is no live transfer: staff call the patient back.", {
      patient_name: str("Caller's name."), patient_phone: str("Caller's phone number."), reason: str("Why a person is needed."),
      urgent: { type: "boolean", description: "True when it cannot wait, for example a medical emergency." }, language: str("en or ar."), conversation_id: conversationId,
    }, ["reason"]),
  };
}
