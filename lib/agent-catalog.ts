/**
 * What the Assistant studio knows about ElevenLabs' language models and voice models without asking: names, who makes
 * them, what ElevenLabs advises about them, their price per million tokens and a built-in estimate of what that costs per
 * voice minute and per chat message. The live model list and ElevenLabs' own price calculator (lib/elevenlabs-catalog.ts)
 * always win over this; this only fills the gaps, so the screen is useful even when ElevenLabs cannot be reached.
 *
 * Prices are US dollars per million tokens from ElevenLabs' price reference of 2026-10-21 and change when the providers
 * change them; the screens always say whether a number is ElevenLabs' or our estimate.
 */
import type { LlmInfo, LlmPrice } from "./elevenlabs-catalog";
import { UNKNOWN_MODEL } from "./pricing";

export type Provider = "google" | "openai" | "anthropic" | "elevenlabs" | "open" | "custom";
/** ElevenLabs' own advice in its prompting guide: a good place to start, the lowest delay, the most accurate. */
export type Advice = "start" | "fastest" | "accurate";

export interface LlmMeta {
  id: string;
  label: string;
  provider: Provider;
  advice?: Advice;
  /** US dollars per million tokens: new input, output, cached input. */
  usd?: [number, number, number];
}

export const PROVIDER_LABEL: Record<Provider, string> = { google: "Google", openai: "OpenAI", anthropic: "Anthropic", elevenlabs: "ElevenLabs", open: "Open model", custom: "Your own" };

const m = (id: string, label: string, provider: Provider, usd: [number, number, number], advice?: Advice): LlmMeta => ({ id, label, provider, usd, advice });

/** The models worth listing. Anything else ElevenLabs offers is still selectable, with a label made from its id. */
export const LLM_CATALOG: LlmMeta[] = [
  m("gpt-6-luna", "GPT-6 Luna", "openai", [0.1, 0.5, 0.01], "start"),
  m("glm-52", "GLM 5.2", "elevenlabs", [1.5, 30, 0.75], "start"),
  m("deepseek-v41-flash", "DeepSeek V4.1 Flash", "elevenlabs", [0.55, 15, 0.28], "fastest"),
  m("gemini-3.5-flash-lite", "Gemini 3.5 Flash Lite", "google", [0.33, 2.75, 0.03], "fastest"),
  m("claude-sonnet-5-5", "Claude Sonnet 5.5", "anthropic", [2.2, 11, 0.11], "accurate"),
  m("gpt-6-sol", "GPT-6 Sol", "openai", [2, 10, 0.2]),
  m("gpt-6.1-sol", "GPT-6.1 Sol", "openai", [2, 10, 0.1]),
  m("gpt-6-astra", "GPT-6 Astra", "openai", [10, 50, 1]),
  m("gpt-5.6-luna", "GPT-5.6 Luna", "openai", [0.2, 1.2, 0.02]),
  m("gpt-5.6-terra", "GPT-5.6 Terra", "openai", [2, 12, 0.2]),
  m("gpt-5.6-sol", "GPT-5.6 Sol", "openai", [4, 20, 0.4]),
  m("gpt-5.5", "GPT-5.5", "openai", [5, 30, 0.5]),
  m("gpt-5.4", "GPT-5.4", "openai", [2.5, 15, 0.25]),
  m("gpt-5.4-mini", "GPT-5.4 mini", "openai", [0.75, 4.5, 0.08]),
  m("gpt-5.4-nano", "GPT-5.4 nano", "openai", [0.2, 1.25, 0.02]),
  m("gpt-5.2", "GPT-5.2", "openai", [1.75, 14, 0.18]),
  m("gpt-5.1", "GPT-5.1", "openai", [1.25, 10, 0.13]),
  m("gpt-5", "GPT-5", "openai", [1.25, 10, 0.13]),
  m("gpt-5-mini", "GPT-5 mini", "openai", [0.25, 2, 0.03]),
  m("gpt-5-nano", "GPT-5 nano", "openai", [0.05, 0.4, 0.005]),
  m("gpt-4.1", "GPT-4.1", "openai", [2, 8, 0.5]),
  m("gpt-4.1-mini", "GPT-4.1 mini", "openai", [0.4, 1.6, 0.1]),
  m("gpt-4.1-nano", "GPT-4.1 nano", "openai", [0.1, 0.4, 0.03]),
  m("gpt-4o", "GPT-4o", "openai", [2.5, 10, 1.25]),
  m("gpt-4o-mini", "GPT-4o mini", "openai", [0.15, 0.6, 0.08]),
  m("gemini-3.8-flash", "Gemini 3.8 Flash", "google", [0.83, 4.13, 0.08]),
  m("gemini-3.7-flash", "Gemini 3.7 Flash", "google", [0.83, 4.13, 0.08]),
  m("gemini-3.6-flash", "Gemini 3.6 Flash", "google", [0.83, 4.13, 0.08]),
  m("gemini-3.5-flash", "Gemini 3.5 Flash", "google", [1.65, 9.9, 0.17]),
  m("gemini-3.1-flash-lite", "Gemini 3.1 Flash Lite", "google", [0.28, 1.65, 0.03]),
  m("gemini-3.1-pro-preview", "Gemini 3.1 Pro (preview)", "google", [2, 12, 0.2]),
  m("gemini-3-flash-preview", "Gemini 3 Flash (preview)", "google", [0.5, 3, 0.05]),
  m("gemini-2.5-flash", "Gemini 2.5 Flash", "google", [0.3, 2.5, 0.03]),
  m("gemini-2.5-flash-lite", "Gemini 2.5 Flash Lite", "google", [0.1, 0.4, 0]),
  m("claude-sonnet-5", "Claude Sonnet 5", "anthropic", [2.2, 11, 0.22]),
  m("claude-sonnet-4-6", "Claude Sonnet 4.6", "anthropic", [3.3, 16.5, 0.33]),
  m("claude-sonnet-4-5", "Claude Sonnet 4.5", "anthropic", [3.3, 16.5, 0.33]),
  m("claude-haiku-5-5", "Claude Haiku 5.5", "anthropic", [0.11, 0.55, 0.01]),
  m("claude-haiku-4-5", "Claude Haiku 4.5", "anthropic", [1.1, 5.5, 0.11]),
  m("claude-opus-5-5", "Claude Opus 5.5", "anthropic", [4.4, 22, 0.22]),
  m("claude-opus-5", "Claude Opus 5", "anthropic", [5.5, 27.5, 0.55]),
  m("claude-opus-4-8", "Claude Opus 4.8", "anthropic", [5.5, 27.5, 0.55]),
  m("claude-opus-4-7", "Claude Opus 4.7", "anthropic", [5.5, 27.5, 0.55]),
  m("qwen36-35b-a3b", "Qwen 3.6 35B", "elevenlabs", [0.13, 5, 0.07]),
  m("qwen35-397b-a17b", "Qwen 3.5 397B", "elevenlabs", [0.63, 15, 0.32]),
];

const byId = new Map(LLM_CATALOG.map((x) => [x.id, x]));

/** The day each provider shuts a model down, where it has announced one (checked 2026-10-21). ElevenLabs' live list overrides. */
export const RETIRES: Record<string, string> = {
  "gpt-4.1-nano": "2026-10-23", "gpt-4-turbo": "2026-10-23", "gpt-4": "2026-10-23", "gpt-3.5-turbo": "2026-10-23",
  "gpt-5": "2026-12-11", "gpt-5-mini": "2026-12-11", "gpt-5-nano": "2026-12-11",
  "gpt-4o": "2027-01-14", "gpt-4o-mini": "2027-01-14", "gpt-4.1": "2027-01-14", "gpt-4.1-mini": "2027-01-14",
  "gpt-5.1": "2027-04-01", "gpt-5.4-nano": "2027-04-01",
  "claude-sonnet-4-5": "2026-11-30",
  "gemini-3.1-flash-lite": "2027-05-07",
};

/** Whole days from `today` (a YYYY-MM-DD date) until the model's announced shutdown; null when none is announced. */
export function daysToRetirement(id: string, today: string): number | null {
  const d = RETIRES[id];
  if (!d) return null;
  return Math.round((Date.parse(d) - Date.parse(today)) / 86_400_000);
}

/** The model an assistant uses until an admin picks one: ELEVENLABS_LLM on the server, else Gemini 2.5 Flash. */
export const defaultLlm = () => process.env.ELEVENLABS_LLM || "gemini-2.5-flash";

/** Anthropic's models from 4.7 on reject a custom temperature, so the agent is told to leave it out for them. */
export const acceptsTemperature = (id: string) => !/^claude-(opus-4-[7-9]|opus-[5-9]|sonnet-[5-9]|haiku-[5-9])/i.test(id);

/** Who makes a model, from its id. */
export function providerOf(id: string): Provider {
  if (/^(gpt-oss|glm|deepseek|qwen|nemotron|watt)/i.test(id)) return "elevenlabs";
  if (/^(gpt|o\d|chatgpt)/i.test(id)) return "openai";
  if (/^gemini/i.test(id)) return "google";
  if (/^claude/i.test(id)) return "anthropic";
  if (id === "custom-llm") return "custom";
  return "open";
}

/** A readable name made from an id such as "gpt-5.4-mini" or "claude-sonnet-5-5", for models the catalogue does not list. */
export function prettyModel(id: string): string {
  const words = id.replace(/@.*$/, "").split("-");
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (/^\d+$/.test(w) && /^\d$/.test(words[i + 1] ?? "") && /^claude$/i.test(words[0])) { out.push(`${w}.${words[i + 1]}`); i++; continue; }
    if (/^gpt$/i.test(w)) out.push("GPT");
    else if (/^(llm|ai|vl)$/i.test(w)) out.push(w.toUpperCase());
    else if (/^\d/.test(w)) out.push(w);
    else out.push(w.charAt(0).toUpperCase() + w.slice(1));
  }
  return out.join(" ").replace(/^GPT (\d)/, "GPT-$1").replace(/^GPT (OSS)/i, "GPT-OSS");
}

export function llmMeta(id: string): LlmMeta {
  return byId.get(id) ?? { id, label: prettyModel(id), provider: providerOf(id) };
}

/** Dated copies of a model ("gpt-4o-2024-11-20") are pinned versions; the screens hide them unless one is in use. */
export const isCheckpoint = (id: string) => /(-\d{4}-\d{2}-\d{2}|@\d{8}|-\d{3,4}$|-preview-\d)/.test(id);

/* ---------- what a model costs ---------- */

/**
 * How a typical conversation uses the model, for the built-in estimate. A caller speaks about every ten seconds, so a voice
 * minute is about six turns; each turn sends the whole instructions again (mostly from the provider's cache), a little
 * conversation so far, and a short spoken answer. A chat message is one such turn with a longer history and a longer answer.
 */
export const USAGE = {
  turnsPerMinute: 6, charsPerToken: 4, toolTokens: 600, cachedShare: 0.8,
  voice: { historyTokens: 300, outputTokens: 60 },
  chat: { historyTokens: 500, outputTokens: 90 },
} as const;

/** Language-model cost in US dollars of one turn, from the price per million tokens and the size of the instructions in characters. */
function turnUsd(usd: [number, number, number], promptChars: number, kind: "voice" | "chat"): number {
  const [pIn, pOut, pCache] = usd;
  const u = USAGE[kind];
  const prompt = Math.ceil(promptChars / USAGE.charsPerToken) + USAGE.toolTokens;
  const input = prompt * ((1 - USAGE.cachedShare) * pIn + USAGE.cachedShare * pCache) + u.historyTokens * pIn;
  return (input + u.outputTokens * pOut) / 1_000_000;
}

export function estimateUsd(usd: [number, number, number], promptChars: number): { perMinute: number; perMessage: number } {
  return { perMinute: USAGE.turnsPerMinute * turnUsd(usd, promptChars, "voice"), perMessage: turnUsd(usd, promptChars, "chat") };
}

/** Where a price came from: ElevenLabs' own calculator, our estimate from the price per million tokens, or a guess for a model we know nothing about. */
export type PriceSource = "elevenlabs" | "estimate" | "unknown";

export interface ModelRow {
  id: string;
  label: string;
  provider: Provider;
  advice?: Advice;
  maxOutputTokens?: number;
  contextTokens?: number;
  parallelTools?: boolean;
  reasoningEfforts: string[];
  /** ElevenLabs' live deprecation state, if it reports one. */
  deprecated?: LlmInfo["deprecated"];
  /** The provider's announced shutdown date, when there is one. */
  retires?: string;
  /** False when the model ignores a custom temperature. */
  temperature: boolean;
  /** The language-model share of one voice minute and one chat message, in US dollars. */
  price: { perMinute: number; perMessage: number; source: PriceSource };
  /** US dollars per million tokens (new input, output, cached input), where known. */
  tokens?: [number, number, number];
}

export interface RowsInput {
  live: LlmInfo[];
  prices: LlmPrice[];
  /** Characters in the client's instructions plus knowledge base, which sets the size of every turn. */
  promptChars: number;
  /** Assumed for a model with no price at all. */
  unknown: { perMinute: number; perMessage: number };
  /** Models in use that must stay listed even if they are old or pinned. */
  keep?: string[];
  /** Today's date, YYYY-MM-DD. */
  today: string;
}

/**
 * The rows of the model picker. With ElevenLabs' live list it is that list (minus retired models and pinned copies);
 * without it, the built-in catalogue. Every row carries the best price available: ElevenLabs' calculator, else the estimate.
 */
/** What a model costs per voice minute and per message: ElevenLabs' own figure when it gave one, else our estimate, else a guess. */
export function priceFor(id: string, live: LlmPrice | undefined, promptChars: number, unknown: { perMinute: number; perMessage: number }): ModelRow["price"] {
  if (live) return { perMinute: live.perMinute, perMessage: live.perMessage, source: "elevenlabs" };
  const meta = llmMeta(id);
  return meta.usd ? { ...estimateUsd(meta.usd, promptChars), source: "estimate" } : { ...unknown, source: "unknown" };
}

export function modelRows(i: RowsInput): ModelRow[] {
  const keep = new Set((i.keep ?? []).filter(Boolean));
  const priceOf = new Map(i.prices.map((p) => [p.llm, p]));
  const liveOf = new Map(i.live.map((x) => [x.id, x]));
  const ids = i.live.length ? i.live.map((x) => x.id).filter((id) => id !== "custom-llm") : LLM_CATALOG.map((x) => x.id);
  for (const id of keep) if (!ids.includes(id)) ids.push(id);
  const rows: ModelRow[] = [];
  for (const id of ids) {
    const info = liveOf.get(id);
    const days = daysToRetirement(id, i.today);
    const gone = info?.deprecated?.isDeprecated === true || (days !== null && days < 0);
    if (!keep.has(id) && (gone || (i.live.length > 0 && isCheckpoint(id)))) continue;
    const meta = llmMeta(id);
    const price = priceFor(id, priceOf.get(id), i.promptChars, i.unknown);
    rows.push({
      id, label: meta.label, provider: meta.provider, advice: meta.advice,
      maxOutputTokens: info?.maxOutputTokens, contextTokens: info?.contextTokens, parallelTools: info?.supportsParallelTools,
      reasoningEfforts: info?.reasoningEfforts ?? [], deprecated: info?.deprecated, retires: RETIRES[id],
      temperature: acceptsTemperature(id), price, tokens: meta.usd,
    });
  }
  // ElevenLabs' recommendations first, then the cheapest
  return rows.sort((a, b) => Number(!!b.advice) - Number(!!a.advice) || a.price.perMinute - b.price.perMinute || a.label.localeCompare(b.label));
}

/** The row for a model id; a model the list does not hold (an old setting, a custom id) gets a stand-in with the unknown-model price. */
export function rowFor(rows: ModelRow[], id: string): ModelRow {
  const found = rows.find((r) => r.id === id);
  if (found) return found;
  const meta = llmMeta(id);
  return { id, label: meta.label, provider: meta.provider, reasoningEfforts: [], temperature: acceptsTemperature(id), price: { ...UNKNOWN_MODEL, source: "unknown" } };
}

/* ---------- voice models ---------- */

export interface TtsMeta {
  id: string;
  label: string;
  /** Whether ElevenLabs accepts it for the assistant's English side and its Arabic side. */
  english: boolean;
  arabic: boolean;
  /** Time to the first sound, as ElevenLabs states it; blank where it states none. */
  latency: string;
  /** Takes part in expressive mode (the v3 and v4 voices). */
  expressive?: boolean;
  /** Retired or about to be: never offered, but shown while a client still uses it. */
  deprecated?: boolean;
  /** Made for recorded audio rather than live calls. */
  recordedOnly?: boolean;
}

/**
 * ElevenLabs' voice models for agents, from its model list (2026-10): `eleven_v4_turbo` is the new default, the Flash models
 * are the fastest, and an English-only model can never speak Arabic. The plain-language note for each is the translation
 * key `studio.tts.<id>`.
 *
 * The English side is stricter than the list suggests: on the first real sync (2026-10-21) ElevenLabs answered 400 to
 * `eleven_flash_v2_5` for an assistant whose main language is English and accepted `eleven_flash_v2`. So the English side lists
 * only that model and the newest ones ElevenLabs names as its defaults (not yet tried on a real account, so a refusal is
 * shown and nothing is saved); the multilingual v2 and v2.5 models are for the Arabic side.
 */
export const TTS_MODELS: TtsMeta[] = [
  { id: "eleven_flash_v2", label: "Flash v2", english: true, arabic: false, latency: "~75 ms" },
  { id: "eleven_flash_v2_5", label: "Flash v2.5", english: false, arabic: true, latency: "~75 ms" },
  { id: "eleven_multilingual_v2", label: "Multilingual v2", english: false, arabic: true, latency: "" },
  { id: "eleven_v3_conversational", label: "v3 Conversational", english: true, arabic: true, latency: "~280 ms", expressive: true },
  { id: "eleven_v4_turbo", label: "v4 Turbo", english: true, arabic: true, latency: "~100 ms", expressive: true },
  { id: "eleven_v4", label: "v4", english: true, arabic: true, latency: "", expressive: true, recordedOnly: true },
  { id: "eleven_turbo_v2", label: "Turbo v2", english: true, arabic: false, latency: "", deprecated: true },
  { id: "eleven_turbo_v2_5", label: "Turbo v2.5", english: false, arabic: true, latency: "", deprecated: true },
];

export const ttsMeta = (id: string): TtsMeta | undefined => TTS_MODELS.find((x) => x.id === id);

/** Retired models and the ones made for recordings are not offered for live calls, but a client that already has one keeps it listed. */
const offered = (m: TtsMeta, current?: string) => (!m.deprecated && !m.recordedOnly) || m.id === current;

/** The models to list for one side of the assistant. */
export function ttsFor(lang: "en" | "ar", current?: string): TtsMeta[] {
  return TTS_MODELS.filter((x) => (lang === "en" ? x.english : x.arabic) && offered(x, current));
}

/** True when `id` may be chosen for this side: a listed model that speaks the language, or the one the client already has. */
export function ttsAllowed(lang: "en" | "ar", id: string, current?: string): boolean {
  const meta = ttsMeta(id);
  if (meta) return (lang === "en" ? meta.english : meta.arabic) && offered(meta, current);
  return id === current && lang === "en"; // an unknown model is kept as it is, but never put on the Arabic side
}

/** Voices ElevenLabs has retired or plans to retire, which CallsDash used as its first stand-ins. They still work today. */
export const OLDER_VOICE_IDS: Record<string, string> = {
  "21m00Tcm4TlvDq8ikWAM": "Rachel",
  pNInz6obpgDQGcFmaJgB: "Adam",
};
