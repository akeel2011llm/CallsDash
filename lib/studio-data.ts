/**
 * Loads what the model picker needs: ElevenLabs' language models and what each costs for this client's instructions.
 * The live answer is cached for a few minutes (the same prompt size gives the same prices) and the last good answer is
 * kept in the database, so a day when ElevenLabs cannot be reached still shows real model names and last known prices.
 * Takes its data layer and ElevenLabs client as arguments so the tests can feed it fakes.
 */
import { buildPrompt, knowledgeText } from "./agent-config";
import { modelRows, type ModelRow } from "./agent-catalog";
import { explainCatalogError, type CatalogApi, type LlmInfo, type LlmPrice } from "./elevenlabs-catalog";
import { MODELS_KEY, UNKNOWN_MODEL } from "./pricing";
import type { Data } from "./data/demo";

export { MODELS_KEY };
const LLM_TTL_MS = 30 * 60_000;
const PRICE_TTL_MS = 10 * 60_000;
/** Instructions of similar size cost the same, so prices are looked up per 1,000 characters. */
const BUCKET = 1000;

interface Saved { at: string; promptChars: number; llms: LlmInfo[]; prices: LlmPrice[] }
export interface StudioCache { llms?: { at: number; value: LlmInfo[] }; prices: Map<number, { at: number; value: LlmPrice[] }> }
export const newCache = (): StudioCache => ({ prices: new Map() });

export interface ModelBook {
  rows: ModelRow[];
  /** Where the list came from: ElevenLabs just now, the copy saved after the last good answer, or the built-in catalogue. */
  source: "live" | "saved" | "builtin";
  /** When ElevenLabs gave the list (live or saved). */
  at?: string;
  /** True when no ElevenLabs key is set at all. */
  noKey?: boolean;
  /** A sentence that says why ElevenLabs could not be reached. */
  problem?: string;
  /** Why the prices (not the list) are missing, when only they are. */
  priceProblem?: string;
  /** Characters in the client's instructions and knowledge base, the size every price is worked out for. */
  promptChars: number;
}

export interface StudioDeps {
  data: Pick<Data, "getAgent" | "getDoctors" | "getKnowledge" | "getSetting" | "setSetting">;
  catalog: CatalogApi | null;
  cache: StudioCache;
  now?: () => Date;
}

/** The size of the client's instructions plus knowledge base: what ElevenLabs sends the model on every turn. */
export async function promptSize(d: Pick<StudioDeps, "data">, tenantId: string): Promise<number> {
  const [settings, doctors, items] = await Promise.all([d.data.getAgent(tenantId), d.data.getDoctors(tenantId), d.data.getKnowledge(tenantId)]);
  return buildPrompt(settings, doctors).length + knowledgeText(items).length;
}

const isSaved = (v: unknown): v is Saved => !!v && typeof v === "object" && Array.isArray((v as Saved).llms) && Array.isArray((v as Saved).prices) && typeof (v as Saved).at === "string";

export async function loadModelBook(d: StudioDeps, tenantId: string, opts: { force?: boolean; keep?: string[] } = {}): Promise<ModelBook> {
  const now = (d.now ?? (() => new Date()))();
  const today = now.toISOString().slice(0, 10);
  const chars = await promptSize(d, tenantId);
  const rows = (live: LlmInfo[], prices: LlmPrice[]) => modelRows({ live, prices, promptChars: chars, unknown: UNKNOWN_MODEL, keep: opts.keep, today });

  if (!d.catalog) {
    const saved = await d.data.getSetting(MODELS_KEY).catch(() => undefined);
    if (isSaved(saved) && saved.llms.length) return { rows: rows(saved.llms, saved.prices), source: "saved", at: saved.at, noKey: true, promptChars: chars };
    return { rows: rows([], []), source: "builtin", noKey: true, promptChars: chars };
  }

  const bucket = Math.round(chars / BUCKET);
  const stamp = now.getTime();
  const cachedLlms = !opts.force && d.cache.llms && stamp - d.cache.llms.at < LLM_TTL_MS ? d.cache.llms.value : undefined;
  const cachedPrices = !opts.force ? d.cache.prices.get(bucket) : undefined;
  const freshPrices = cachedPrices && stamp - cachedPrices.at < PRICE_TTL_MS ? cachedPrices.value : undefined;

  const [llmsRes, pricesRes] = await Promise.allSettled([
    cachedLlms ? Promise.resolve(cachedLlms) : d.catalog.listLlms(),
    freshPrices ? Promise.resolve(freshPrices) : d.catalog.llmPrices({ promptLength: bucket * BUCKET, numberOfPages: 0, ragEnabled: false }),
  ]);

  if (llmsRes.status === "fulfilled" && llmsRes.value.length) {
    const llms = llmsRes.value;
    d.cache.llms = { at: cachedLlms ? d.cache.llms!.at : stamp, value: llms };
    let prices: LlmPrice[] = [];
    let priceProblem: string | undefined;
    if (pricesRes.status === "fulfilled") {
      prices = pricesRes.value;
      d.cache.prices.set(bucket, { at: freshPrices ? cachedPrices!.at : stamp, value: prices });
    } else {
      priceProblem = explainCatalogError(pricesRes.reason);
      const saved = await d.data.getSetting(MODELS_KEY).catch(() => undefined);
      if (isSaved(saved)) prices = saved.prices; // last known prices are better than none
    }
    if (!cachedLlms || !freshPrices) {
      if (pricesRes.status === "fulfilled") await d.data.setSetting(MODELS_KEY, { at: now.toISOString(), promptChars: chars, llms, prices } satisfies Saved).catch(() => undefined);
    }
    return { rows: rows(llms, prices), source: "live", at: now.toISOString(), priceProblem, promptChars: chars };
  }

  const problem = llmsRes.status === "rejected" ? explainCatalogError(llmsRes.reason) : "ElevenLabs sent an empty model list.";
  const saved = await d.data.getSetting(MODELS_KEY).catch(() => undefined);
  if (isSaved(saved) && saved.llms.length) return { rows: rows(saved.llms, saved.prices), source: "saved", at: saved.at, problem, promptChars: chars };
  return { rows: rows([], []), source: "builtin", problem, promptChars: chars };
}
