import { OUTCOME_ITEM } from "./agent-config";
import type { Tenant } from "./types";

type Json = Record<string, unknown>;

/**
 * Settings on top of the agent that are not needed for it to answer: safety, analysis, privacy and widget look.
 * They are sent separately from the core agent so that if ElevenLabs refuses one, the agent still works and the
 * admin sees which group was refused and why (lib/agent-sync.ts).
 */
export type ExtraGroup = { name: ExtraGroupName; body: Json };
export const EXTRA_GROUPS = ["tools", "hardening", "keywords", "guardrails", "analysis", "privacy", "limits", "widget"] as const;
export type ExtraGroupName = (typeof EXTRA_GROUPS)[number];

const system = (name: string, extra: Json = {}) => ({ type: "system", name, description: "", params: { system_tool_type: name, ...extra } });

/** Judged by ElevenLabs after each conversation; results show in its dashboard and in the post-call webhook. */
export const EVALUATION_CRITERIA = [
  { id: "need_resolved", name: "Need resolved", conversation_goal_prompt: "The caller's request was resolved, or the agent correctly passed it to clinic staff by taking a message or requesting a callback. It fails if the caller left without an answer or the agent promised something no tool confirmed." },
  { id: "no_medical_advice", name: "No medical advice", conversation_goal_prompt: "The agent did not diagnose, recommend treatment, or advise on medication or dosage. Medical questions were directed to a doctor, and a medical emergency was told to call 999 immediately." },
  { id: "details_confirmed", name: "Booking details confirmed", conversation_goal_prompt: "If an appointment was booked, changed or cancelled, the agent repeated the doctor, date, time and patient name back to the caller before finishing. Pass if no appointment was involved." },
  { id: "caller_language", name: "Caller's language", conversation_goal_prompt: "The agent answered in the language the caller used (English or Arabic) and switched when the caller switched." },
];

/** Read by lib/elevenlabs.ts to flag conversations and to fill the dashboard. */
export const DATA_COLLECTION = {
  outcome: OUTCOME_ITEM,
  intent: {
    type: "string", enum: ["booking", "question", "complaint", "lead", "emergency", "other"],
    description: "The main reason for the conversation: booking (make, change or cancel an appointment), question (opening hours, location, services), complaint (the caller is unhappy), lead (a new patient asking about prices, treatments or packages), emergency (urgent medical situation), other.",
  },
  urgent: { type: "boolean", description: "True if the caller described a medical emergency or symptoms that cannot wait for a normal appointment." },
  follow_up_needed: { type: "boolean", description: "True if clinic staff must contact the caller afterwards, for example a message was taken, a callback was requested or a complaint was raised." },
  caller_name: { type: "string", description: "The caller's name if they gave it, otherwise empty." },
  caller_sentiment: { type: "string", enum: ["positive", "neutral", "negative"], description: "How the caller felt at the end of the conversation." },
};

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** Black or white, whichever is easier to read on the colour. */
export const readableOn = (hex: string) => (luminance(hex) > 0.4 ? "#111111" : "#ffffff");
const isHex = (s: unknown): s is string => typeof s === "string" && /^#[0-9a-f]{6}$/i.test(s);

export interface ExtrasInput {
  tenant: Pick<Tenant, "name" | "branding" | "retentionDays" | "allowedDomains">;
  doctors: { name: string }[];
}

export function buildExtras(i: ExtrasInput): ExtraGroup[] {
  const brand = i.tenant.branding;
  const primary = isHex(brand.primaryColor) ? brand.primaryColor : "#0f766e";
  const keywords = [...new Set([i.tenant.name, brand.displayName, brand.displayNameAr, ...i.doctors.map((d) => d.name)].map((k) => (k ?? "").trim()).filter((k) => k && k.length <= 50))].slice(0, 20);
  const g = (name: ExtraGroupName, body: Json): ExtraGroup => ({ name, body });
  return [
    // End call is not added automatically to agents made through the API, so without it a call can only end when the caller hangs up.
    g("tools", { conversation_config: { agent: { prompt: { built_in_tools: { end_call: system("end_call"), skip_turn: system("skip_turn") } } } } }),
    g("hardening", {
      conversation_config: {
        agent: { disable_first_message_interruptions: true, prompt: { timezone: "Asia/Bahrain" } }, // the recording notice in the greeting must not be cut off
        turn: { silence_end_call_timeout: 30 },
      },
    }),
    g("keywords", { conversation_config: { asr: { keywords } } }), // clinic and doctor names are easy to mis-hear
    g("guardrails", { platform_settings: { guardrails: { version: "1", focus: { is_enabled: true }, prompt_injection: { is_enabled: true } } } }),
    g("analysis", { platform_settings: { evaluation: { criteria: EVALUATION_CRITERIA }, data_collection: DATA_COLLECTION } }),
    g("privacy", { platform_settings: { privacy: { record_voice: true, retention_days: Math.max(1, Math.round(i.tenant.retentionDays || 90)) } } }),
    g("limits", { platform_settings: { call_limits: { daily_limit: 500 } } }), // a public widget must not be able to run up an unlimited bill
    g("widget", {
      platform_settings: {
        widget: {
          bg_color: "#ffffff", text_color: "#111111", border_color: "#e1e1e1",
          btn_color: primary, btn_text_color: readableOn(primary), focus_color: primary,
          language_selector: true, feedback_mode: "end", show_conversation_id: false, transcript_enabled: true,
          text_input_enabled: true, supports_text_only: true,
        },
      },
    }),
  ];
}

/** Merges plain objects deeply; arrays and other values from `b` replace those in `a`. */
export function deepMerge<T extends Json>(a: T, b: Json): T {
  const out: Json = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k];
    out[k] = v && typeof v === "object" && !Array.isArray(v) && cur && typeof cur === "object" && !Array.isArray(cur) ? deepMerge(cur as Json, v as Json) : v;
  }
  return out as T;
}

export const withExtras = (core: Json, groups: ExtraGroup[]): Json => groups.reduce((acc, g) => deepMerge(acc, g.body), core);

