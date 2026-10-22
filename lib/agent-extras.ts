import { OUTCOME_ITEM } from "./agent-config";
import { studioOf, type AgentStudio, type SectionId } from "./agent-studio";
import type { AgentSettings, Tenant } from "./types";

type Json = Record<string, unknown>;

/**
 * Settings on top of the agent that are not needed for it to answer: safety, analysis, privacy and widget look.
 * They are sent separately from the core agent so that if ElevenLabs refuses one, the agent still works and the
 * admin sees which group was refused and why (lib/agent-sync.ts).
 */
export type ExtraGroup = { name: ExtraGroupName; body: Json };
export const EXTRA_GROUPS = ["tools", "hardening", "keywords", "guardrails", "analysis", "privacy", "limits", "widget", "model", "voice", "turn", "hearing"] as const;
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
  /** The client's agent settings. Without them (or without a saved studio) the agent keeps the settings it always had. */
  settings?: Pick<AgentSettings, "studio">;
}

/** The widget as it was before the studio: the client's brand colour on a white card, with the language selector and text chat. */
const legacyWidget = (primary: string) => ({
  bg_color: "#ffffff", text_color: "#111111", border_color: "#e1e1e1",
  btn_color: primary, btn_text_color: readableOn(primary), focus_color: primary,
  language_selector: true, feedback_mode: "end", show_conversation_id: false, transcript_enabled: true,
  text_input_enabled: true, supports_text_only: true,
});

const studioWidget = (w: AgentStudio["widget"], primary: string) => {
  const brand = w.colors === "brand";
  const btn = brand ? primary : w.btnColor;
  const orNull = (v: string) => v || null; // a blank text puts ElevenLabs' own wording back
  return {
    bg_color: brand ? "#ffffff" : w.bgColor, text_color: brand ? "#111111" : w.textColor, border_color: brand ? "#e1e1e1" : w.borderColor,
    btn_color: btn, btn_text_color: brand ? readableOn(primary) : w.btnTextColor, focus_color: btn,
    language_selector: w.languageSelector, feedback_mode: w.feedback, show_conversation_id: w.showConversationId, transcript_enabled: w.transcript,
    text_input_enabled: w.textInput, supports_text_only: w.textOnlyMode,
    variant: w.variant, placement: w.placement, expandable: w.expandable, border_radius: w.borderRadius, btn_radius: w.btnRadius,
    mic_muting_enabled: w.micMuting, default_expanded: w.defaultExpanded, dismissible: w.dismissible, end_confirmation_enabled: w.endConfirmation,
    action_text: orNull(w.actionText), start_call_text: orNull(w.startCallText), end_call_text: orNull(w.endCallText),
    listening_text: orNull(w.listeningText), speaking_text: orNull(w.speakingText),
  };
};

export function buildExtras(i: ExtrasInput): ExtraGroup[] {
  const brand = i.tenant.branding;
  const st = studioOf(i.settings ?? {});
  const saved = (section: SectionId) => st.touched.includes(section);
  const primary = isHex(brand.primaryColor) ? brand.primaryColor : "#0f766e";
  const auto = [i.tenant.name, brand.displayName, brand.displayNameAr, ...i.doctors.map((d) => d.name)];
  const keywords = [...new Set([...st.extraKeywords, ...auto].map((k) => (k ?? "").trim()).filter((k) => k && k.length <= 50))].slice(0, 20);
  const g = (name: ExtraGroupName, body: Json): ExtraGroup => ({ name, body });
  const groups: ExtraGroup[] = [
    // End call is not added automatically to agents made through the API, so without it a call can only end when the caller hangs up.
    g("tools", { conversation_config: { agent: { prompt: { built_in_tools: { end_call: system("end_call"), skip_turn: system("skip_turn") } } } } }),
    g("hardening", {
      conversation_config: {
        agent: { disable_first_message_interruptions: st.protectGreeting, prompt: { timezone: "Asia/Bahrain" } }, // the recording notice in the greeting must not be cut off
        turn: { silence_end_call_timeout: st.silenceEndSeconds || -1 },
      },
    }),
    g("keywords", { conversation_config: { asr: { keywords } } }), // clinic and doctor names are easy to mis-hear
    g("guardrails", { platform_settings: { guardrails: { version: "1", focus: { is_enabled: st.guardFocus }, prompt_injection: { is_enabled: st.guardInjection } } } }),
    g("analysis", {
      platform_settings: {
        evaluation: { criteria: EVALUATION_CRITERIA.filter((c) => !st.criteriaOff.includes(c.id)) },
        data_collection: DATA_COLLECTION,
        ...(saved("analysis") ? { summary_language: st.summaryLanguage || null } : {}),
      },
    }),
    g("privacy", { platform_settings: { privacy: { record_voice: st.recordVoice, retention_days: Math.max(1, Math.round(i.tenant.retentionDays || 90)) } } }),
    g("limits", { platform_settings: { call_limits: { daily_limit: st.dailyLimit, ...(saved("safety") ? { agent_concurrency_limit: st.concurrencyLimit || -1, bursting_enabled: st.bursting } : {}) } } }), // a public widget must not be able to run up an unlimited bill
    g("widget", { platform_settings: { widget: saved("widget") ? studioWidget(st.widget, primary) : legacyWidget(primary) } }),
  ];
  // The options below were added with the Assistant studio. They are sent only for a section an admin has saved.
  if (saved("model")) {
    groups.push(g("model", {
      conversation_config: {
        agent: {
          prompt: {
            max_tokens: st.maxTokens || -1,
            reasoning_effort: st.reasoningEffort || null, // null puts the model's own default back
            enable_parallel_tool_calls: st.parallelTools,
            backup_llm_config: st.backupMode === "custom" ? { preference: "override", order: st.backupModels } : { preference: st.backupMode },
            cascade_timeout_seconds: st.cascadeSeconds,
          },
        },
      },
    }));
  }
  if (saved("voice")) {
    groups.push(g("voice", {
      conversation_config: {
        tts: { stability: st.stability, similarity_boost: st.similarity, speed: st.speed, text_normalisation_type: st.textNormalisation, expressive_mode: st.expressive },
        language_presets: { ar: { overrides: { tts: { stability: st.stability, similarity_boost: st.similarity, speed: st.speed } } } },
      },
    }));
  }
  if (saved("conversation")) {
    groups.push(g("turn", {
      conversation_config: {
        agent: { max_conversation_duration_message: st.maxDurationMessage },
        turn: {
          turn_eagerness: st.turnEagerness, turn_timeout: st.turnTimeout, spelling_patience: st.spellingPatience, speculative_turn: st.speculativeTurn,
          soft_timeout_config: { timeout_seconds: st.softTimeoutSeconds || -1, message: st.softTimeoutMessageEn, use_llm_generated_message: false },
        },
        language_presets: { ar: { overrides: { turn: { soft_timeout_config: { message: st.softTimeoutMessageAr } } } } },
      },
    }));
  }
  if (saved("hearing")) groups.push(g("hearing", { conversation_config: { asr: { provider: st.asrProvider } } }));
  return groups;
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

