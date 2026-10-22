/**
 * "Live in ElevenLabs": the settings CallsDash means the assistant to have, set beside what ElevenLabs reports. It answers
 * the admin's real question after a change, "did that really reach the assistant?". Pure, so it is tested without ElevenLabs.
 */
import { acceptsTemperature, defaultLlm } from "./agent-catalog";
import { studioOf, type SectionId } from "./agent-studio";
import type { LiveAgent } from "./elevenlabs-catalog";
import type { AgentSettings, Tenant } from "./types";
import { resolveVoiceId } from "./voices";

export type LiveValue = string | number | boolean | null;
/**
 * `same`: both agree. `differs`: CallsDash sent this and ElevenLabs shows something else. `unset`: CallsDash does not send it yet,
 * so ElevenLabs uses its own value. `unused`: the chosen model never reads this setting, so whatever ElevenLabs shows is harmless.
 */
export type LiveState = "same" | "differs" | "unset" | "unused";

export interface LiveRow {
  id: string;
  section: SectionId | "core";
  here: LiveValue;
  there: LiveValue;
  /** Appended to numbers: seconds or a multiplier. */
  unit?: "s" | "×";
  /** What a null value means for this row, so "no limit" reads better than a dash. */
  none?: "noLimit" | "default" | "notUsed";
  state: LiveState;
}

const near = (a: LiveValue, b: LiveValue) => (typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 1e-6 : a === b);
const orNull = <T,>(v: T | undefined): T | null => (v === undefined ? null : v);

export function liveRows(i: {
  settings: AgentSettings;
  tenant: Pick<Tenant, "retentionDays">;
  live: LiveAgent;
  /** The model used when the client has not chosen one. */
  fallbackLlm?: string;
  /** Passed in for tests; the environment's override is read otherwise. */
  voiceOverrides?: string;
}): LiveRow[] {
  const { settings: s, live } = i;
  const st = studioOf(s);
  const llm = st.llm || i.fallbackLlm || defaultLlm();
  const rows: LiveRow[] = [];
  /** `sent` is false while the section was never saved: CallsDash then leaves that option to ElevenLabs. */
  const add = (id: string, section: LiveRow["section"], here: LiveValue, there: LiveValue, sent: boolean, extra: Partial<Pick<LiveRow, "unit" | "none" | "state">> = {}) => {
    rows.push({ id, section, here: sent ? here : null, there, state: !sent ? "unset" : near(here, there) ? "same" : "differs", ...extra });
  };
  const saved = (section: SectionId) => st.touched.includes(section);
  const tokens = live.maxTokens && live.maxTokens > 0 ? live.maxTokens : null;
  const silence = live.silenceEndCallTimeout && live.silenceEndCallTimeout > 0 ? live.silenceEndCallTimeout : null;

  // A model that ignores the temperature has nothing to compare: it matches when ElevenLabs holds none, and is "not used" when ElevenLabs shows a value the model never reads.
  const usesTemperature = acceptsTemperature(llm);
  add("llm", "model", llm, orNull(live.llm), true);
  add("temperature", "model", usesTemperature ? s.temperature : null, orNull(live.temperature), true, { none: "notUsed", ...(!usesTemperature && live.temperature != null ? { state: "unused" as const } : {}) });
  add("maxTokens", "model", st.maxTokens || null, tokens, saved("model"), { none: "noLimit" });
  add("reasoningEffort", "model", st.reasoningEffort || null, live.reasoningEffort || null, saved("model"), { none: "default" });
  add("voiceEn", "voice", resolveVoiceId(s.voiceEn, "en", i.voiceOverrides), orNull(live.voiceId), true);
  add("voiceAr", "voice", resolveVoiceId(s.voiceAr, "ar", i.voiceOverrides), orNull(live.arabicVoiceId), true);
  add("ttsModelEn", "voice", st.ttsModelEn, orNull(live.ttsModel), true);
  add("ttsModelAr", "voice", st.ttsModelAr, orNull(live.arabicTtsModel), true);
  add("stability", "voice", st.stability, orNull(live.stability), saved("voice"));
  add("similarity", "voice", st.similarity, orNull(live.similarityBoost), saved("voice"));
  add("speed", "voice", st.speed, orNull(live.speed), saved("voice"), { unit: "×" });
  add("turnEagerness", "conversation", st.turnEagerness, orNull(live.turnEagerness), saved("conversation"));
  add("turnTimeout", "conversation", st.turnTimeout, orNull(live.turnTimeout), saved("conversation"), { unit: "s" });
  add("silenceEndSeconds", "conversation", st.silenceEndSeconds || null, silence, true, { unit: "s", none: "noLimit" });
  add("maxDurationSeconds", "conversation", st.maxDurationSeconds, orNull(live.maxDurationSeconds), true, { unit: "s" });
  add("asrProvider", "hearing", st.asrProvider, orNull(live.asrProvider), saved("hearing"), { none: "default" });
  add("dailyLimit", "safety", st.dailyLimit, orNull(live.dailyLimit), true);
  add("recordVoice", "safety", st.recordVoice, orNull(live.recordVoice), true);
  add("retentionDays", "safety", Math.max(1, Math.round(i.tenant.retentionDays || 90)), orNull(live.retentionDays), true);
  add("guardFocus", "safety", st.guardFocus, orNull(live.guardrailsFocus), true);
  add("guardInjection", "safety", st.guardInjection, orNull(live.guardrailsPromptInjection), true);
  return rows;
}

/** How many rows disagree: what the page shows at a glance. */
export const liveSummary = (rows: LiveRow[]) => ({
  differs: rows.filter((r) => r.state === "differs").length,
  unset: rows.filter((r) => r.state === "unset").length,
  same: rows.filter((r) => r.state === "same").length,
});
