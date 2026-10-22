import "server-only";
import * as store from "./data";
import { appUrl } from "./app-url";
import type { SyncDeps } from "./agent-sync";
import { elevenLabsFromEnv } from "./elevenlabs-api";
import { catalogFromEnv } from "./elevenlabs-catalog";
import { badHeaderSetting } from "./header-safe";
import { cleanFees, FEES_KEY, type Fees } from "./pricing";
import { loadModelBook, newCache, type ModelBook, type StudioCache } from "./studio-data";

/** The Assistant studio's server side: what it needs from this app's data, the environment and ElevenLabs. */

const g = globalThis as unknown as { __callsdashStudio?: StudioCache };
const cache = () => (g.__callsdashStudio ??= newCache());

/** The model list and prices for one client, from ElevenLabs when it can be reached. Never throws. */
export const modelBook = (tenantId: string, opts: { force?: boolean; keep?: string[] } = {}): Promise<ModelBook> =>
  loadModelBook({ data: store, catalog: catalogFromEnv(), cache: cache() }, tenantId, opts);

export const clearStudioCache = () => { g.__callsdashStudio = newCache(); };

export const loadFees = async (): Promise<Fees> => cleanFees(await store.getSetting(FEES_KEY).catch(() => undefined));

type NotReady = "no_api_key" | "no_secret" | "bad_secret" | "no_app_url";

/** Everything a sync needs, or the reason it cannot run yet. The same checks as the Sync button on the Channels page. */
export async function syncSetup(): Promise<SyncDeps | NotReady> {
  const api = elevenLabsFromEnv();
  if (!api) return "no_api_key";
  const tools = process.env.AGENT_TOOLS_SECRET;
  if (!tools) return "no_secret";
  if (badHeaderSetting()) return "bad_secret";
  const url = await appUrl();
  if (!url.startsWith("https://")) return "no_app_url"; // ElevenLabs only calls https addresses
  return { api, data: store, appUrl: url, toolsSecret: tools, initSecret: process.env.ELEVENLABS_INIT_SECRET || tools };
}
