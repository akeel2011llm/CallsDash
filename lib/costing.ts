/**
 * What a finished conversation cost us, as the Usage and margin screen reports it. The same sums as the Assistant studio:
 * ElevenLabs' fee plus the share of the AI model the client's assistant uses, so choosing a dearer model there shows up here.
 */
import { defaultLlm, priceFor } from "./agent-catalog";
import { studioOf } from "./agent-studio";
import { cleanFees, costLine, UNKNOWN_MODEL, type CostLine } from "./pricing";
import type { AgentSettings, NewConversation } from "./types";
import type { LlmPrice } from "./elevenlabs-catalog";

/** The size of instructions plus knowledge base assumed for the built-in estimate when the studio has never read ElevenLabs' prices for this client. */
const TYPICAL_PROMPT_CHARS = 8000;

/** The prices the studio last read from ElevenLabs for one client (lib/studio-data.ts), worked out for the size of that client's instructions. */
interface SavedPrices { promptChars?: number; prices?: LlmPrice[] }

/**
 * What one voice minute and one chat message cost us for a client: the fee plus the client's AI model, priced from the last
 * prices the studio read from ElevenLabs for this client or, before there are any, from the built-in estimate. Never throws.
 */
export function ratesFor(settings: Pick<AgentSettings, "studio"> | undefined, fees: unknown, savedPrices: unknown): CostLine {
  const llm = studioOf(settings ?? {}).llm || defaultLlm();
  const book: SavedPrices = savedPrices && typeof savedPrices === "object" ? (savedPrices as SavedPrices) : {};
  const live = (Array.isArray(book.prices) ? book.prices : []).find((p) => !!p && p.llm === llm && Number.isFinite(p.perMinute) && Number.isFinite(p.perMessage));
  const chars = typeof book.promptChars === "number" && book.promptChars > 0 ? book.promptChars : TYPICAL_PROMPT_CHARS;
  return costLine(priceFor(llm, live, chars, UNKNOWN_MODEL), cleanFees(fees));
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** A conversation's cost in US dollars: its voice minutes, or its chat messages, at the given rates. */
export const conversationCostUsd = (c: Pick<NewConversation, "mode" | "durationSec" | "messages">, rates: CostLine): number =>
  round4(c.mode === "voice" ? (c.durationSec / 60) * rates.minuteUsd : c.messages * rates.messageUsd);
