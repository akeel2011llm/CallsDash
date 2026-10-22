/**
 * What an assistant costs us and what the client pays, in one place. Pure functions, so the Assistant studio, the usage
 * page and the tests agree.
 *
 * One conversation costs ElevenLabs' own fee plus the language model's share. The fee depends on our ElevenLabs plan
 * (an admin keeps it up to date in the studio); the model's share comes from ElevenLabs' price calculator for the client's
 * real instructions, or from the built-in estimate (lib/agent-catalog.ts) when that cannot be reached.
 */
import { TEXT_MESSAGES_PER_CREDIT } from "./credits";
import type { Plan } from "./types";

/** US dollars to Bahraini dinar. The dinar is pegged, so this does not move. */
export const USD_TO_BHD = 0.377;

/** ElevenLabs' own charge, before the language model: per voice minute and per chat message, in US dollars (its price list, 2026-10). */
export interface Fees { minuteUsd: number; messageUsd: number }
export const DEFAULT_FEES: Fees = { minuteUsd: 0.08, messageUsd: 0.003 };
export const FEES_KEY = "elevenlabs.fees";
/** Where the studio keeps its copy of ElevenLabs' model list and prices (lib/studio-data.ts). */
export const MODELS_KEY = "elevenlabs.models";

/** What a model with no price at all is assumed to add per voice minute and per message. */
export const UNKNOWN_MODEL = { perMinute: 0.02, perMessage: 0.001 };

export const toBhd = (usd: number) => usd * USD_TO_BHD;

export function cleanFees(raw: unknown): Fees {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const n = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 10 ? v : fallback);
  return { minuteUsd: n(r.minuteUsd, DEFAULT_FEES.minuteUsd), messageUsd: n(r.messageUsd, DEFAULT_FEES.messageUsd) };
}

export interface CostLine {
  /** Everything we pay ElevenLabs for one voice minute and one chat message: its fee plus the model's share. */
  minuteUsd: number;
  messageUsd: number;
}

export const costLine = (model: { perMinute: number; perMessage: number }, fees: Fees): CostLine => ({
  minuteUsd: fees.minuteUsd + model.perMinute,
  messageUsd: fees.messageUsd + model.perMessage,
});

/**
 * What the client pays for one credit, in dinar: the cheapest rate among their active plans, because the cheapest is the
 * one that eats the margin first. A package's rate is its monthly fee spread over the credits it includes; a pay-as-you-go
 * plan's is its prepaid credit price. Null when the client has no plan to price from.
 */
export function clientRatePerCredit(plans: Plan[]): number | null {
  const rates = plans
    .filter((p) => p.active)
    .map((p) => (p.type === "package" && p.includedCredits > 0 ? p.monthlyPriceBhd / p.includedCredits : p.pricePerCreditBhd))
    .filter((r) => Number.isFinite(r) && r > 0);
  return rates.length ? Math.min(...rates) : null;
}

export interface Margin {
  /** What the client pays for one voice minute (1 credit) and one chat message (a twentieth of a credit), in dinar. */
  clientMinuteBhd: number;
  clientMessageBhd: number;
  /** What we keep from that, as a share of the price. Negative means we lose money. */
  voicePct: number;
  textPct: number;
}

export function marginOf(rateBhd: number, cost: CostLine): Margin {
  const clientMinuteBhd = rateBhd;
  const clientMessageBhd = rateBhd / TEXT_MESSAGES_PER_CREDIT;
  const pct = (price: number, costUsd: number) => (price > 0 ? Math.round(((price - toBhd(costUsd)) / price) * 100) : 0);
  return { clientMinuteBhd, clientMessageBhd, voicePct: pct(clientMinuteBhd, cost.minuteUsd), textPct: pct(clientMessageBhd, cost.messageUsd) };
}

export type MarginTone = "ok" | "warn" | "bad";
/** Green from 40%, amber from 15%, red below. */
export const marginTone = (pct: number): MarginTone => (pct >= 40 ? "ok" : pct >= 15 ? "warn" : "bad");

export interface Usage { voiceMinutes: number; messages: number }

/** A busy small clinic's month (about 30 calls and 40 chats a day), used for the what-if until a client has real usage of its own. */
export const EXAMPLE_USAGE: Usage = { voiceMinutes: 2000, messages: 8000 };

/** What the same usage costs us with a given model: the "what if" the model picker shows. */
export function monthlyCostUsd(usage: Usage, cost: CostLine): number {
  return usage.voiceMinutes * cost.minuteUsd + usage.messages * cost.messageUsd;
}

/** Formats a small dollar amount: four decimals under a cent, three under ten cents, two above. */
export function fmtUsd(usd: number): string {
  const a = Math.abs(usd);
  return `$${usd.toFixed(a < 0.01 ? 4 : a < 0.1 ? 3 : 2)}`;
}

/** Formats a dinar amount with three decimals, as the dinar is written (1 BHD = 1000 fils). */
export const fmtBhd = (bhd: number) => `BHD ${bhd.toFixed(3)}`;
