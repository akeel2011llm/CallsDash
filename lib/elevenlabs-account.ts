/**
 * The ElevenLabs account behind every client (2026-11-03, Platform settings and admin Home): the plan, the credits used and
 * left this cycle, the daily usage, and what single conversations really cost. Read with the server's ELEVENLABS_API_KEY,
 * kept in one setting (`elevenlabs.account`) so pages load fast, and read again when the admin presses Refresh or the copy
 * is older than an hour. Nothing here writes to ElevenLabs.
 */
import { elevenLabsRequester } from "./elevenlabs-api";

type FetchLike = typeof fetch;
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

export const ACCOUNT_KEY = "elevenlabs.account";
/** Real costs of single conversations, as ElevenLabs reported them (webhook or Refresh): `realCostKey(tenantId)`. */
export const realCostKey = (tenantId: string) => `elevenlabs.real.${tenantId}`;
export const STALE_MS = 60 * 60 * 1000;

export interface Subscription {
  /** "creator", "pro"... as ElevenLabs names it. */
  tier: string;
  /** Credits used this cycle and the cycle's allowance (ElevenLabs still calls them characters). */
  used: number;
  limit: number;
  /** When the allowance starts again (ms). */
  resetAt?: number;
  status?: string;
  currency?: string;
  billingPeriod?: string;
  /** Usage beyond the allowance this cycle, in the account's currency (usage-based billing), when there is any. */
  overage?: number;
  /** The next invoice, in the account's currency. */
  nextInvoice?: number;
}

export interface UsageSeries {
  /** Start of each day (ms, UTC). */
  days: number[];
  /** Credits per day for each product ElevenLabs names ("All" when it gives no breakdown). */
  byProduct: Record<string, number[]>;
  /** Voice minutes per day of the agents (when ElevenLabs reports them). */
  minutes?: number[];
}

export interface AccountSnapshot {
  fetchedAt: string;
  subscription?: Subscription;
  usage?: UsageSeries;
  /** What failed while reading, in ElevenLabs' words (the rest of the snapshot is still shown). */
  errors: string[];
}

export function mapSubscription(raw: unknown): Subscription | undefined {
  const r = obj(raw);
  const used = num(r.character_count), limit = num(r.character_limit);
  if (used === undefined || limit === undefined) return undefined;
  const reset = num(r.next_character_count_reset_unix);
  const overage = num(obj(r.current_overage).amount);
  const inv = obj(r.next_invoice);
  const cents = num(inv.amount_due_cents);
  return {
    tier: str(r.tier) ?? "unknown", used, limit,
    ...(reset ? { resetAt: reset * 1000 } : {}),
    ...(str(r.status) ? { status: str(r.status) } : {}),
    ...(str(r.currency) ? { currency: str(r.currency) } : {}),
    ...(str(r.billing_period) ? { billingPeriod: str(r.billing_period) } : {}),
    ...(overage !== undefined ? { overage } : {}),
    ...(cents !== undefined ? { nextInvoice: cents / 100 } : {}),
  };
}

/** ElevenLabs' usage answer: `{ time: [ms...], usage: { <name>: [value per time] } }`. */
export function mapUsage(raw: unknown): { time: number[]; usage: Record<string, number[]> } {
  const r = obj(raw);
  const time = (Array.isArray(r.time) ? r.time : []).map((t) => num(t) ?? 0);
  const usage: Record<string, number[]> = {};
  for (const [k, v] of Object.entries(obj(r.usage))) if (Array.isArray(v)) usage[k] = time.map((_, i) => Math.max(0, num(v[i]) ?? 0));
  return { time, usage };
}

/** What one conversation cost, from ElevenLabs' conversation details: credits, and US dollars when it reports them. */
export function mapConversationCost(raw: unknown): { credits?: number; usd?: number; minutes?: number } {
  const m = obj(obj(raw).metadata);
  const credits = num(m.cost), usd = num(m.cost_fiat), secs = num(m.call_duration_secs);
  return { ...(credits !== undefined ? { credits } : {}), ...(usd !== undefined ? { usd } : {}), ...(secs !== undefined ? { minutes: secs / 60 } : {}) };
}

const DAY = 86_400_000;

export interface AccountApi {
  subscription(): Promise<unknown>;
  usage(startMs: number, endMs: number, breakdown: "product_type" | "none", metric: "credits" | "minutes_used"): Promise<unknown>;
  conversation(id: string): Promise<unknown>;
}

export function createAccountApi(apiKey: string, fetchImpl: FetchLike = fetch): AccountApi {
  const call = elevenLabsRequester(apiKey, fetchImpl);
  const get = (p: string) => call<unknown>("GET", p, undefined, { timeoutMs: 12000 });
  return {
    subscription: () => get("/v1/user/subscription"),
    usage: (start, end, breakdown, metric) => get(`/v1/usage/character-stats?${new URLSearchParams({
      start_unix: String(start), end_unix: String(end), include_workspace_metrics: "true", breakdown_type: breakdown, aggregation_interval: "day", metric,
    })}`),
    conversation: (id) => get(`/v1/convai/conversations/${encodeURIComponent(id)}`),
  };
}

export const accountApiFromEnv = (): AccountApi | null => (process.env.ELEVENLABS_API_KEY ? createAccountApi(process.env.ELEVENLABS_API_KEY) : null);

const why = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 240);

/** Reads the plan and the last `days` days of usage. Each part may fail on its own; what failed is listed in `errors`. */
export async function readAccount(api: AccountApi, nowMs: number, days = 35): Promise<AccountSnapshot> {
  const end = nowMs, start = Math.floor((nowMs - days * DAY) / DAY) * DAY;
  const errors: string[] = [];
  const [sub, credits, minutes] = await Promise.all([
    api.subscription().then(mapSubscription).catch((e) => { errors.push(`Plan and balance: ${why(e)}`); return undefined; }),
    api.usage(start, end, "product_type", "credits").then(mapUsage).catch((e) => { errors.push(`Daily usage: ${why(e)}`); return undefined; }),
    api.usage(start, end, "none", "minutes_used").then(mapUsage).catch(() => undefined), // a workspace without this metric still gets the rest
  ]);
  let usage: UsageSeries | undefined;
  if (credits && credits.time.length) {
    const mins = minutes && minutes.time.length ? credits.time.map((t) => {
      const i = minutes.time.indexOf(t);
      return i < 0 ? 0 : Object.values(minutes.usage).reduce((s, v) => s + (v[i] ?? 0), 0);
    }) : undefined;
    usage = { days: credits.time, byProduct: credits.usage, ...(mins ? { minutes: mins } : {}) };
  }
  return { fetchedAt: new Date(nowMs).toISOString(), ...(sub ? { subscription: sub } : {}), ...(usage ? { usage } : {}), errors };
}

/** The stored snapshot, or undefined when there is none or it is broken. */
export function readSnapshot(v: unknown): AccountSnapshot | undefined {
  const o = obj(v);
  if (typeof o.fetchedAt !== "string") return undefined;
  return o as unknown as AccountSnapshot;
}

/** Real costs per conversation id: [credits, usd, minutes]. */
export type RealCosts = Record<string, [number, number, number]>;
export function readRealCosts(v: unknown): RealCosts {
  const out: RealCosts = {};
  for (const [k, x] of Object.entries(obj(v))) {
    if (Array.isArray(x) && x.length === 3 && x.every((n) => typeof n === "number" && Number.isFinite(n))) out[k] = x as [number, number, number];
  }
  return out;
}
/** Adds one conversation's real cost, keeping the newest 3,000. */
export function addRealCost(map: RealCosts, id: string, c: { credits?: number; usd?: number; minutes?: number }): RealCosts {
  if (c.credits === undefined && c.usd === undefined) return map;
  const next = { ...map, [id]: [c.credits ?? -1, c.usd ?? -1, c.minutes ?? 0] as [number, number, number] };
  const keys = Object.keys(next);
  return keys.length > 3000 ? Object.fromEntries(keys.slice(keys.length - 3000).map((k) => [k, next[k]])) : next;
}
