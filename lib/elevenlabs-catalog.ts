/**
 * What ElevenLabs offers, read live: the voices on the account, the public voice library, the language models with their
 * prices, and the settings the client's agent really has. Used by the Assistant studio (admin only). Takes a `fetch` so
 * tests can feed it recorded answers. Every field is read defensively: a missing or renamed field leaves a blank, it never
 * stops the page.
 */
import { ElevenLabsError, elevenLabsRequester } from "./elevenlabs-api";

type FetchLike = typeof fetch;
type Json = Record<string, unknown>;

const TIMEOUT_MS = 8000;

/* ---------- shapes the screens use ---------- */

export interface CatalogVoice {
  id: string;
  name: string;
  /** Where it was found: the account's own voices, or the public library (must be added to the account before an agent can speak with it). */
  source: "account" | "library";
  /** Library voices only: needed to add the voice to the account. */
  publicOwnerId?: string;
  /** premade, cloned, generated, professional, high_quality ... */
  category?: string;
  gender?: string;
  age?: string;
  accent?: string;
  /** Main language code such as "en" or "ar". */
  language?: string;
  /** Every language the voice is verified for, with the model it was checked on. */
  languages: { language: string; accent?: string; modelId?: string }[];
  useCase?: string;
  descriptive?: string;
  description?: string;
  previewUrl?: string;
  /** Library voices may charge extra credits per character. */
  rate?: number;
}

export interface VoicePage { voices: CatalogVoice[]; hasMore: boolean; next?: string }

export interface VoiceQuery {
  search?: string;
  language?: string;
  gender?: string;
  accent?: string;
  category?: string;
  useCase?: string;
  pageSize?: number;
  /** Account voices: the token ElevenLabs returned. Library voices: the page number as text. */
  next?: string;
}

export interface LlmInfo {
  id: string;
  maxOutputTokens?: number;
  contextTokens?: number;
  supportsParallelTools?: boolean;
  supportsImages?: boolean;
  reasoningEfforts: string[];
  /** True when ElevenLabs has retired the model or will soon; `replacement` is where its traffic goes. */
  deprecated?: { isDeprecated: boolean; inWarning: boolean; replacement?: string; date?: string };
  /** An extra percentage charged for processing in a particular region, when ElevenLabs says one applies. */
  regionalSurcharge?: string;
}

/** ElevenLabs' expected LLM cost for one voice minute and one chat message, in US dollars, for a given prompt size. */
export interface LlmPrice { llm: string; perMinute: number; perMessage: number }

export interface PriceInput { promptLength: number; numberOfPages: number; ragEnabled: boolean }

/** The few fields of the live agent the Assistant studio compares with what CallsDash has saved. */
export interface LiveAgent {
  name?: string;
  llm?: string;
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: string;
  language?: string;
  voiceId?: string;
  ttsModel?: string;
  arabicVoiceId?: string;
  arabicTtsModel?: string;
  stability?: number;
  similarityBoost?: number;
  speed?: number;
  turnEagerness?: string;
  turnTimeout?: number;
  silenceEndCallTimeout?: number;
  maxDurationSeconds?: number;
  asrProvider?: string;
  dailyLimit?: number;
  recordVoice?: boolean;
  retentionDays?: number;
  toolCount?: number;
  guardrailsFocus?: boolean;
  guardrailsPromptInjection?: boolean;
  /** The widget's "Powered by" line is switched off (platform_settings.widget.disable_banner). */
  disableBanner?: boolean;
}

export interface CatalogApi {
  searchVoices(q: VoiceQuery): Promise<VoicePage>;
  searchLibrary(q: VoiceQuery): Promise<VoicePage>;
  /** Voices by id, for showing the name and preview of the ones already chosen. Ids ElevenLabs does not know are left out. */
  getVoices(ids: string[]): Promise<CatalogVoice[]>;
  /** Copies a library voice into the account; returns the account's voice id (the same id in practice). */
  addLibraryVoice(input: { publicOwnerId: string; voiceId: string; name: string }): Promise<{ voiceId: string }>;
  listLlms(): Promise<LlmInfo[]>;
  llmPrices(input: PriceInput): Promise<LlmPrice[]>;
  getAgent(agentId: string): Promise<LiveAgent>;
}

/* ---------- reading ElevenLabs' answers ---------- */

const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);

/** Preview audio is played straight from the address ElevenLabs gives; anything but https is dropped. */
const safeUrl = (v: unknown): string | undefined => {
  const s = str(v);
  if (!s) return undefined;
  try { return new URL(s).protocol === "https:" ? s : undefined; } catch { return undefined; }
};

function verifiedLanguages(v: unknown): CatalogVoice["languages"] {
  return arr(v).map((x) => obj(x)).flatMap((x) => {
    const language = str(x.language);
    return language ? [{ language, accent: str(x.accent), modelId: str(x.model_id) }] : [];
  });
}

export function mapAccountVoice(raw: unknown): CatalogVoice | null {
  const v = obj(raw);
  const id = str(v.voice_id);
  if (!id) return null;
  const labels = obj(v.labels);
  const languages = verifiedLanguages(v.verified_languages);
  const language = str(labels.language) ?? languages[0]?.language;
  return {
    id, name: str(v.name) ?? id, source: "account", category: str(v.category),
    gender: str(labels.gender), age: str(labels.age), accent: str(labels.accent), language,
    languages: languages.length ? languages : language ? [{ language }] : [],
    useCase: str(labels.use_case) ?? str(labels.usecase), descriptive: str(labels.descriptive) ?? str(labels.descriptives),
    description: str(v.description), previewUrl: safeUrl(v.preview_url),
  };
}

export function mapLibraryVoice(raw: unknown): CatalogVoice | null {
  const v = obj(raw);
  const id = str(v.voice_id);
  if (!id) return null;
  const languages = verifiedLanguages(v.verified_languages);
  const language = str(v.language) ?? languages[0]?.language;
  return {
    id, name: str(v.name) ?? id, source: "library", publicOwnerId: str(v.public_owner_id), category: str(v.category),
    gender: str(v.gender), age: str(v.age), accent: str(v.accent), language,
    languages: languages.length ? languages : language ? [{ language }] : [],
    useCase: str(v.use_case), descriptive: str(v.descriptive), description: str(v.description), previewUrl: safeUrl(v.preview_url), rate: num(v.rate),
  };
}

export function mapLlm(raw: unknown): LlmInfo | null {
  const m = obj(raw);
  const id = str(m.llm);
  if (!id) return null;
  const dep = obj(m.deprecation_info);
  const surcharge = obj(m.regional_processing_surcharge);
  return {
    id, maxOutputTokens: num(m.max_tokens_limit), contextTokens: num(m.max_context_limit),
    supportsParallelTools: bool(m.supports_parallel_tool_calls), supportsImages: bool(m.supports_image_input),
    reasoningEfforts: arr(m.available_reasoning_efforts).filter((x): x is string => typeof x === "string"),
    deprecated: Object.keys(dep).length
      ? { isDeprecated: dep.is_deprecated === true, inWarning: dep.is_in_warning_period === true, replacement: str(dep.replacement_model), date: str(dep.provider_deprecation_date) }
      : undefined,
    regionalSurcharge: Object.keys(surcharge).length ? JSON.stringify(surcharge).slice(0, 120) : undefined,
  };
}

export function mapPrices(raw: unknown): LlmPrice[] {
  return arr(obj(raw).llm_prices).map((x) => obj(x)).flatMap((x) => {
    const llm = str(x.llm), perMinute = num(x.price_per_minute), perMessage = num(x.price_per_message);
    return llm && perMinute !== undefined && perMessage !== undefined ? [{ llm, perMinute, perMessage }] : [];
  });
}

export function mapLiveAgent(raw: unknown): LiveAgent {
  const a = obj(raw);
  const cc = obj(a.conversation_config);
  const agent = obj(cc.agent);
  const prompt = obj(agent.prompt);
  const tts = obj(cc.tts);
  const turn = obj(cc.turn);
  const asr = obj(cc.asr);
  const ar = obj(obj(obj(obj(cc.language_presets).ar).overrides).tts);
  const ps = obj(a.platform_settings);
  const guard = obj(ps.guardrails);
  const tools = obj(prompt.built_in_tools);
  return {
    name: str(a.name), llm: str(prompt.llm), temperature: num(prompt.temperature), maxTokens: num(prompt.max_tokens), reasoningEffort: str(prompt.reasoning_effort),
    language: str(agent.language), voiceId: str(tts.voice_id), ttsModel: str(tts.model_id), arabicVoiceId: str(ar.voice_id), arabicTtsModel: str(ar.model_id),
    stability: num(tts.stability), similarityBoost: num(tts.similarity_boost), speed: num(tts.speed),
    turnEagerness: str(turn.turn_eagerness), turnTimeout: num(turn.turn_timeout), silenceEndCallTimeout: num(turn.silence_end_call_timeout),
    maxDurationSeconds: num(obj(cc.conversation).max_duration_seconds), asrProvider: str(asr.provider),
    dailyLimit: num(obj(ps.call_limits).daily_limit), recordVoice: bool(obj(ps.privacy).record_voice), retentionDays: num(obj(ps.privacy).retention_days),
    toolCount: arr(prompt.tool_ids).length + Object.values(tools).filter((t) => obj(t).name || obj(t).type).length,
    guardrailsFocus: bool(obj(guard.focus).is_enabled), guardrailsPromptInjection: bool(obj(guard.prompt_injection).is_enabled),
    disableBanner: bool(obj(ps.widget).disable_banner),
  };
}

/* ---------- the client ---------- */

function query(params: Record<string, string | number | boolean | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function createCatalogApi(apiKey: string, fetchImpl: FetchLike = fetch): CatalogApi {
  const call = elevenLabsRequester(apiKey, fetchImpl);
  const get = <T>(path: string) => call<T>("GET", path, undefined, { timeoutMs: TIMEOUT_MS });
  const page = (voices: (CatalogVoice | null)[], hasMore: boolean, next?: string): VoicePage => ({ voices: voices.filter((v): v is CatalogVoice => !!v), hasMore, next });

  return {
    async searchVoices(q) {
      const r = obj(await get(`/v2/voices${query({
        search: q.search, language: q.language, gender: q.gender, accent: q.accent, category: q.category, use_cases: q.useCase,
        page_size: Math.min(100, Math.max(1, q.pageSize ?? 30)), next_page_token: q.next, include_total_count: false,
      })}`));
      return page(arr(r.voices).map(mapAccountVoice), r.has_more === true, str(r.next_page_token));
    },
    async searchLibrary(q) {
      const pageNo = Math.max(0, Number(q.next) || 0);
      const r = obj(await get(`/v1/shared-voices${query({
        search: q.search, language: q.language, gender: q.gender, accent: q.accent, category: q.category, use_cases: q.useCase,
        page_size: Math.min(100, Math.max(1, q.pageSize ?? 30)), page: pageNo, sort: "trending",
        // ElevenLabs does not let agents speak with voices under live moderation, and a few old voices charge extra credits per character
        include_live_moderated: false, include_custom_rates: false,
      })}`));
      const hasMore = r.has_more === true;
      return page(arr(r.voices).map(mapLibraryVoice), hasMore, hasMore ? String(pageNo + 1) : undefined);
    },
    async getVoices(ids) {
      const wanted = [...new Set(ids.filter(Boolean))].slice(0, 100);
      if (!wanted.length) return [];
      const q = new URLSearchParams();
      for (const id of wanted) q.append("voice_ids", id);
      q.set("page_size", String(wanted.length));
      const r = obj(await get(`/v2/voices?${q}`));
      return arr(r.voices).map(mapAccountVoice).filter((v): v is CatalogVoice => !!v);
    },
    async addLibraryVoice({ publicOwnerId, voiceId, name }) {
      const r = obj(await call("POST", `/v1/voices/add/${encodeURIComponent(publicOwnerId)}/${encodeURIComponent(voiceId)}`, { new_name: name.slice(0, 100) }, { timeoutMs: 20000 }));
      return { voiceId: str(r.voice_id) ?? voiceId };
    },
    async listLlms() {
      return arr(obj(await get("/v1/convai/llm/list")).llms).map(mapLlm).filter((m): m is LlmInfo => !!m);
    },
    async llmPrices(input) {
      return mapPrices(await call("POST", "/v1/convai/llm-usage/calculate", {
        prompt_length: Math.max(0, Math.round(input.promptLength)), number_of_pages: Math.max(0, Math.round(input.numberOfPages)), rag_enabled: input.ragEnabled,
      }, { timeoutMs: TIMEOUT_MS }));
    },
    async getAgent(agentId) {
      return mapLiveAgent(await get(`/v1/convai/agents/${encodeURIComponent(agentId)}`));
    },
  };
}

export const catalogFromEnv = (): CatalogApi | null => (process.env.ELEVENLABS_API_KEY ? createCatalogApi(process.env.ELEVENLABS_API_KEY) : null);

/** A sentence an admin can act on, for the usual reasons ElevenLabs says no. */
export function explainCatalogError(e: unknown): string {
  if (e instanceof ElevenLabsError) {
    if (e.status === 401) return "ElevenLabs did not accept the API key. Create a new key in ElevenLabs and paste it into Vercel as ELEVENLABS_API_KEY.";
    if (e.status === 403 || /missing_permissions/i.test(e.detail)) return "The ElevenLabs API key is not allowed to do this. In ElevenLabs open the key and switch on Voices (read) and Agents (read and write).";
    if (e.status === 429) return "ElevenLabs asked us to slow down. Wait a minute and try again.";
    if (e.status >= 500) return "ElevenLabs is having a problem right now. Try again in a few minutes.";
    return e.message.slice(0, 240);
  }
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) return "ElevenLabs took too long to answer. Try again.";
  return e instanceof Error ? e.message.slice(0, 240) : "Something went wrong talking to ElevenLabs.";
}
