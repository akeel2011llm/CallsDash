/**
 * Plain-language sums over the ElevenLabs account (lib/elevenlabs-account.ts) and each client's own conversations: how many
 * credits are left and when they run out, what a minute really costs, which ElevenLabs plan fits, and a month forecast for
 * every client. Pure functions, so the screens and the tests agree. Every figure is an estimate from past usage.
 */
import type { AccountSnapshot, RealCosts } from "./elevenlabs-account";
import { USD_TO_BHD } from "./pricing";
import type { Conversation } from "./types";

const DAY = 86_400_000;
const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * ElevenLabs' agent plans as its pricing page showed them on 2026-11-03 (monthly, US dollars). Every plan charges the same
 * $0.08 per call minute beyond what it includes, $0.16 for burst calls over the concurrency limit, and $0.003 per text
 * message; the AI model is charged on top. Business has no public price. Free and Starter cannot buy extra minutes
 * (usage-based billing starts at Creator), so they only count when the minutes fit.
 */
export const EL_PLANS = [
  { id: "free", name: "Free", usd: 0, minutes: 15, concurrency: 4, overage: false },
  { id: "starter", name: "Starter", usd: 6, minutes: 75, concurrency: 6, overage: false },
  { id: "creator", name: "Creator", usd: 22, minutes: 275, concurrency: 10, overage: true },
  { id: "pro", name: "Pro", usd: 99, minutes: 1238, concurrency: 20, overage: true },
  { id: "scale", name: "Scale", usd: 299, minutes: 3738, concurrency: 30, overage: true },
  { id: "business", name: "Business", usd: undefined, minutes: 12375, concurrency: 40, overage: true },
] as const;
export type ElPlan = (typeof EL_PLANS)[number];
export const EXTRA_MINUTE_USD = 0.08;
export const BURST_MINUTE_USD = 0.16;
export const MESSAGE_USD = 0.003;

/** The plan named by ElevenLabs' tier ("creator", "creator_annual"...). */
export const planOf = (tier: string | undefined): ElPlan | undefined => {
  const t = (tier ?? "").toLowerCase();
  return EL_PLANS.find((p) => t === p.id || t.startsWith(`${p.id}_`) || t.includes(p.id));
};

/* ---------------------------------------------------------------- balance */

export interface Balance {
  plan?: ElPlan;
  used: number;
  limit: number;
  left: number;
  /** 0..100 */
  usedPct: number;
  resetAt?: number;
  daysToReset?: number;
  /** Average credits a day over the last 7 days (0 when unknown). */
  perDay: number;
  /** Credits used by the reset date at that pace. */
  projectedAtReset?: number;
  /** When the credits run out at that pace, if that is before the reset. */
  runsOutAt?: number;
  tone: "ok" | "warn" | "danger";
}

/** Credits per day for all products, oldest first. */
export const dailyTotals = (s: AccountSnapshot): number[] => {
  const u = s.usage;
  if (!u) return [];
  return u.days.map((_, i) => sum(Object.values(u.byProduct).map((v) => v[i] ?? 0)));
};

/** The last `n` complete days' credits (today is left out: it has only just started). */
function lastDays(s: AccountSnapshot, nowMs: number, n: number, skip = 0): number[] {
  const u = s.usage;
  if (!u) return [];
  const today = Math.floor(nowMs / DAY) * DAY;
  const totals = dailyTotals(s);
  return u.days.map((d, i) => ({ d, v: totals[i] })).filter((x) => x.d < today - skip * DAY && x.d >= today - (n + skip) * DAY).map((x) => x.v);
}

export function balanceOf(s: AccountSnapshot, nowMs: number): Balance | undefined {
  const sub = s.subscription;
  if (!sub) return undefined;
  const left = Math.max(0, sub.limit - sub.used);
  const usedPct = sub.limit > 0 ? Math.min(100, (sub.used / sub.limit) * 100) : 100;
  const week = lastDays(s, nowMs, 7);
  const perDay = week.length ? sum(week) / 7 : 0;
  const daysToReset = sub.resetAt ? Math.max(0, (sub.resetAt - nowMs) / DAY) : undefined;
  const projectedAtReset = daysToReset !== undefined ? sub.used + perDay * daysToReset : undefined;
  const runsOutAt = perDay > 0 && (daysToReset === undefined || left / perDay < daysToReset) ? nowMs + (left / perDay) * DAY : undefined;
  const tone = usedPct >= 95 || (runsOutAt !== undefined && runsOutAt - nowMs < 7 * DAY) ? "danger" : usedPct >= 75 || runsOutAt !== undefined ? "warn" : "ok";
  return { plan: planOf(sub.tier), used: sub.used, limit: sub.limit, left, usedPct: round(usedPct, 1), resetAt: sub.resetAt, daysToReset, perDay: Math.round(perDay), projectedAtReset, runsOutAt, tone };
}

/* ---------------------------------------------------------------- usage in plain words */

export interface UsageSummary {
  last7: number;
  prev7: number;
  /** Change of the last 7 days against the 7 before, in percent (undefined when there was nothing before). */
  changePct?: number;
  last30: number;
  /** Credits of the last 30 days by product, biggest first. */
  products: { key: string; credits: number; pct: number }[];
  busiest?: { day: number; credits: number };
  /** Voice minutes of the last 30 days (ElevenLabs' count, else ours). */
  minutes30: number;
  /** Days of the last 30 with any usage. */
  activeDays: number;
}

export function usageSummary(s: AccountSnapshot, nowMs: number, ourMinutes30 = 0): UsageSummary | undefined {
  const u = s.usage;
  if (!u) return undefined;
  const last7 = sum(lastDays(s, nowMs, 7)), prev7 = sum(lastDays(s, nowMs, 7, 7));
  const today = Math.floor(nowMs / DAY) * DAY;
  const inWindow = u.days.map((d, i) => ({ d, i })).filter((x) => x.d >= today - 30 * DAY);
  const totals = dailyTotals(s);
  const products = Object.entries(u.byProduct)
    .map(([key, v]) => ({ key, credits: sum(inWindow.map((x) => v[x.i] ?? 0)) }))
    .filter((p) => p.credits > 0).sort((a, b) => b.credits - a.credits);
  const last30 = sum(products.map((p) => p.credits));
  const busy = inWindow.map((x) => ({ day: x.d, credits: totals[x.i] })).sort((a, b) => b.credits - a.credits)[0];
  const elMinutes = u.minutes ? sum(inWindow.map((x) => u.minutes![x.i] ?? 0)) : 0;
  return {
    last7: Math.round(last7), prev7: Math.round(prev7), ...(prev7 > 0 ? { changePct: Math.round(((last7 - prev7) / prev7) * 100) } : {}),
    last30: Math.round(last30), products: products.map((p) => ({ ...p, credits: Math.round(p.credits), pct: last30 ? Math.round((p.credits / last30) * 100) : 0 })),
    ...(busy && busy.credits > 0 ? { busiest: { day: busy.day, credits: Math.round(busy.credits) } } : {}),
    minutes30: round(elMinutes > 0 ? elMinutes : ourMinutes30, 1), activeDays: inWindow.filter((x) => totals[x.i] > 0).length,
  };
}

/** Plain names for ElevenLabs' product keys; anything else is shown tidied up. */
export function productLabel(key: string): string {
  const k = key.toLowerCase();
  if (/agent|convai|conversational/.test(k)) return "agents";
  if (/tts|text_to_speech|speech_synthesis/.test(k)) return "tts";
  if (/stt|speech_to_text|transcri|scribe/.test(k)) return "stt";
  if (/^all$|total/.test(k)) return "all";
  return "other";
}

/* ---------------------------------------------------------------- cost of a minute */

export interface MinuteCost {
  /** What one credit costs on the current plan (plan price / credits it includes). */
  usdPerCredit?: number;
  /** Credits a call minute really used over the last 30 days (agent credits / voice minutes). */
  creditsPerMinute?: number;
  /** Their worth in dollars and dinars. */
  usdPerMinute?: number;
  bhdPerMinute?: number;
  /** The average of the conversations ElevenLabs reported a dollar cost for (each voice minute, all in). */
  realUsdPerMinute?: number;
  realMinutes?: number;
  /** The price list: $0.08 a minute plus the AI model, which ElevenLabs does not fix in advance. */
  listUsdPerMinute: number;
}

export function minuteCost(s: AccountSnapshot, summary: UsageSummary | undefined, real: RealCosts[]): MinuteCost {
  const plan = planOf(s.subscription?.tier);
  const usdPerCredit = plan?.usd && s.subscription?.limit ? plan.usd / s.subscription.limit : undefined;
  const agentCredits = summary ? sum(summary.products.filter((p) => ["agents", "all"].includes(productLabel(p.key))).map((p) => p.credits)) : 0;
  const creditsPerMinute = summary && summary.minutes30 > 0 && agentCredits > 0 ? agentCredits / summary.minutes30 : undefined;
  const usdPerMinute = creditsPerMinute !== undefined && usdPerCredit !== undefined ? creditsPerMinute * usdPerCredit : undefined;
  let usd = 0, mins = 0;
  for (const map of real) for (const [, [, u, m]] of Object.entries(map)) if (u >= 0 && m > 0) { usd += u; mins += m; }
  return {
    ...(usdPerCredit !== undefined ? { usdPerCredit } : {}),
    ...(creditsPerMinute !== undefined ? { creditsPerMinute: Math.round(creditsPerMinute) } : {}),
    ...(usdPerMinute !== undefined ? { usdPerMinute: round(usdPerMinute, 4), bhdPerMinute: round(usdPerMinute * USD_TO_BHD, 4) } : {}),
    ...(mins >= 1 ? { realUsdPerMinute: round(usd / mins, 4), realMinutes: round(mins, 1) } : {}),
    listUsdPerMinute: EXTRA_MINUTE_USD,
  };
}

/* ---------------------------------------------------------------- which plan */

export interface PlanAdvice {
  current?: ElPlan;
  /** Call minutes a month at the current pace. */
  minutesPerMonth: number;
  /** The month's cost on each plan with a public price, cheapest first. */
  options: { plan: ElPlan; usd: number; extraMinutes: number }[];
  best?: ElPlan;
  /** "keep", "upgrade", "downgrade" or "overage" (the plan is fine but extra minutes will be charged). */
  verdict: "keep" | "upgrade" | "downgrade" | "overage" | "too_small" | "unknown";
  /** Dollars a month saved by the best plan against the current one. */
  saving: number;
}

export function planAdvice(currentTier: string | undefined, minutesPerMonth: number): PlanAdvice {
  const current = planOf(currentTier);
  const options = EL_PLANS.filter((p) => p.usd !== undefined && (p.overage || minutesPerMonth <= p.minutes)).map((p) => {
    const extra = Math.max(0, minutesPerMonth - p.minutes);
    return { plan: p as ElPlan, usd: round((p.usd ?? 0) + extra * EXTRA_MINUTE_USD), extraMinutes: Math.round(extra) };
  }).sort((a, b) => a.usd - b.usd || a.plan.minutes - b.plan.minutes);
  const best = options[0]?.plan;
  const cur = options.find((o) => o.plan.id === current?.id);
  const saving = cur && options[0] ? round(cur.usd - options[0].usd) : 0;
  const verdict: PlanAdvice["verdict"] = !current ? "unknown" : !cur ? "too_small"
    : saving >= 1 ? (EL_PLANS.indexOf(best!) > EL_PLANS.indexOf(current) ? "upgrade" : "downgrade")
      : minutesPerMonth > current.minutes ? "overage" : "keep";
  return { current, minutesPerMonth: Math.round(minutesPerMonth), options, best, verdict, saving };
}

/* ---------------------------------------------------------------- each client */

export interface ClientForecast {
  tenantId: string;
  name: string;
  /** This month so far. */
  mtd: { conversations: number; minutes: number; messages: number; costUsd: number; credits: number };
  /** The whole month at the pace of the last 14 days. */
  month: { minutes: number; messages: number; costUsd: number; credits: number; revenueBhd: number; costBhd: number; marginBhd: number; marginPct?: number };
  /** What a voice minute and a message of this client cost us (last 30 days; real where ElevenLabs reported it). */
  usdPerMinute?: number;
  usdPerMessage?: number;
  /** How many of the last 30 days' conversations have ElevenLabs' real cost. */
  realShare: number;
  wallet: { balance: number; perDay: number; daysLeft?: number; runsOutAt?: number };
  /** What to do, most urgent first. */
  advice: ("no_usage" | "wallet_empty" | "wallet_soon" | "margin_negative" | "margin_low" | "estimate_only" | "ok")[];
  /** Credits to top up so the wallet lasts the rest of the month and 30 days more. */
  topUp?: number;
}

export interface ClientInput {
  tenantId: string;
  name: string;
  conversations: Pick<Conversation, "startedAt" | "mode" | "durationSec" | "messages" | "costUsd" | "creditsCharged" | "elevenLabsConversationId">[];
  walletBalance: number;
  /** What the client pays us per credit (BHD), from its packages. */
  revenuePerCredit: number;
  real: RealCosts;
}

export function clientForecast(c: ClientInput, nowMs: number): ClientForecast {
  const now = new Date(nowMs);
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const elapsed = Math.max(1, (nowMs - monthStart) / DAY);
  const cost = (x: ClientInput["conversations"][number]) => {
    const r = x.elevenLabsConversationId ? c.real[x.elevenLabsConversationId] : undefined;
    return r && r[1] >= 0 ? r[1] : x.costUsd;
  };
  const within = (days: number) => c.conversations.filter((x) => nowMs - Date.parse(x.startedAt) <= days * DAY && Date.parse(x.startedAt) <= nowMs);
  const tally = (list: ClientInput["conversations"]) => ({
    conversations: list.length,
    minutes: round(sum(list.filter((x) => x.mode === "voice").map((x) => x.durationSec / 60)), 1),
    messages: sum(list.filter((x) => x.mode === "text").map((x) => x.messages)),
    costUsd: round(sum(list.map(cost)), 2),
    credits: round(sum(list.map((x) => x.creditsCharged)), 1),
  });
  const mtd = tally(c.conversations.filter((x) => Date.parse(x.startedAt) >= monthStart && Date.parse(x.startedAt) <= nowMs));
  // the pace: the last 14 days, or the whole month so far when it is younger and busier
  const recent = tally(within(14));
  const paceDays = 14;
  const perDay = { minutes: recent.minutes / paceDays, messages: recent.messages / paceDays, costUsd: recent.costUsd / paceDays, credits: recent.credits / paceDays };
  const rest = Math.max(0, daysInMonth - elapsed);
  const month = {
    minutes: round(mtd.minutes + perDay.minutes * rest, 0), messages: Math.round(mtd.messages + perDay.messages * rest),
    costUsd: round(mtd.costUsd + perDay.costUsd * rest), credits: round(mtd.credits + perDay.credits * rest, 0),
  };
  const revenueBhd = round(month.credits * c.revenuePerCredit), costBhd = round(month.costUsd * USD_TO_BHD);
  const marginBhd = round(revenueBhd - costBhd);
  const marginPct = revenueBhd > 0 ? Math.round((marginBhd / revenueBhd) * 100) : undefined;

  const last30 = within(30);
  const voice = last30.filter((x) => x.mode === "voice"), text = last30.filter((x) => x.mode === "text");
  const vMin = sum(voice.map((x) => x.durationSec / 60)), tMsg = sum(text.map((x) => x.messages));
  const realCount = last30.filter((x) => x.elevenLabsConversationId && (c.real[x.elevenLabsConversationId]?.[1] ?? -1) >= 0).length;

  const walletPerDay = perDay.credits;
  const daysLeft = walletPerDay > 0 ? c.walletBalance / walletPerDay : undefined;
  const advice: ClientForecast["advice"] = [];
  if (!last30.length) advice.push("no_usage");
  if (c.walletBalance <= 0 && last30.length) advice.push("wallet_empty");
  else if (daysLeft !== undefined && daysLeft < 14) advice.push("wallet_soon");
  if (marginPct !== undefined && marginPct < 0) advice.push("margin_negative");
  else if (marginPct !== undefined && marginPct < 15) advice.push("margin_low");
  if (last30.length && realCount < last30.length / 2) advice.push("estimate_only");
  if (!advice.length) advice.push("ok");
  const topUp = walletPerDay > 0 ? Math.max(0, Math.ceil(walletPerDay * (rest + 30) - c.walletBalance)) : undefined;

  return {
    tenantId: c.tenantId, name: c.name, mtd,
    month: { ...month, revenueBhd, costBhd, marginBhd, ...(marginPct !== undefined ? { marginPct } : {}) },
    ...(vMin >= 1 ? { usdPerMinute: round(sum(voice.map(cost)) / vMin, 4) } : {}),
    ...(tMsg > 0 ? { usdPerMessage: round(sum(text.map(cost)) / tMsg, 4) } : {}),
    realShare: last30.length ? Math.round((realCount / last30.length) * 100) : 0,
    wallet: { balance: round(c.walletBalance, 1), perDay: round(walletPerDay, 1), ...(daysLeft !== undefined ? { daysLeft: Math.round(daysLeft), runsOutAt: nowMs + daysLeft * DAY } : {}) },
    advice, ...(topUp ? { topUp } : {}),
  };
}

/** Minutes a month across all clients at the current pace (for the plan advice). */
export const totalMinutesPerMonth = (list: ClientForecast[]) => sum(list.map((f) => f.month.minutes));
