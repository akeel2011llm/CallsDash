/**
 * "Read from ElevenLabs": takes the settings the client's agent holds in ElevenLabs and puts them into CallsDash, without
 * writing anything back. It is the safe direction after someone edited the agent by hand in ElevenLabs: CallsDash then holds the
 * same values, so the next sync or "Update the assistant" no longer reverts them.
 *
 * Only what ElevenLabs reported is read; whatever it did not return stays as CallsDash has it. The long instructions are not read:
 * CallsDash builds them from the clinic's own screens, so a copy of the built text could not be kept up to date.
 */
import { greeting } from "./agent-config";
import { defaultLlm } from "./agent-catalog";
import { CHOICES, studioOf } from "./agent-studio";
import { EVALUATION_CRITERIA, readableOn } from "./agent-extras";
import { BUSINESS_TYPES } from "./business-types";
import { explainCatalogError, type CatalogApi, type LiveAgent } from "./elevenlabs-catalog";
import { normalizeText } from "./text-diff";
import { diffValues, type FieldChange } from "./studio-profiles";
import type { Data } from "./data/demo";
import type { AgentSettings, Tenant } from "./types";
import { resolveVoiceId } from "./voices";

type Values = Record<string, unknown>;

const isHex = (s: unknown): s is string => typeof s === "string" && /^#[0-9a-f]{6}$/i.test(s);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): v is T => typeof v === "string" && allowed.includes(v as T);

export interface ReadInput {
  settings: AgentSettings;
  tenant: Pick<Tenant, "name" | "branding">;
  doctors: { name: string }[];
  live: LiveAgent;
  /** Passed in for tests; the environment's override is read otherwise. */
  voiceOverrides?: string;
}

/** The studio's settings as ElevenLabs holds them now: only the ones it reported, keyed like a profile. */
export function readLiveValues(i: ReadInput): Values {
  const { settings: s, live, tenant } = i;
  const st = studioOf(s);
  const out: Values = {};
  const set = (key: string, v: unknown) => { if (v !== undefined && v !== null) out[key] = v; };

  // the platform default model and a blank choice are the same model
  if (live.llm && live.llm !== (st.llm || defaultLlm())) set("llm", live.llm);
  set("temperature", live.temperature);
  if (live.maxTokens !== undefined) set("maxTokens", live.maxTokens > 0 ? live.maxTokens : 0);
  set("reasoningEffort", live.reasoningEffort);
  set("parallelTools", live.parallelTools);
  if (live.backupPreference) {
    const mode = live.backupPreference === "override" ? "custom" : live.backupPreference;
    if (oneOf(mode, CHOICES.backupMode)) { set("backupMode", mode); if (mode === "custom") set("backupModels", live.backupOrder ?? []); }
  }
  set("cascadeSeconds", live.cascadeSeconds);
  if (oneOf(live.serviceTier, CHOICES.serviceTier)) set("serviceTier", live.serviceTier);

  // a voice CallsDash names by its own label (voice_en_f) is the same voice when it resolves to the id ElevenLabs holds
  if (live.voiceId && live.voiceId !== resolveVoiceId(s.voiceEn, "en", i.voiceOverrides)) set("voiceEn", live.voiceId);
  if (live.arabicVoiceId && live.arabicVoiceId !== resolveVoiceId(s.voiceAr, "ar", i.voiceOverrides)) set("voiceAr", live.arabicVoiceId);
  set("ttsModelEn", live.ttsModel);
  set("ttsModelAr", live.arabicTtsModel);
  set("stability", live.stability);
  set("similarity", live.similarityBoost);
  set("speed", live.speed);
  if (oneOf(live.textNormalisation, CHOICES.textNormalisation)) set("textNormalisation", live.textNormalisation);
  set("expressive", live.expressive);
  set("audioTags", live.audioTags);
  set("effectFilter", live.effectFilter);
  set("effectEnvironment", live.effectEnvironment);
  set("effectNoise", live.effectNoise);
  set("effectDistance", live.effectDistance);

  if (oneOf(live.turnEagerness, CHOICES.turnEagerness)) set("turnEagerness", live.turnEagerness);
  set("turnTimeout", live.turnTimeout);
  if (live.silenceEndCallTimeout !== undefined) set("silenceEndSeconds", live.silenceEndCallTimeout > 0 ? live.silenceEndCallTimeout : 0);
  if (oneOf(live.spellingPatience, CHOICES.spellingPatience)) set("spellingPatience", live.spellingPatience);
  set("speculativeTurn", live.speculativeTurn);
  set("maxDurationSeconds", live.maxDurationSeconds);
  set("maxDurationMessage", live.maxDurationMessage);
  set("protectGreeting", live.protectGreeting);
  if (live.softTimeoutSeconds !== undefined) set("softTimeoutSeconds", live.softTimeoutSeconds > 0 ? live.softTimeoutSeconds : 0);
  set("softTimeoutMessageEn", live.softTimeoutMessage);
  set("softTimeoutMessageAr", live.arabicSoftTimeoutMessage);
  if (live.backgroundSound !== undefined && oneOf(live.backgroundSound, CHOICES.backgroundSound)) { set("backgroundSound", live.backgroundSound); set("backgroundVolume", live.backgroundVolume); }
  if (live.initialWaitSeconds !== undefined) set("initialWaitSeconds", live.initialWaitSeconds > 0 ? live.initialWaitSeconds : 0);
  set("ignoreTerms", live.ignoreTerms);
  set("ignoreDefaults", live.ignoreDefaults);
  if (live.turnModel !== undefined && oneOf(live.turnModel, CHOICES.turnModel)) set("turnModel", live.turnModel);
  set("chatFiles", live.chatFiles);
  if (live.chatFilesMax !== undefined && live.chatFilesMax > 0) set("chatFilesMax", live.chatFilesMax);

  // a greeting that is the automatic one reads as "automatic" (blank); another text is a custom greeting, with the clinic's name as {name}
  const style = s.arabicWrittenStyle;
  const greet = (lang: "en" | "ar", there: string | undefined, custom: string) => {
    if (there === undefined) return;
    const t = normalizeText(there);
    if (t === normalizeText(greeting(tenant, lang, style, ""))) return set(lang === "en" ? "greetingEn" : "greetingAr", "");
    if (t === normalizeText(greeting(tenant, lang, style, custom))) return; // the custom greeting CallsDash already holds
    const name = lang === "en" ? tenant.branding.displayName || tenant.name : tenant.branding.displayNameAr || tenant.name;
    set(lang === "en" ? "greetingEn" : "greetingAr", name ? there.replaceAll(name, "{name}") : there);
  };
  greet("en", live.firstMessage, st.greetingEn);
  greet("ar", live.arabicFirstMessage, st.greetingAr);

  if (oneOf(live.asrProvider, CHOICES.asrProvider)) set("asrProvider", live.asrProvider);
  if (live.keywords) {
    // the clinic and doctor names are added automatically (lib/agent-extras.ts), so only the other words are the studio's
    const auto = new Set([tenant.name, tenant.branding.displayName, tenant.branding.displayNameAr, ...i.doctors.map((d) => d.name)].map((w) => (w ?? "").trim().toLowerCase()).filter(Boolean));
    set("extraKeywords", live.keywords.filter((w) => !auto.has(w.trim().toLowerCase())));
  }

  set("ragEnabled", live.ragEnabled);
  if (oneOf(live.ragEmbedding, CHOICES.ragEmbedding)) set("ragEmbedding", live.ragEmbedding);
  set("ragMaxLength", live.ragMaxLength);
  set("ragMaxChunks", live.ragMaxChunks);
  set("guardFocus", live.guardrailsFocus);
  set("guardInjection", live.guardrailsPromptInjection);
  set("recordVoice", live.recordVoice);
  set("dailyLimit", live.dailyLimit);
  if (live.concurrencyLimit !== undefined) set("concurrencyLimit", live.concurrencyLimit > 0 ? live.concurrencyLimit : 0);
  set("bursting", live.bursting);
  set("queueEnabled", live.queueEnabled);
  set("queueWaitSeconds", live.queueWaitSeconds);

  if (live.summaryLanguage !== undefined) set("summaryLanguage", oneOf(live.summaryLanguage, CHOICES.summaryLanguage) ? live.summaryLanguage : "");
  if (live.criteriaIds) set("criteriaOff", EVALUATION_CRITERIA.map((c) => c.id).filter((id) => !live.criteriaIds!.includes(id)));
  // CallsDash adds its own two labels (CallsDash, the business type) at every sync, so only the others are the studio's
  if (live.tags) set("tags", live.tags.filter((x) => !["callsdash", ...BUSINESS_TYPES].includes(x.trim().toLowerCase())));

  Object.assign(out, readWidget(live.widget, tenant.branding.primaryColor));
  return out;
}

/** The widget's look and behaviour; "brand" colours when they are the client's own colour on a white card. */
function readWidget(w: Record<string, unknown> | undefined, primaryColor: string | undefined): Values {
  const out: Values = {};
  if (!w) return out;
  const set = (key: string, v: unknown) => { if (v !== undefined && v !== null) out[`w.${key}`] = v; };
  const bool = (key: string, from: string) => { if (typeof w[from] === "boolean") set(key, w[from]); };
  const text = (key: string, from: string) => { if (from in w) set(key, typeof w[from] === "string" ? w[from] : ""); };
  const colours = ["bg_color", "text_color", "border_color", "btn_color", "btn_text_color"].map((k) => w[k]);
  if (colours.every(isHex)) {
    const [bg, fg, border, btn, btnText] = (colours as string[]).map((c) => c.toLowerCase());
    const primary = isHex(primaryColor) ? primaryColor.toLowerCase() : "#0f766e";
    const brand = bg === "#ffffff" && fg === "#111111" && border === "#e1e1e1" && btn === primary && btnText === readableOn(primary);
    set("colors", brand ? "brand" : "custom");
    if (!brand) { set("bgColor", bg); set("textColor", fg); set("borderColor", border); set("btnColor", btn); set("btnTextColor", btnText); }
  }
  if (oneOf(w.variant, CHOICES.widgetVariant)) set("variant", w.variant);
  if (oneOf(w.placement, CHOICES.widgetPlacement)) set("placement", w.placement);
  if (oneOf(w.expandable, CHOICES.widgetExpandable)) set("expandable", w.expandable);
  if (oneOf(w.feedback_mode, CHOICES.widgetFeedback)) set("feedback", w.feedback_mode);
  if (typeof w.border_radius === "number") set("borderRadius", w.border_radius);
  if (typeof w.btn_radius === "number") set("btnRadius", w.btn_radius);
  text("actionText", "action_text"); text("startCallText", "start_call_text"); text("endCallText", "end_call_text");
  text("listeningText", "listening_text"); text("speakingText", "speaking_text");
  bool("transcript", "transcript_enabled"); bool("textInput", "text_input_enabled"); bool("textOnlyMode", "supports_text_only");
  bool("languageSelector", "language_selector"); bool("micMuting", "mic_muting_enabled"); bool("defaultExpanded", "default_expanded");
  bool("dismissible", "dismissible"); bool("endConfirmation", "end_confirmation_enabled"); bool("showConversationId", "show_conversation_id");
  bool("hideBanner", "disable_banner");
  return out;
}

/* ---------- reading and applying ---------- */

export interface ImportDeps {
  data: Pick<Data, "getAgent" | "getDoctors" | "getTenant" | "saveAgent">;
  /** Null when no ElevenLabs key is set. */
  catalog: Pick<CatalogApi, "getAgent"> | null;
}

export type LivePreview =
  | { kind: "ok"; values: Values; changes: FieldChange[]; same: number; agentName?: string }
  | { kind: "no_key" | "no_agent" }
  | { kind: "failed"; detail: string };

async function readLive(d: ImportDeps, tenantId: string) {
  const [settings, doctors, tenant] = await Promise.all([d.data.getAgent(tenantId), d.data.getDoctors(tenantId), d.data.getTenant(tenantId)]);
  if (!tenant) return { kind: "no_agent" as const };
  if (!d.catalog) return { kind: "no_key" as const };
  if (!settings.elevenLabsAgentId) return { kind: "no_agent" as const };
  try {
    const live = await d.catalog.getAgent(settings.elevenLabsAgentId);
    return { kind: "ok" as const, settings, values: readLiveValues({ settings, tenant, doctors, live }), live };
  } catch (e) {
    return { kind: "failed" as const, detail: explainCatalogError(e).slice(0, 400) };
  }
}

/** What reading the live settings would change in CallsDash. Writes nothing. */
export async function previewLive(d: ImportDeps, tenantId: string): Promise<LivePreview> {
  const r = await readLive(d, tenantId);
  if (r.kind !== "ok") return r;
  const { changes } = diffValues(r.settings, r.values);
  return { kind: "ok", values: r.values, changes, same: Object.keys(r.values).length - changes.length, agentName: r.live.name };
}

export type ImportOutcome = { kind: "imported"; count: number; values: Values } | { kind: "nothing" } | Exclude<LivePreview, { kind: "ok" }>;

/**
 * Puts the live settings into CallsDash. `take` limits it to the listed settings (the admin unticks the ones to keep); the
 * agent is read again here, so the form never supplies a value. ElevenLabs is not written to.
 */
export async function importLive(d: ImportDeps, tenantId: string, actor: string, take?: string[]): Promise<ImportOutcome> {
  const r = await readLive(d, tenantId);
  if (r.kind !== "ok") return r;
  const chosen = take ? Object.fromEntries(Object.entries(r.values).filter(([k]) => take.includes(k))) : r.values;
  const { changes, candidate } = diffValues(r.settings, chosen);
  // sections read for the first time count as saved, so a later sync sends what was read instead of CallsDash's old defaults
  const newlySaved = studioOf(candidate).touched.length !== studioOf(r.settings).touched.length;
  if (!changes.length && !newlySaved) return { kind: "nothing" };
  await d.data.saveAgent(tenantId, candidate, actor, `Read from ElevenLabs: ${changes.length} setting${changes.length === 1 ? "" : "s"}${changes.length ? ` (${changes.map((c) => c.key).join(", ")})` : ""}`.slice(0, 480));
  return { kind: "imported", count: changes.length, values: chosen };
}
