/**
 * Settings profiles for the Assistant studio: a named set of values that can be applied to a client's assistant in one step.
 *
 * A profile is a flat list of `key: value` pairs, one key per setting an admin can change (see FIELDS). A profile may hold only some
 * keys (the built-in ones leave the client's own voices, greetings and widget look alone); applying it changes exactly the keys it
 * holds and marks their sections as saved, so those values are sent to ElevenLabs from then on (lib/agent-studio.ts, `touched`).
 * Pure code: the data and the sync are in lib/studio-profile-actions.ts and lib/studio-apply.ts.
 */
import { randomUUID } from "node:crypto";
import { resolveStudio, studioOf, validVoiceId, type SectionId } from "./agent-studio";
import type { Data } from "./data/demo";
import type { AgentSettings } from "./types";

export interface FieldDef {
  key: string;
  section: SectionId;
  /** The suffix of the text key `prof.h.<hint>` that says how to use the setting and what it changes. */
  hint: string;
}

const f = (section: SectionId, keys: string[], hint?: (k: string) => string): FieldDef[] => keys.map((key) => ({ key, section, hint: hint ? hint(key) : key }));

/** Every setting a profile can hold, in the order the screens list them. */
export const FIELDS: FieldDef[] = [
  ...f("model", ["llm", "temperature", "maxTokens", "reasoningEffort", "parallelTools", "backupMode", "backupModels", "cascadeSeconds", "serviceTier"]),
  ...f("voice", ["voiceEn", "voiceAr", "ttsModelEn", "ttsModelAr", "stability", "similarity", "speed", "textNormalisation", "expressive", "offeredVoices", "audioTags"]),
  ...f("voice", ["effectFilter", "effectEnvironment", "effectNoise", "effectDistance"], () => "effects"),
  ...f("conversation", ["turnEagerness", "turnTimeout", "silenceEndSeconds", "spellingPatience", "speculativeTurn", "maxDurationSeconds", "maxDurationMessage", "protectGreeting", "softTimeoutSeconds", "softTimeoutMessageEn", "softTimeoutMessageAr", "greetingEn", "greetingAr"]),
  ...f("conversation", ["backgroundSound", "backgroundVolume", "initialWaitSeconds", "ignoreTerms", "ignoreDefaults", "turnModel", "chatFiles", "chatFilesMax"]),
  ...f("hearing", ["asrProvider", "extraKeywords"]),
  ...f("safety", ["guardFocus", "guardInjection", "recordVoice", "dailyLimit", "concurrencyLimit", "bursting", "queueEnabled", "queueWaitSeconds"]),
  ...f("analysis", ["summaryLanguage", "criteriaOff", "tags"]),
  ...f("widget", ["w.colors"]),
  ...f("widget", ["w.bgColor", "w.textColor", "w.borderColor", "w.btnColor", "w.btnTextColor"], () => "w.colour"),
  ...f("widget", ["w.variant", "w.placement", "w.expandable", "w.feedback"]),
  ...f("widget", ["w.borderRadius", "w.btnRadius"], () => "w.radius"),
  ...f("widget", ["w.actionText", "w.startCallText", "w.endCallText", "w.listeningText", "w.speakingText"], () => "w.text"),
  ...f("widget", ["w.transcript", "w.textInput", "w.textOnlyMode", "w.languageSelector", "w.micMuting", "w.defaultExpanded", "w.dismissible", "w.endConfirmation", "w.showConversationId", "w.hideBanner"]),
];

const BY_KEY = new Map(FIELDS.map((x) => [x.key, x]));
export const isFieldKey = (k: string) => BY_KEY.has(k);
export const fieldOf = (k: string) => BY_KEY.get(k);

/** One setting's value on a client's stored settings. */
export function getField(s: AgentSettings, key: string): unknown {
  if (key === "temperature") return s.temperature;
  if (key === "voiceEn") return s.voiceEn;
  if (key === "voiceAr") return s.voiceAr;
  const st = studioOf(s);
  if (key.startsWith("w.")) return (st.widget as unknown as Record<string, unknown>)[key.slice(2)];
  return (st as unknown as Record<string, unknown>)[key];
}

/** Every setting of the client, to save as a profile. */
export function snapshot(s: AgentSettings): Record<string, unknown> {
  return Object.fromEntries(FIELDS.map((x) => [x.key, structuredClone(getField(s, x.key))]));
}

/**
 * The settings after putting `values` on them. Only the keys given change; each value is forced into its allowed range
 * (a wrong type or an unknown choice leaves the field at its default), and the sections they belong to count as saved.
 */
export function applyValues(cur: AgentSettings, values: Record<string, unknown>): AgentSettings {
  const d = studioOf(cur);
  const raw: Record<string, unknown> = { ...d, widget: { ...d.widget } };
  const widget = raw.widget as Record<string, unknown>;
  const top: Partial<Pick<AgentSettings, "temperature" | "voiceEn" | "voiceAr">> = {};
  const sections = new Set<SectionId>();
  for (const [key, v] of Object.entries(values)) {
    const def = BY_KEY.get(key);
    if (!def) continue;
    sections.add(def.section);
    if (key === "temperature") { if (typeof v === "number" && Number.isFinite(v)) top.temperature = Math.round(Math.min(1, Math.max(0, v)) * 20) / 20; continue; }
    if (key === "voiceEn" || key === "voiceAr") { if (typeof v === "string" && validVoiceId(v)) top[key] = v; continue; }
    if (key.startsWith("w.")) widget[key.slice(2)] = v;
    else raw[key] = v;
  }
  raw.touched = [...d.touched, ...sections];
  return { ...cur, ...top, studio: resolveStudio(raw) };
}

export interface FieldChange { key: string; section: SectionId; here: unknown; next: unknown }

/** What putting `values` on the settings would change, setting by setting, and the settings that result. */
export function diffValues(cur: AgentSettings, values: Record<string, unknown>): { changes: FieldChange[]; candidate: AgentSettings } {
  const candidate = applyValues(cur, values);
  const changes: FieldChange[] = [];
  for (const def of FIELDS) {
    if (!(def.key in values)) continue;
    const here = getField(cur, def.key), next = getField(candidate, def.key);
    if (JSON.stringify(here) !== JSON.stringify(next)) changes.push({ key: def.key, section: def.section, here, next });
  }
  return { changes, candidate };
}

/* ---------- the profiles that come with CallsDash ---------- */

export const BUILTIN_IDS = ["recommended", "lowcost", "premium", "patient"] as const;
export type BuiltinId = (typeof BUILTIN_IDS)[number];

/**
 * The balanced setting suggested for a clinic. The built-in profiles never hold the client's own voices, greetings, extra words,
 * widget colours and texts, or the list of voices they may pick from: those belong to the client, not to a tuning.
 */
const BASE: Record<string, unknown> = {
  llm: "gemini-2.5-flash", temperature: 0.3, maxTokens: 600, reasoningEffort: "", parallelTools: true, backupMode: "default", backupModels: [], cascadeSeconds: 4, serviceTier: "standard",
  ttsModelEn: "eleven_flash_v2", ttsModelAr: "eleven_flash_v2_5", stability: 0.5, similarity: 0.8, speed: 1, textNormalisation: "system_prompt", expressive: false,
  effectFilter: "", effectEnvironment: "", effectNoise: "", effectDistance: 0,
  turnEagerness: "normal", turnTimeout: 7, silenceEndSeconds: 30, spellingPatience: "auto", speculativeTurn: false, maxDurationSeconds: 900, protectGreeting: true, softTimeoutSeconds: 3,
  backgroundSound: "", backgroundVolume: 0.2, initialWaitSeconds: 0, ignoreDefaults: true, turnModel: "", chatFiles: false, chatFilesMax: 5,
  asrProvider: "scribe_realtime",
  guardFocus: true, guardInjection: true, recordVoice: true, dailyLimit: 500, concurrencyLimit: 0, bursting: true, queueEnabled: true, queueWaitSeconds: 60,
  summaryLanguage: "", criteriaOff: [],
  "w.variant": "full", "w.placement": "bottom-right", "w.expandable": "never", "w.feedback": "end",
  "w.transcript": true, "w.textInput": true, "w.textOnlyMode": true, "w.languageSelector": true, "w.micMuting": false, "w.defaultExpanded": false,
  "w.dismissible": false, "w.endConfirmation": false, "w.showConversationId": false, "w.hideBanner": true,
};

export const BUILTIN_VALUES: Record<BuiltinId, Record<string, unknown>> = {
  recommended: BASE,
  lowcost: {
    ...BASE, llm: "gemini-2.5-flash-lite", temperature: 0.2, maxTokens: 400, cascadeSeconds: 3, similarity: 0.75, speed: 1.05,
    turnEagerness: "eager", turnTimeout: 5, silenceEndSeconds: 15, maxDurationSeconds: 480, softTimeoutSeconds: 3,
    dailyLimit: 200, bursting: false, summaryLanguage: "en", criteriaOff: ["details_confirmed", "caller_language"],
    "w.variant": "compact", "w.feedback": "none",
  },
  premium: {
    ...BASE, llm: "claude-sonnet-5-5", maxTokens: 800, cascadeSeconds: 5,
    ttsModelEn: "eleven_v4_turbo", ttsModelAr: "eleven_v4_turbo", stability: 0.45, speed: 0.95, expressive: true,
    turnTimeout: 8, silenceEndSeconds: 40, maxDurationSeconds: 1200, dailyLimit: 300,
  },
  patient: {
    ...BASE, temperature: 0.2, maxTokens: 600, stability: 0.6, speed: 0.9,
    turnEagerness: "patient", turnTimeout: 10, silenceEndSeconds: 45, maxDurationSeconds: 1200, softTimeoutSeconds: 2.5,
  },
};

/** The recommended value of each setting in one studio section that has one (the client's own voices, words and texts have none). */
export const recommendedFor = (section: SectionId): Record<string, unknown> =>
  Object.fromEntries(Object.entries(BASE).filter(([k]) => BY_KEY.get(k)?.section === section));

/** The keys the built-in profiles leave alone, shown as "kept as it is" in the lists. */
export const LEFT_ALONE = FIELDS.map((x) => x.key).filter((k) => !(k in BASE));

export interface StudioProfile {
  id: string;
  name: string;
  note: string;
  createdAt: string;
  by: string;
  values: Record<string, unknown>;
}

export const PROFILES_KEY = "studio.profiles";
export const PROFILE_LIMITS = { count: 30, name: 60, note: 240 } as const;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const oneLine = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** A stored profile read safely: only known settings, bounded texts. */
export function cleanProfile(raw: unknown): StudioProfile | null {
  if (!isObj(raw) || typeof raw.id !== "string" || !/^p_[a-z0-9]{6,20}$/.test(raw.id)) return null;
  const name = oneLine(raw.name, PROFILE_LIMITS.name);
  if (!name || !isObj(raw.values)) return null;
  const values = Object.fromEntries(Object.entries(raw.values).filter(([k]) => BY_KEY.has(k)));
  return { id: raw.id, name, note: oneLine(raw.note, PROFILE_LIMITS.note), createdAt: oneLine(raw.createdAt, 40), by: oneLine(raw.by, 80), values };
}

type ProfileData = Pick<Data, "getSetting" | "setSetting">;

export async function loadProfiles(d: ProfileData): Promise<StudioProfile[]> {
  const raw = await d.getSetting(PROFILES_KEY).catch(() => undefined);
  const items = isObj(raw) && Array.isArray(raw.items) ? raw.items : [];
  return items.map(cleanProfile).filter((p): p is StudioProfile => !!p).slice(0, PROFILE_LIMITS.count);
}

const store = (d: ProfileData, items: StudioProfile[]) => d.setSetting(PROFILES_KEY, { items });

export type ProfileError = "name" | "nameTaken" | "full" | "missing";

export async function addProfile(d: ProfileData, input: { name: string; note: string; values: Record<string, unknown>; by: string; now?: Date }): Promise<{ ok: true; profile: StudioProfile } | { ok: false; error: ProfileError }> {
  const name = oneLine(input.name, PROFILE_LIMITS.name);
  if (!name) return { ok: false, error: "name" };
  const items = await loadProfiles(d);
  if (items.length >= PROFILE_LIMITS.count) return { ok: false, error: "full" };
  if (items.some((p) => p.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: "nameTaken" };
  const profile: StudioProfile = {
    id: `p_${randomUUID().replace(/-/g, "").slice(0, 10)}`, name, note: oneLine(input.note, PROFILE_LIMITS.note),
    createdAt: (input.now ?? new Date()).toISOString(), by: oneLine(input.by, 80), values: input.values,
  };
  await store(d, [...items, profile]);
  return { ok: true, profile };
}

export async function renameProfile(d: ProfileData, id: string, input: { name: string; note: string }): Promise<{ ok: true } | { ok: false; error: ProfileError }> {
  const name = oneLine(input.name, PROFILE_LIMITS.name);
  if (!name) return { ok: false, error: "name" };
  const items = await loadProfiles(d);
  const at = items.findIndex((p) => p.id === id);
  if (at < 0) return { ok: false, error: "missing" };
  if (items.some((p) => p.id !== id && p.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: "nameTaken" };
  items[at] = { ...items[at], name, note: oneLine(input.note, PROFILE_LIMITS.note) };
  await store(d, items);
  return { ok: true };
}

export async function removeProfile(d: ProfileData, id: string): Promise<boolean> {
  const items = await loadProfiles(d);
  if (!items.some((p) => p.id === id)) return false;
  await store(d, items.filter((p) => p.id !== id));
  return true;
}

/** How many settings of the profile differ from the client's: 0 means the client already has this profile. */
export const distance = (cur: AgentSettings, values: Record<string, unknown>) => diffValues(cur, values).changes.length;
