import "server-only";
import * as store from "./data";
import { revenuePerCredit } from "./credits";
import {
  ACCOUNT_KEY, STALE_MS, accountApiFromEnv, addRealCost, mapConversationCost, readAccount, readRealCosts, readSnapshot, realCostKey,
  type AccountApi, type AccountSnapshot, type RealCosts,
} from "./elevenlabs-account";
import { balanceOf, clientForecast, minuteCost, planAdvice, totalMinutesPerMonth, usageSummary } from "./usage-insights";

/**
 * The ElevenLabs account for the screens: the stored copy, read again when it is older than an hour or the admin pressed
 * Refresh. Never throws: without a key or when ElevenLabs cannot be reached the page shows what it has and why.
 */
export async function loadAccount(force = false, nowMs = Date.now()): Promise<{ snapshot?: AccountSnapshot; noKey: boolean }> {
  const saved = readSnapshot(await store.getSetting(ACCOUNT_KEY).catch(() => undefined));
  const api = accountApiFromEnv();
  if (!api) return { snapshot: saved, noKey: true };
  if (!force && saved && nowMs - Date.parse(saved.fetchedAt) < STALE_MS) return { snapshot: saved, noKey: false };
  try {
    const fresh = await readAccount(api, nowMs);
    // a read that got nothing keeps the last good figures and only adds why it failed
    const keep = !fresh.subscription && !fresh.usage && saved ? { ...saved, errors: fresh.errors, fetchedAt: saved.fetchedAt } : fresh;
    await store.setSetting(ACCOUNT_KEY, keep).catch(() => undefined);
    return { snapshot: keep, noKey: false };
  } catch {
    return { snapshot: saved, noKey: false };
  }
}

/**
 * Asks ElevenLabs what the last 30 days' conversations really cost (credits and dollars), for the ones not asked yet.
 * At most `cap` conversations per press, four at a time.
 */
export async function backfillRealCosts(api: AccountApi, nowMs = Date.now(), cap = 150): Promise<number> {
  let asked = 0;
  for (const t of await store.listTenants()) {
    if (asked >= cap) break;
    const map = readRealCosts(await store.getSetting(realCostKey(t.id)));
    const todo = (await store.getConversations(t.id))
      .filter((c) => c.elevenLabsConversationId && !map[c.elevenLabsConversationId] && nowMs - Date.parse(c.startedAt) <= 30 * 86_400_000)
      .slice(0, cap - asked);
    if (!todo.length) continue;
    let next: RealCosts = map;
    for (let i = 0; i < todo.length; i += 4) {
      const got = await Promise.all(todo.slice(i, i + 4).map(async (c) => ({ id: c.elevenLabsConversationId!, cost: await api.conversation(c.elevenLabsConversationId!).then(mapConversationCost).catch(() => null) })));
      for (const g of got) if (g.cost) next = addRealCost(next, g.id, g.cost);
    }
    asked += todo.length;
    await store.setSetting(realCostKey(t.id), next);
  }
  return asked;
}

/** Records what one conversation really cost, as the post-call webhook reports it. Never throws. */
export async function recordRealCost(tenantId: string, conversationId: string, cost: { credits?: number; usd?: number; minutes?: number }) {
  if (cost.credits === undefined && cost.usd === undefined) return;
  try {
    const map = readRealCosts(await store.getSetting(realCostKey(tenantId)));
    await store.setSetting(realCostKey(tenantId), addRealCost(map, conversationId, cost));
  } catch { /* the conversation itself is already stored */ }
}

/** Everything the Platform settings and Home screens show about money and usage. */
export async function loadInsights(nowMs = Date.now()) {
  const [{ snapshot, noKey }, tenants] = await Promise.all([loadAccount(false, nowMs), store.listTenants()]);
  const per = await Promise.all(tenants.map(async (t) => {
    const [convs, wallet, real] = await Promise.all([store.getConversations(t.id), store.getWallet(t.id), store.getSetting(realCostKey(t.id)).then(readRealCosts).catch(() => ({}))]);
    return { t, convs: convs.filter((c) => nowMs - Date.parse(c.startedAt) <= 62 * 86_400_000), wallet, real };
  }));
  const clients = per.map(({ t, convs, wallet, real }) => clientForecast({
    tenantId: t.id, name: t.branding.displayName || t.name, conversations: convs, walletBalance: wallet.balance, revenuePerCredit: revenuePerCredit(t.plans), real,
  }, nowMs));
  const ourMinutes30 = per.reduce((s, p) => s + p.convs.filter((c) => c.mode === "voice" && nowMs - Date.parse(c.startedAt) <= 30 * 86_400_000).reduce((m, c) => m + c.durationSec / 60, 0), 0);
  const summary = snapshot ? usageSummary(snapshot, nowMs, ourMinutes30) : undefined;
  const balance = snapshot ? balanceOf(snapshot, nowMs) : undefined;
  const minute = snapshot ? minuteCost(snapshot, summary, per.map((p) => p.real)) : undefined;
  const advice = planAdvice(snapshot?.subscription?.tier, Math.max(totalMinutesPerMonth(clients), summary ? (summary.minutes30 * 30) / 30 : 0));
  return { snapshot, noKey, balance, summary, minute, advice, clients, names: Object.fromEntries(tenants.map((t) => [t.id, t])) };
}
