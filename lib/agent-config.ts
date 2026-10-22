import { variablePlaceholders } from "./agent-context";
import { acceptsTemperature, defaultLlm } from "./agent-catalog";
import { STUDIO_DEFAULTS, studioOf } from "./agent-studio";
import { resolveVoiceId } from "./voices";
import type { AgentSettings, Doctor, KnowledgeItem, Tenant } from "./types";

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

/**
 * Raise when the prompt rules or the tools change in a way a clinic's agent must pick up. The client screens ask for a
 * Sync while the agent's last sync was at an older version. 2: CPR numbers for booking, finding, moving and cancelling.
 */
export const AGENT_VERSION = 2;

const TOOL_RULES = [
  "Always call check_availability before offering times. Never invent slots. Leave from_date empty to start from today.",
  "To book, ask for the patient's full name, phone number and CPR number (the 9-digit personal number on the Bahraini ID card). Read the CPR number back digit by digit, then confirm doctor, time, name, phone and CPR with the patient before calling book_appointment.",
  "Call book_appointment with the doctor_id and starts_at exactly as check_availability returned them; never rewrite the time yourself.",
  "Only say an appointment is booked after book_appointment returns ok:true, then read back its label.",
  "When someone asks about their booking, or wants to move or cancel it, first ask for their CPR number and call find_patient_booking with it. Only talk about the bookings it returns. Use their booking_id and the same CPR number for cancel_appointment or reschedule_appointment, and confirm the change with the patient before calling the tool.",
  "To move a booking, call check_availability first with the doctor_id that find_patient_booking returned for the booking (or another doctor's doctor_id if the patient wants a different doctor), then call reschedule_appointment with the chosen starts_at as new_starts_at, and doctor_id only when the doctor changes.",
  "If find_patient_booking finds nothing but the patient says they have a booking, ask for the phone number it was made with and call find_patient_booking again with both patient_cpr and patient_phone; give the same patient_phone to cancel_appointment or reschedule_appointment for that booking.",
  "Never say a CPR number aloud except to read back the one the patient just gave. If the patient has no CPR number (for example a visitor), use take_message so the team can book for them.",
  "If a tool returns ok:false, follow its message. Never promise a booking that a tool did not confirm.",
  "Use take_message when the patient wants staff to call back. Use handoff_to_staff when a person must take over; there is no live transfer, so say that staff will call back.",
  "For a medical emergency tell the caller to call 999 immediately and also call handoff_to_staff with urgent set to true.",
];

type DoctorLine = Pick<Doctor, "id" | "name" | "specialty" | "active">;

/** The doctors who take bookings, with the id the tools expect, so the agent can name them and pass the right id. */
function doctorSection(doctors: DoctorLine[]) {
  const active = doctors.filter((d) => d.active !== false);
  if (!active.length) return "";
  return `# Doctors\n${active.map((d) => `- ${d.name}${d.specialty ? `, ${d.specialty}` : ""} (doctor_id: ${d.id})`).join("\n")}`;
}

/** The agent's instructions: the client's own sections, the style settings, live context, the doctors and the tool rules. */
export function buildPrompt(settings: AgentSettings, doctors: DoctorLine[] = []): string {
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
    doctorSection(doctors),
    `# Tools\n${TOOL_RULES.map((r) => `- ${r}`).join("\n")}`,
  ].filter(Boolean).join("\n\n");
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * The first thing the assistant says. An admin may write their own in the Assistant studio; `{name}` stands for the clinic's
 * display name in that language. Left blank, the built-in greeting (with the recording notice) is used.
 */
export function greeting(tenant: Pick<Tenant, "name" | "branding">, lang: "en" | "ar", style: "gulf" | "msa", custom = ""): string {
  if (custom.trim()) return custom.replaceAll("{name}", lang === "en" ? tenant.branding.displayName || tenant.name : tenant.branding.displayNameAr || tenant.name);
  if (lang === "en") return `Hello, you are speaking with the AI assistant of ${tenant.branding.displayName || tenant.name}. This conversation is recorded to help us serve you. How can I help?`;
  const name = tenant.branding.displayNameAr || tenant.name;
  return style === "gulf"
    ? `هلا والله، معك المساعد الذكي لـ ${name}. المحادثة مسجلة لتحسين خدمتك. شلون أقدر أساعدك؟`
    : `مرحباً بك، معك المساعد الذكي لـ ${name}. تُسجَّل هذه المحادثة لتحسين خدمتك. كيف يمكنني مساعدتك؟`;
}

/** A sentence an admin can add to a greeting of their own, per language. */
export const RECORDING_NOTICE = { en: "This conversation is recorded to help us serve you.", ar: "تُسجَّل هذه المحادثة لتحسين خدمتك." } as const;

/** True when a greeting tells the caller the conversation is recorded, in English or in Arabic (vowel marks do not matter). */
export function mentionsRecording(text: string): boolean {
  const plain = text.replace(/[\u064B-\u0652\u0670\u0640]/g, "");
  return /record/i.test(plain) || /سج[يل]/.test(plain);
}

/** The knowledge base as one text document, question and answer pairs, for ElevenLabs to index. */
export function knowledgeText(items: Pick<KnowledgeItem, "question" | "answer">[]): string {
  return items.map((k) => `Q: ${clean(k.question)}\nA: ${clean(k.answer)}`).join("\n\n");
}

export interface AgentConfigInput {
  tenant: Tenant;
  settings: AgentSettings;
  doctors?: DoctorLine[];
  toolIds: string[];
  knowledgeDoc?: { id: string; name: string };
  appUrl: string;
  /** Sent by ElevenLabs to the conversation-start webhook as a bearer token. */
  initSecret?: string;
  llm?: string;
}

/** Hostnames the website widget may run on: the client's websites, plus this app so the admin Test page and the client's preview work. */
export function widgetHostnames(t: Pick<Tenant, "allowedDomains">, appUrl?: string) {
  let own = "";
  try { own = appUrl ? new URL(appUrl).hostname.toLowerCase() : ""; } catch { /* not a URL: leave it out */ }
  return [...new Set([...t.allowedDomains, own].map((d) => d.trim().toLowerCase()).filter(Boolean))];
}

// ElevenLabs requires the English-only v2 model for an agent whose main language is English; Arabic needs the multilingual v2.5 model, set on the Arabic preset.
export const ENGLISH_TTS_MODEL = STUDIO_DEFAULTS.ttsModelEn; // "eleven_flash_v2"
export const ARABIC_TTS_MODEL = STUDIO_DEFAULTS.ttsModelAr; // "eleven_flash_v2_5"

export const OUTCOME_ITEM = {
  type: "string", enum: ["booked", "answered", "handed_off", "abandoned"],
  description: "How the conversation ended: booked (an appointment was booked or changed), answered (questions answered), handed_off (staff will follow up or a message was taken), abandoned (the person left without a request).",
};

/** The body for creating or updating the client's agent in ElevenLabs. Updating sends the same body, so a sync brings the agent back in line with CallsDash. */
export function buildAgentConfig(i: AgentConfigInput) {
  const { tenant, settings } = i;
  const style = settings.arabicWrittenStyle;
  const studio = studioOf(settings);
  const llm = i.llm ?? (studio.llm || defaultLlm());
  return {
    name: `CallsDash: ${tenant.name}`.slice(0, 120),
    tags: ["callsdash", tenant.slug],
    conversation_config: {
      agent: {
        first_message: greeting(tenant, "en", style, studio.greetingEn),
        language: "en",
        dynamic_variables: { dynamic_variable_placeholders: variablePlaceholders() },
        prompt: {
          prompt: buildPrompt(settings, i.doctors),
          llm,
          temperature: acceptsTemperature(llm) ? settings.temperature : null, // the newest Claude models reject a custom temperature: null leaves it out
          tool_ids: i.toolIds,
          built_in_tools: { language_detection: { name: "language_detection", description: "", params: { system_tool_type: "language_detection" } } },
          knowledge_base: i.knowledgeDoc ? [{ type: "text", name: i.knowledgeDoc.name, id: i.knowledgeDoc.id, usage_mode: "auto" }] : [],
        },
      },
      language_presets: {
        ar: {
          overrides: {
            agent: { first_message: greeting(tenant, "ar", style, studio.greetingAr), language: "ar" },
            tts: { voice_id: resolveVoiceId(settings.voiceAr, "ar"), model_id: studio.ttsModelAr },
          },
        },
      },
      tts: { voice_id: resolveVoiceId(settings.voiceEn, "en"), model_id: studio.ttsModelEn },
      conversation: { max_duration_seconds: studio.maxDurationSeconds },
    },
    platform_settings: {
      auth: { enable_auth: false, allowlist: widgetHostnames(tenant, i.appUrl).map((hostname) => ({ hostname })) },
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
      data_collection: { outcome: OUTCOME_ITEM },
    },
  };
}

// ElevenLabs accepts only one of description, dynamic_variable, constant_value, is_system_provided or is_omitted per property.
type Prop = { type: "string" | "boolean" | "integer"; description?: string; dynamic_variable?: string };
const str = (description: string): Prop => ({ type: "string", description });
const agentId: Prop = { type: "string", dynamic_variable: "system__agent_id" };
const conversationId: Prop = { type: "string", dynamic_variable: "system__conversation_id" };
const CPR_HELP = "Patient's CPR number: the 9 digits on the Bahraini ID card, digits only.";

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
      doctor_id: str("Doctor id, if the patient asked for a specific doctor, or to move a booking with the doctor it is with."), from_date: str("First day to look at, YYYY-MM-DD."),
      days: { type: "integer", description: "How many days to look at, 1 to 30." }, language: str("en or ar, the language the slot labels should be in."),
    }, []),
    book_appointment: tool("book_appointment", "Book an appointment in a slot returned by check_availability.", {
      doctor_id: str("Doctor id from the slot."), starts_at: str("Slot start (ISO) exactly as returned by check_availability."),
      patient_name: str("Patient's full name."), patient_phone: str("Patient's phone number."), patient_cpr: str(CPR_HELP),
      service: str("Reason for the visit."), conversation_id: conversationId,
    }, ["doctor_id", "starts_at", "patient_name", "patient_phone", "patient_cpr"]),
    find_patient_booking: tool("find_patient_booking", "Find a patient's upcoming bookings by their CPR number.", {
      patient_cpr: str(CPR_HELP), patient_phone: str("Only for a booking made before CPR numbers were asked: the phone number it was made with."),
      language: str("en or ar, the language the time labels should be in."),
    }, ["patient_cpr"]),
    cancel_appointment: tool("cancel_appointment", "Cancel a booking found with find_patient_booking.", {
      booking_id: str("booking_id from find_patient_booking."), patient_cpr: str(CPR_HELP), patient_phone: str("Only if find_patient_booking needed the phone number too."),
    }, ["booking_id", "patient_cpr"]),
    reschedule_appointment: tool("reschedule_appointment", "Move a booking found with find_patient_booking to a new slot returned by check_availability, with the same or another doctor.", {
      booking_id: str("booking_id from find_patient_booking."), patient_cpr: str(CPR_HELP), new_starts_at: str("New slot start (ISO), the starts_at of the chosen slot."),
      doctor_id: str("Only when the patient wants another doctor: the doctor_id of the chosen slot."), patient_phone: str("Only if find_patient_booking needed the phone number too."),
    }, ["booking_id", "patient_cpr", "new_starts_at"]),
    take_message: tool("take_message", "Take a message for the clinic staff to answer later.", {
      patient_name: str("Caller's name."), patient_phone: str("Caller's phone number."), message: str("What the caller wants."), language: str("en or ar."), conversation_id: conversationId,
    }, ["patient_name", "patient_phone", "message"]),
    handoff_to_staff: tool("handoff_to_staff", "Ask staff to take over. There is no live transfer: staff call the patient back.", {
      patient_name: str("Caller's name."), patient_phone: str("Caller's phone number."), reason: str("Why a person is needed."),
      urgent: { type: "boolean", description: "True when it cannot wait, for example a medical emergency." }, language: str("en or ar."), conversation_id: conversationId,
    }, ["reason"]),
  };
}
