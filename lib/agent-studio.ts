/**
 * The Assistant studio's settings: everything an admin can tune on a client's ElevenLabs agent beyond the prompt, voices
 * and style the client edits themselves. Stored inside `AgentSettings.studio` (jsonb, so a new field needs no migration).
 *
 * Two rules keep existing clients safe:
 *  - Only the defaults below are ever assumed. A client whose studio was never saved gets exactly the agent it had before.
 *  - A section's newer options reach ElevenLabs only after an admin saved that section once (`touched`), and from then on
 *    every option of the section is sent, so "back to default" really resets the agent (ElevenLabs keeps what it is not told).
 */
import type { AgentSettings } from "./types";

export const SECTIONS = ["model", "voice", "conversation", "hearing", "safety", "analysis", "widget"] as const;
export type SectionId = (typeof SECTIONS)[number];

/** Allowed values, in the order the screens list them. */
export const CHOICES = {
  reasoningEffort: ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
  backupMode: ["default", "disabled", "custom"],
  textNormalisation: ["system_prompt", "elevenlabs"],
  turnEagerness: ["patient", "normal", "eager"],
  spellingPatience: ["auto", "off"],
  asrProvider: ["scribe_realtime", "scribe_v2_turbo"],
  summaryLanguage: ["", "en", "ar"],
  widgetVariant: ["tiny", "compact", "full", "expandable"],
  widgetPlacement: ["top-left", "top", "top-right", "bottom-left", "bottom", "bottom-right"],
  widgetExpandable: ["never", "mobile", "desktop", "always"],
  widgetFeedback: ["none", "during", "end"],
  widgetColors: ["brand", "custom"],
} as const;

/** Numeric limits, from ElevenLabs' documentation. `[min, max]`; a value of `off` means the option is switched off. */
export const LIMITS = {
  temperature: [0, 1],
  maxTokens: [50, 4096], // 0 means no limit
  cascadeSeconds: [2, 15],
  stability: [0, 1],
  similarity: [0, 1],
  speed: [0.7, 1.2],
  turnTimeout: [1, 30],
  silenceEndSeconds: [5, 600], // 0 means never
  maxDurationSeconds: [60, 7200],
  softTimeoutSeconds: [0.5, 8], // 0 means off
  dailyLimit: [1, 100000],
  concurrencyLimit: [1, 1000], // 0 means no limit
  keywords: [0, 20],
  keywordLength: 50,
  offeredVoices: 30,
  greeting: 600,
  shortText: 120,
  widgetRadius: [0, 40],
} as const;

export interface OfferedVoice {
  id: string;
  name: string;
  /** Which of the client's two voice lists it appears in. */
  language: "en" | "ar" | "both";
  gender?: string;
  accent?: string;
  previewUrl?: string;
}

export interface VoiceNote { name: string; gender?: string; language?: string; accent?: string; previewUrl?: string }

export interface WidgetStudio {
  /** "brand" paints the widget in the client's branding colour; "custom" uses the colours below. */
  colors: "brand" | "custom";
  bgColor: string; textColor: string; borderColor: string; btnColor: string; btnTextColor: string;
  variant: (typeof CHOICES.widgetVariant)[number];
  placement: (typeof CHOICES.widgetPlacement)[number];
  expandable: (typeof CHOICES.widgetExpandable)[number];
  borderRadius: number;
  btnRadius: number;
  /** Texts shown in the widget, in the visitor's language. Blank keeps ElevenLabs' own words. */
  actionText: string; startCallText: string; endCallText: string; listeningText: string; speakingText: string;
  transcript: boolean; textInput: boolean; micMuting: boolean; languageSelector: boolean; textOnlyMode: boolean;
  defaultExpanded: boolean; dismissible: boolean; endConfirmation: boolean; showConversationId: boolean;
  /** Hides the small "Powered by ..." line under the widget. On unless an admin turns it off. */
  hideBanner: boolean;
  feedback: (typeof CHOICES.widgetFeedback)[number];
}

export interface AgentStudio {
  /** Sections saved at least once (see the module comment). */
  touched: SectionId[];

  /* model */
  /** "" follows the platform default (ELEVENLABS_LLM, or Gemini 2.5 Flash). */
  llm: string;
  /** 0 = no limit on the length of one reply. */
  maxTokens: number;
  /** "" = leave it to the model. Only models that support it accept a level. */
  reasoningEffort: string;
  parallelTools: boolean;
  backupMode: (typeof CHOICES.backupMode)[number];
  backupModels: string[];
  cascadeSeconds: number;

  /* voice */
  ttsModelEn: string;
  ttsModelAr: string;
  stability: number;
  similarity: number;
  speed: number;
  textNormalisation: (typeof CHOICES.textNormalisation)[number];
  expressive: boolean;
  /** The voices the client may pick from on their Voice page. Empty = the four built-in ones. */
  offeredVoices: OfferedVoice[];
  /** Names and previews of the voices in use, so screens can show them without asking ElevenLabs each time. */
  voiceNotes: Record<string, VoiceNote>;

  /* conversation */
  turnEagerness: (typeof CHOICES.turnEagerness)[number];
  turnTimeout: number;
  /** 0 = never hang up on silence. */
  silenceEndSeconds: number;
  spellingPatience: (typeof CHOICES.spellingPatience)[number];
  speculativeTurn: boolean;
  maxDurationSeconds: number;
  /** What the assistant says when the time limit is reached. Blank = it just ends. */
  maxDurationMessage: string;
  /** The greeting cannot be interrupted, so the recording notice is heard in full. */
  protectGreeting: boolean;
  /** Seconds before "one moment please" is said while the model thinks. 0 = off. */
  softTimeoutSeconds: number;
  softTimeoutMessageEn: string;
  softTimeoutMessageAr: string;
  /** Blank = the automatic greeting built from the clinic's name. `{name}` is replaced by the clinic's display name. */
  greetingEn: string;
  greetingAr: string;

  /* hearing */
  asrProvider: (typeof CHOICES.asrProvider)[number];
  /** Extra words the speech recognition should listen for (on top of the clinic and doctor names, which are added automatically). */
  extraKeywords: string[];

  /* safety, privacy and limits */
  guardFocus: boolean;
  guardInjection: boolean;
  recordVoice: boolean;
  dailyLimit: number;
  /** 0 = no limit (ElevenLabs' plan limit applies). */
  concurrencyLimit: number;
  bursting: boolean;

  /* analysis */
  summaryLanguage: (typeof CHOICES.summaryLanguage)[number];
  /** Evaluation criteria (ids from lib/agent-extras.ts) ElevenLabs should not judge. */
  criteriaOff: string[];

  /* widget */
  widget: WidgetStudio;
}

export const WIDGET_DEFAULTS: WidgetStudio = {
  colors: "brand", bgColor: "#ffffff", textColor: "#111111", borderColor: "#e1e1e1", btnColor: "#0f766e", btnTextColor: "#ffffff",
  variant: "full", placement: "bottom-right", expandable: "never", borderRadius: 16, btnRadius: 10,
  actionText: "", startCallText: "", endCallText: "", listeningText: "", speakingText: "",
  transcript: true, textInput: true, micMuting: false, languageSelector: true, textOnlyMode: true,
  defaultExpanded: false, dismissible: false, endConfirmation: false, showConversationId: false, hideBanner: true, feedback: "end",
};

/** What a client has when the studio was never saved. The values that already existed before the studio match what the agent had. */
export const STUDIO_DEFAULTS: AgentStudio = {
  touched: [],
  llm: "", maxTokens: 0, reasoningEffort: "", parallelTools: true, backupMode: "default", backupModels: [], cascadeSeconds: 4,
  ttsModelEn: "eleven_flash_v2", ttsModelAr: "eleven_flash_v2_5", stability: 0.5, similarity: 0.8, speed: 1, textNormalisation: "system_prompt", expressive: false,
  offeredVoices: [], voiceNotes: {},
  turnEagerness: "normal", turnTimeout: 7, silenceEndSeconds: 30, spellingPatience: "auto", speculativeTurn: false,
  maxDurationSeconds: 900, maxDurationMessage: "", protectGreeting: true, softTimeoutSeconds: 0,
  softTimeoutMessageEn: "One moment please.", softTimeoutMessageAr: "لحظة من فضلك.", greetingEn: "", greetingAr: "",
  asrProvider: "scribe_realtime", extraKeywords: [],
  guardFocus: true, guardInjection: true, recordVoice: true, dailyLimit: 500, concurrencyLimit: 0, bursting: true,
  summaryLanguage: "", criteriaOff: [],
  widget: WIDGET_DEFAULTS,
};

/* ---------- reading what is stored ---------- */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const clamp = (n: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, n));
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const text = (v: unknown, max: number, fallback = "") => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : fallback);
const long = (v: unknown, max: number, fallback = "") => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, max) : fallback);
const flag = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
/** Rounds to the step (0.05 for a slider) without the 0.30000000000000004 a plain multiplication leaves. */
const snap = (n: number, step: number) => Number((Math.round(n / step) * step).toFixed(6));
const number = (v: unknown, range: readonly [number, number], fallback: number, step = 1) => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return snap(clamp(n, range), step);
};
const hex = (v: unknown, fallback: string) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback);
const list = (v: unknown, each: (x: unknown) => string, max: number) => [...new Set((Array.isArray(v) ? v : []).map(each).filter(Boolean))].slice(0, max);

/** Voice ids are letters and digits; our own labels (voice_en_f) also contain underscores. */
export const validVoiceId = (v: string) => /^[A-Za-z0-9_-]{6,64}$/.test(v);
/** Model ids as ElevenLabs writes them: letters, digits, dot, dash, underscore and @. */
export const validModelId = (v: string) => /^[a-z0-9][a-z0-9._@-]{1,80}$/i.test(v);
const httpsOnly = (v: unknown) => {
  if (typeof v !== "string") return undefined;
  try { return new URL(v).protocol === "https:" ? v.slice(0, 500) : undefined; } catch { return undefined; }
};

function cleanVoice(v: unknown): OfferedVoice | null {
  if (!isObj(v) || typeof v.id !== "string" || !validVoiceId(v.id)) return null;
  return {
    id: v.id, name: text(v.name, 60) || v.id, language: pick(v.language, ["en", "ar", "both"] as const, "both"),
    gender: text(v.gender, 20) || undefined, accent: text(v.accent, 40) || undefined, previewUrl: httpsOnly(v.previewUrl),
  };
}

function cleanNote(v: unknown): VoiceNote | null {
  if (!isObj(v)) return null;
  return { name: text(v.name, 60) || "?", gender: text(v.gender, 20) || undefined, language: text(v.language, 8) || undefined, accent: text(v.accent, 40) || undefined, previewUrl: httpsOnly(v.previewUrl) };
}

function cleanWidget(raw: unknown): WidgetStudio {
  const w = isObj(raw) ? raw : {};
  const d = WIDGET_DEFAULTS;
  return {
    colors: pick(w.colors, CHOICES.widgetColors, d.colors),
    bgColor: hex(w.bgColor, d.bgColor), textColor: hex(w.textColor, d.textColor), borderColor: hex(w.borderColor, d.borderColor),
    btnColor: hex(w.btnColor, d.btnColor), btnTextColor: hex(w.btnTextColor, d.btnTextColor),
    variant: pick(w.variant, CHOICES.widgetVariant, d.variant), placement: pick(w.placement, CHOICES.widgetPlacement, d.placement),
    expandable: pick(w.expandable, CHOICES.widgetExpandable, d.expandable),
    borderRadius: number(w.borderRadius, LIMITS.widgetRadius, d.borderRadius), btnRadius: number(w.btnRadius, LIMITS.widgetRadius, d.btnRadius),
    actionText: text(w.actionText, LIMITS.shortText), startCallText: text(w.startCallText, LIMITS.shortText), endCallText: text(w.endCallText, LIMITS.shortText),
    listeningText: text(w.listeningText, LIMITS.shortText), speakingText: text(w.speakingText, LIMITS.shortText),
    transcript: flag(w.transcript, d.transcript), textInput: flag(w.textInput, d.textInput), micMuting: flag(w.micMuting, d.micMuting),
    languageSelector: flag(w.languageSelector, d.languageSelector), textOnlyMode: flag(w.textOnlyMode, d.textOnlyMode),
    defaultExpanded: flag(w.defaultExpanded, d.defaultExpanded), dismissible: flag(w.dismissible, d.dismissible),
    endConfirmation: flag(w.endConfirmation, d.endConfirmation), showConversationId: flag(w.showConversationId, d.showConversationId), hideBanner: flag(w.hideBanner, d.hideBanner),
    feedback: pick(w.feedback, CHOICES.widgetFeedback, d.feedback),
  };
}

/** The complete studio for a client: stored values over the defaults, every value forced into its allowed range. */
export function resolveStudio(raw: unknown): AgentStudio {
  const s = isObj(raw) ? raw : {};
  const d = STUDIO_DEFAULTS;
  const notes: Record<string, VoiceNote> = {};
  if (isObj(s.voiceNotes)) for (const [id, v] of Object.entries(s.voiceNotes).slice(0, 80)) { const n = validVoiceId(id) ? cleanNote(v) : null; if (n) notes[id] = n; }
  const silence = number(s.silenceEndSeconds, [0, LIMITS.silenceEndSeconds[1]], d.silenceEndSeconds);
  const soft = number(s.softTimeoutSeconds, [0, LIMITS.softTimeoutSeconds[1]], d.softTimeoutSeconds, 0.5);
  const concurrency = number(s.concurrencyLimit, [0, LIMITS.concurrencyLimit[1]], d.concurrencyLimit);
  const maxTokens = number(s.maxTokens, [0, LIMITS.maxTokens[1]], d.maxTokens);
  return {
    touched: [...new Set((Array.isArray(s.touched) ? s.touched : []).filter((x): x is SectionId => SECTIONS.includes(x as SectionId)))],
    llm: typeof s.llm === "string" && validModelId(s.llm) ? s.llm : d.llm,
    maxTokens: maxTokens === 0 ? 0 : clamp(maxTokens, LIMITS.maxTokens),
    reasoningEffort: pick(s.reasoningEffort, ["", ...CHOICES.reasoningEffort] as const, d.reasoningEffort),
    parallelTools: flag(s.parallelTools, d.parallelTools),
    backupMode: pick(s.backupMode, CHOICES.backupMode, d.backupMode),
    backupModels: list(s.backupModels, (x) => (typeof x === "string" && validModelId(x) ? x : ""), 5),
    cascadeSeconds: number(s.cascadeSeconds, LIMITS.cascadeSeconds, d.cascadeSeconds, 0.5),
    ttsModelEn: typeof s.ttsModelEn === "string" && validModelId(s.ttsModelEn) ? s.ttsModelEn : d.ttsModelEn,
    ttsModelAr: typeof s.ttsModelAr === "string" && validModelId(s.ttsModelAr) ? s.ttsModelAr : d.ttsModelAr,
    stability: number(s.stability, LIMITS.stability, d.stability, 0.05),
    similarity: number(s.similarity, LIMITS.similarity, d.similarity, 0.05),
    speed: number(s.speed, LIMITS.speed, d.speed, 0.05),
    textNormalisation: pick(s.textNormalisation, CHOICES.textNormalisation, d.textNormalisation),
    expressive: flag(s.expressive, d.expressive),
    offeredVoices: dedupeVoices((Array.isArray(s.offeredVoices) ? s.offeredVoices : []).map(cleanVoice).filter((v): v is OfferedVoice => !!v)).slice(0, LIMITS.offeredVoices),
    voiceNotes: notes,
    turnEagerness: pick(s.turnEagerness, CHOICES.turnEagerness, d.turnEagerness),
    turnTimeout: number(s.turnTimeout, LIMITS.turnTimeout, d.turnTimeout, 0.5),
    silenceEndSeconds: silence === 0 ? 0 : clamp(silence, LIMITS.silenceEndSeconds),
    spellingPatience: pick(s.spellingPatience, CHOICES.spellingPatience, d.spellingPatience),
    speculativeTurn: flag(s.speculativeTurn, d.speculativeTurn),
    maxDurationSeconds: number(s.maxDurationSeconds, LIMITS.maxDurationSeconds, d.maxDurationSeconds, 30),
    maxDurationMessage: text(s.maxDurationMessage, LIMITS.shortText * 2),
    protectGreeting: flag(s.protectGreeting, d.protectGreeting),
    softTimeoutSeconds: soft === 0 ? 0 : clamp(soft, LIMITS.softTimeoutSeconds),
    softTimeoutMessageEn: text(s.softTimeoutMessageEn, LIMITS.shortText, d.softTimeoutMessageEn) || d.softTimeoutMessageEn,
    softTimeoutMessageAr: text(s.softTimeoutMessageAr, LIMITS.shortText, d.softTimeoutMessageAr) || d.softTimeoutMessageAr,
    greetingEn: long(s.greetingEn, LIMITS.greeting), greetingAr: long(s.greetingAr, LIMITS.greeting),
    asrProvider: pick(s.asrProvider, CHOICES.asrProvider, d.asrProvider),
    extraKeywords: list(s.extraKeywords, (x) => (typeof x === "string" ? text(x, LIMITS.keywordLength) : ""), LIMITS.keywords[1]),
    guardFocus: flag(s.guardFocus, d.guardFocus), guardInjection: flag(s.guardInjection, d.guardInjection), recordVoice: flag(s.recordVoice, d.recordVoice),
    dailyLimit: number(s.dailyLimit, LIMITS.dailyLimit, d.dailyLimit),
    concurrencyLimit: concurrency === 0 ? 0 : clamp(concurrency, LIMITS.concurrencyLimit),
    bursting: flag(s.bursting, d.bursting),
    summaryLanguage: pick(s.summaryLanguage, CHOICES.summaryLanguage, d.summaryLanguage),
    criteriaOff: list(s.criteriaOff, (x) => (typeof x === "string" && /^[a-z_]{3,40}$/.test(x) ? x : ""), 10),
    widget: cleanWidget(s.widget),
  };
}

function dedupeVoices(v: OfferedVoice[]): OfferedVoice[] {
  const seen = new Set<string>();
  return v.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}

/** The studio of this client's settings, with the defaults filled in. */
export const studioOf = (s: Pick<AgentSettings, "studio">) => resolveStudio(s.studio);

/** True once an admin saved this section, which is when its newer options start reaching ElevenLabs. */
export const isTouched = (s: Pick<AgentSettings, "studio">, section: SectionId) => studioOf(s).touched.includes(section);

/* ---------- the forms ---------- */

export interface ParsedSection {
  /** Values for the studio. Always the section's complete set, so a save also resets what the form left out. */
  studio: Partial<AgentStudio>;
  /** Fields that live next to the studio on the agent settings. */
  top: Partial<Pick<AgentSettings, "temperature" | "voiceEn" | "voiceAr">>;
  /** Translation keys (studio.err.*) with the form field they belong to. */
  errors: { field: string; key: string }[];
}

const val = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const on = (f: FormData, k: string) => f.get(k) === "on";

class Reader {
  errors: ParsedSection["errors"] = [];
  constructor(public f: FormData) {}
  bad(field: string, key = "studio.err.range") { this.errors.push({ field, key }); }
  /** A number inside [min, max]; blank or outside the range is an error and keeps `fallback`. `zero` allows 0 as "off". */
  num(field: string, range: readonly [number, number], fallback: number, opts: { zero?: boolean; step?: number } = {}): number {
    const raw = val(this.f, field).replace(",", ".");
    if (raw === "") { this.bad(field); return fallback; }
    const n = Number(raw);
    if (!Number.isFinite(n)) { this.bad(field); return fallback; }
    if (opts.zero && n === 0) return 0;
    if (n < range[0] - 1e-9 || n > range[1] + 1e-9) { this.bad(field); return fallback; }
    return snap(n, opts.step ?? 1);
  }
  choice<T extends string>(field: string, allowed: readonly T[], fallback: T): T {
    const v = val(this.f, field);
    if (allowed.includes(v as T)) return v as T;
    this.bad(field, "studio.err.choice");
    return fallback;
  }
  color(field: string, fallback: string): string {
    const v = val(this.f, field);
    if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
    this.bad(field, "studio.err.color");
    return fallback;
  }
  str(field: string, max: number): string {
    const v = val(this.f, field).replace(/\s+/g, " ");
    if (v.length > max) { this.bad(field, "studio.err.long"); return v.slice(0, max); }
    return v;
  }
  para(field: string, max: number): string {
    const v = String(this.f.get(field) ?? "").replace(/\r\n/g, "\n").trim();
    if (v.length > max) { this.bad(field, "studio.err.long"); return v.slice(0, max); }
    return v;
  }
  on(field: string) { return on(this.f, field); }
}

/** One word or name per line (or comma separated), no empty lines, no repeats. */
export function parseWordList(raw: string, max: number, each: number): string[] {
  return [...new Set(raw.split(/[\n,;،؛]+/).map((w) => w.replace(/\s+/g, " ").trim()).filter((w) => w && w.length <= each))].slice(0, max);
}

/**
 * Reads one section's form. `current` is the client's saved settings, `known` what the page showed as selectable
 * (so a hand-edited form cannot choose a model or voice model that was never offered).
 */
export function parseSection(section: SectionId, f: FormData, current: AgentSettings, known: { llms?: string[]; backups?: string[] } = {}): ParsedSection {
  const r = new Reader(f);
  const d = studioOf(current);
  const out: ParsedSection = { studio: {}, top: {}, errors: r.errors };
  const s = out.studio;
  switch (section) {
    case "model": {
      const llm = val(f, "llm");
      if (llm && (!validModelId(llm) || (known.llms && !known.llms.includes(llm)))) r.bad("llm", "studio.err.model");
      s.llm = llm && validModelId(llm) ? llm : d.llm;
      out.top.temperature = r.num("temperature", LIMITS.temperature, current.temperature, { step: 0.05 });
      s.maxTokens = r.num("maxTokens", [0, LIMITS.maxTokens[1]], d.maxTokens, { zero: true });
      if (s.maxTokens !== 0 && s.maxTokens < LIMITS.maxTokens[0]) { r.bad("maxTokens"); s.maxTokens = d.maxTokens; }
      s.reasoningEffort = r.choice("reasoningEffort", ["", ...CHOICES.reasoningEffort] as const, d.reasoningEffort);
      s.parallelTools = r.on("parallelTools");
      s.backupMode = r.choice("backupMode", CHOICES.backupMode, d.backupMode);
      s.backupModels = f.getAll("backupModels").map(String).filter((m) => validModelId(m) && (!known.backups || known.backups.includes(m))).slice(0, 5);
      if (s.backupMode === "custom" && !s.backupModels.length) r.bad("backupModels", "studio.err.backup");
      s.cascadeSeconds = r.num("cascadeSeconds", LIMITS.cascadeSeconds, d.cascadeSeconds, { step: 0.5 });
      break;
    }
    case "voice": {
      const en = val(f, "voiceEn"), ar = val(f, "voiceAr");
      if (!validVoiceId(en)) r.bad("voiceEn", "studio.err.voice");
      if (!validVoiceId(ar)) r.bad("voiceAr", "studio.err.voice");
      out.top.voiceEn = validVoiceId(en) ? en : current.voiceEn;
      out.top.voiceAr = validVoiceId(ar) ? ar : current.voiceAr;
      s.voiceNotes = { ...d.voiceNotes };
      for (const [id, key] of [[out.top.voiceEn, "voiceEn"], [out.top.voiceAr, "voiceAr"]] as const) {
        const name = val(f, `${key}Name`);
        if (name) {
          const preview = httpsOnly(val(f, `${key}Preview`));
          s.voiceNotes[id] = { name: name.slice(0, 60), gender: val(f, `${key}Gender`).slice(0, 20) || undefined, language: val(f, `${key}Lang`).slice(0, 8) || undefined, accent: val(f, `${key}Accent`).slice(0, 40) || undefined, previewUrl: preview };
        }
      }
      // which voice models suit which language is checked against the catalogue by the caller (lib/agent-catalog.ts)
      s.ttsModelEn = validModelId(val(f, "ttsModelEn")) ? val(f, "ttsModelEn") : (r.bad("ttsModelEn", "studio.err.choice"), d.ttsModelEn);
      s.ttsModelAr = validModelId(val(f, "ttsModelAr")) ? val(f, "ttsModelAr") : (r.bad("ttsModelAr", "studio.err.choice"), d.ttsModelAr);
      s.stability = r.num("stability", LIMITS.stability, d.stability, { step: 0.05 });
      s.similarity = r.num("similarity", LIMITS.similarity, d.similarity, { step: 0.05 });
      s.speed = r.num("speed", LIMITS.speed, d.speed, { step: 0.05 });
      s.textNormalisation = r.choice("textNormalisation", CHOICES.textNormalisation, d.textNormalisation);
      s.expressive = r.on("expressive");
      s.offeredVoices = parseOffered(val(f, "offered"), r) ?? d.offeredVoices;
      break;
    }
    case "conversation": {
      s.turnEagerness = r.choice("turnEagerness", CHOICES.turnEagerness, d.turnEagerness);
      s.turnTimeout = r.num("turnTimeout", LIMITS.turnTimeout, d.turnTimeout, { step: 0.5 });
      s.silenceEndSeconds = r.num("silenceEndSeconds", LIMITS.silenceEndSeconds, d.silenceEndSeconds, { zero: true });
      s.spellingPatience = r.choice("spellingPatience", CHOICES.spellingPatience, d.spellingPatience);
      s.speculativeTurn = r.on("speculativeTurn");
      s.maxDurationSeconds = r.num("maxDurationSeconds", LIMITS.maxDurationSeconds, d.maxDurationSeconds, { step: 30 });
      s.maxDurationMessage = r.str("maxDurationMessage", LIMITS.shortText * 2);
      s.protectGreeting = r.on("protectGreeting");
      s.softTimeoutSeconds = r.num("softTimeoutSeconds", LIMITS.softTimeoutSeconds, d.softTimeoutSeconds, { zero: true, step: 0.5 });
      s.softTimeoutMessageEn = r.str("softTimeoutMessageEn", LIMITS.shortText) || d.softTimeoutMessageEn;
      s.softTimeoutMessageAr = r.str("softTimeoutMessageAr", LIMITS.shortText) || d.softTimeoutMessageAr;
      s.greetingEn = r.para("greetingEn", LIMITS.greeting);
      s.greetingAr = r.para("greetingAr", LIMITS.greeting);
      break;
    }
    case "hearing": {
      s.asrProvider = r.choice("asrProvider", CHOICES.asrProvider, d.asrProvider);
      s.extraKeywords = parseWordList(String(f.get("extraKeywords") ?? ""), LIMITS.keywords[1], LIMITS.keywordLength);
      if (String(f.get("extraKeywords") ?? "").split(/[\n,;،؛]+/).some((w) => w.trim().length > LIMITS.keywordLength)) r.bad("extraKeywords", "studio.err.long");
      break;
    }
    case "safety": {
      s.guardFocus = r.on("guardFocus");
      s.guardInjection = r.on("guardInjection");
      s.recordVoice = r.on("recordVoice");
      s.dailyLimit = r.num("dailyLimit", LIMITS.dailyLimit, d.dailyLimit);
      s.concurrencyLimit = r.num("concurrencyLimit", LIMITS.concurrencyLimit, d.concurrencyLimit, { zero: true });
      s.bursting = r.on("bursting");
      break;
    }
    case "analysis": {
      s.summaryLanguage = r.choice("summaryLanguage", CHOICES.summaryLanguage, d.summaryLanguage);
      s.criteriaOff = f.getAll("criteriaOff").map(String).filter((x) => /^[a-z_]{3,40}$/.test(x)).slice(0, 10);
      break;
    }
    case "widget": {
      const w: WidgetStudio = { ...d.widget };
      w.colors = r.choice("w.colors", CHOICES.widgetColors, d.widget.colors);
      w.bgColor = r.color("w.bgColor", d.widget.bgColor);
      w.textColor = r.color("w.textColor", d.widget.textColor);
      w.borderColor = r.color("w.borderColor", d.widget.borderColor);
      w.btnColor = r.color("w.btnColor", d.widget.btnColor);
      w.btnTextColor = r.color("w.btnTextColor", d.widget.btnTextColor);
      w.variant = r.choice("w.variant", CHOICES.widgetVariant, d.widget.variant);
      w.placement = r.choice("w.placement", CHOICES.widgetPlacement, d.widget.placement);
      w.expandable = r.choice("w.expandable", CHOICES.widgetExpandable, d.widget.expandable);
      w.borderRadius = r.num("w.borderRadius", LIMITS.widgetRadius, d.widget.borderRadius);
      w.btnRadius = r.num("w.btnRadius", LIMITS.widgetRadius, d.widget.btnRadius);
      for (const k of ["actionText", "startCallText", "endCallText", "listeningText", "speakingText"] as const) w[k] = r.str(`w.${k}`, LIMITS.shortText);
      for (const k of ["transcript", "textInput", "micMuting", "languageSelector", "textOnlyMode", "defaultExpanded", "dismissible", "endConfirmation", "showConversationId", "hideBanner"] as const) w[k] = r.on(`w.${k}`);
      w.feedback = r.choice("w.feedback", CHOICES.widgetFeedback, d.widget.feedback);
      s.widget = w;
      break;
    }
  }
  return out;
}

function parseOffered(raw: string, r: Reader): OfferedVoice[] | null {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) throw new Error("not a list");
    if (arr.length > LIMITS.offeredVoices) r.bad("offered", "studio.err.tooMany");
    return dedupeVoices(arr.map(cleanVoice).filter((v): v is OfferedVoice => !!v)).slice(0, LIMITS.offeredVoices);
  } catch {
    r.bad("offered", "studio.err.choice");
    return null;
  }
}

/** The studio and settings after saving one section: the section's values, the section marked as saved. */
export function applySection(cur: AgentSettings, section: SectionId, p: ParsedSection): AgentSettings {
  const d = studioOf(cur);
  const touched = [...new Set([...d.touched, section])];
  return { ...cur, ...p.top, studio: { ...d, ...p.studio, touched } };
}

/** The section back to the defaults, still marked as saved so the defaults are sent explicitly. */
export function resetSection(cur: AgentSettings, section: SectionId): AgentSettings {
  const d = studioOf(cur);
  const base = STUDIO_DEFAULTS;
  const reset: Partial<AgentStudio> = {};
  const keys: Record<SectionId, (keyof AgentStudio)[]> = {
    model: ["llm", "maxTokens", "reasoningEffort", "parallelTools", "backupMode", "backupModels", "cascadeSeconds"],
    voice: ["ttsModelEn", "ttsModelAr", "stability", "similarity", "speed", "textNormalisation", "expressive"],
    conversation: ["turnEagerness", "turnTimeout", "silenceEndSeconds", "spellingPatience", "speculativeTurn", "maxDurationSeconds", "maxDurationMessage", "protectGreeting", "softTimeoutSeconds", "softTimeoutMessageEn", "softTimeoutMessageAr", "greetingEn", "greetingAr"],
    hearing: ["asrProvider", "extraKeywords"],
    safety: ["guardFocus", "guardInjection", "recordVoice", "dailyLimit", "concurrencyLimit", "bursting"],
    analysis: ["summaryLanguage", "criteriaOff"],
    widget: ["widget"],
  };
  for (const k of keys[section]) (reset as Record<string, unknown>)[k] = structuredClone(base[k]);
  // the model section also owns the temperature; the voice section keeps the chosen voices (they are the client's choice, not a tuning)
  const temperature = section === "model" ? 0.3 : cur.temperature;
  return { ...cur, temperature, studio: { ...d, ...reset, touched: [...new Set([...d.touched, section])] } };
}

/** A short plain-English list of what changed, for the version history. */
export function describeStudioChange(before: AgentSettings, after: AgentSettings): string {
  const a = studioOf(before), b = studioOf(after);
  const changed: string[] = [];
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  const note = (label: string, x: unknown, y: unknown) => { if (!same(x, y)) changed.push(label); };
  note(`model ${a.llm || "default"} → ${b.llm || "default"}`, a.llm, b.llm);
  note(`temperature ${before.temperature} → ${after.temperature}`, before.temperature, after.temperature);
  for (const k of ["maxTokens", "reasoningEffort", "parallelTools", "backupMode", "backupModels", "cascadeSeconds"] as const) note(`model option ${k}`, a[k], b[k]);
  note("voice (English)", before.voiceEn, after.voiceEn);
  note("voice (Arabic)", before.voiceAr, after.voiceAr);
  for (const k of ["ttsModelEn", "ttsModelAr", "stability", "similarity", "speed", "textNormalisation", "expressive", "offeredVoices"] as const) note(`voice option ${k}`, a[k], b[k]);
  for (const k of ["turnEagerness", "turnTimeout", "silenceEndSeconds", "spellingPatience", "speculativeTurn", "maxDurationSeconds", "maxDurationMessage", "protectGreeting", "softTimeoutSeconds", "softTimeoutMessageEn", "softTimeoutMessageAr", "greetingEn", "greetingAr"] as const) note(`conversation option ${k}`, a[k], b[k]);
  for (const k of ["asrProvider", "extraKeywords"] as const) note(`hearing option ${k}`, a[k], b[k]);
  for (const k of ["guardFocus", "guardInjection", "recordVoice", "dailyLimit", "concurrencyLimit", "bursting"] as const) note(`safety option ${k}`, a[k], b[k]);
  for (const k of ["summaryLanguage", "criteriaOff"] as const) note(`analysis option ${k}`, a[k], b[k]);
  note("widget look", a.widget, b.widget);
  return `Assistant studio: ${changed.length ? changed.join("; ") : "saved without changes"}`.slice(0, 480);
}
