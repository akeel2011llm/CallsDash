/**
 * What a finished conversation cost us, as the Usage and margin screen reports it. The same sums as the Assistant studio:
 * ElevenLabs' fee plus the share of the AI model the client's assistant uses, so choosing a dearer model there shows up here.
 */
import { defaultLlm, modelRows, rowFor } from "./agent-catalog";
import { studioOf } from "./agent-studio";
import { cleanFees, costLine, UNKNOWN_MODEL, type CostLine } from "./pricing";
import type { AgentSettings, NewConversation } from "./types";
import type { LlmInfo, LlmPrice } from "./elevenlabs-catalog";

/** The size of instructions plus knowledge base assumed for the built-in estimate when the studio has never read ElevenLabs' prices. */
const TYPICAL_PROMPT_CHARS = 8000;

/** The copy of ElevenLabs' model list the studio keeps in the database (lib/studio-data.ts). */
interface SavedBook { promptChars?: number; llms?: LlmInfo[]; prices?: LlmPrice[] }

/**
 * What one voice minute and one chat message cost us for a client: the fee plus the client's AI model, priced from the
 * last list the studio read from ElevenLabs or, before there is one, from the built-in estimate. Never throws.
 */
export function ratesFor(settings: Pick<AgentSettings, "studio"> | undefined, fees: unknown, savedBook: unknown, today = new Date().toISOString().slice(0, 10)): CostLine {
  const llm = studioOf(settings ?? {}).llm || defaultLlm();
  const book: SavedBook = savedBook && typeof savedBook === "object" ? (savedBook as SavedBook) : {};
  const live = (Array.isArray(book.llms) ? book.llms : []).filter((m): m is LlmInfo => !!m && typeof m.id === "string");
  const prices = (Array.isArray(book.prices) ? book.prices : []).filter((p): p is LlmPrice => !!p && typeof p.llm === "string" && Number.isFinite(p.perMinute) && Number.isFinite(p.perMessage));
  const rows = modelRows({
    live,
    prices,
    promptChars: typeof book.promptChars === "number" && book.promptChars > 0 ? book.promptChars : TYPICAL_PROMPT_CHARS,
    unknown: UNKNOWN_MODEL,
    keep: [llm],
    today,
  });
  return costLine(rowFor(rows, llm).price, cleanFees(fees));
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** A conversation's cost in US dollars: its voice minutes, or its chat messages, at the given rates. */
export const conversationCostUsd = (c: Pick<NewConversation, "mode" | "durationSec" | "messages">, rates: CostLine): number =>
  round4(c.mode === "voice" ? (c.durationSec / 60) * rates.minuteUsd : c.messages * rates.messageUsd);
