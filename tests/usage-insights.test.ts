import { describe, expect, it } from "vitest";
import { addRealCost, mapConversationCost, mapSubscription, mapUsage, readAccount, readRealCosts, type AccountApi, type AccountSnapshot } from "@/lib/elevenlabs-account";
import { balanceOf, clientForecast, minuteCost, planAdvice, planOf, productLabel, usageSummary } from "@/lib/usage-insights";
import { parsePostCall } from "@/lib/elevenlabs";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 3, 9, 0); // 3 Nov 2026
const TODAY = Math.floor(NOW / DAY) * DAY;

function snap(perDay: number[], sub = { tier: "creator", used: 51_734, limit: 131_000, resetAt: Date.UTC(2026, 10, 21) }): AccountSnapshot {
  const days = perDay.map((_, i) => TODAY - (perDay.length - i) * DAY);
  return { fetchedAt: new Date(NOW).toISOString(), subscription: sub, usage: { days, byProduct: { agents: perDay.map((v) => v * 0.9), tts: perDay.map((v) => v * 0.1) }, minutes: perDay.map((v) => v / 530) }, errors: [] };
}

describe("ElevenLabs account answers", () => {
  it("reads the subscription", () => {
    const s = mapSubscription({ tier: "creator", character_count: 51734, character_limit: 131000, next_character_count_reset_unix: 1_795_000_000, status: "active", next_invoice: { amount_due_cents: 2200 } });
    expect(s).toMatchObject({ tier: "creator", used: 51734, limit: 131000, resetAt: 1_795_000_000_000, nextInvoice: 22 });
    expect(mapSubscription({ tier: "x" })).toBeUndefined();
  });
  it("reads usage and conversation cost", () => {
    expect(mapUsage({ time: [1, 2], usage: { All: [5, "7"] } })).toEqual({ time: [1, 2], usage: { All: [5, 7] } });
    expect(mapConversationCost({ metadata: { cost: 530, cost_fiat: 0.09, call_duration_secs: 60 } })).toEqual({ credits: 530, usd: 0.09, minutes: 1 });
  });
  it("keeps what worked when one read fails", async () => {
    const api: AccountApi = {
      subscription: async () => ({ tier: "creator", character_count: 10, character_limit: 100 }),
      usage: async () => { throw new Error("401 missing permission"); },
      conversation: async () => ({}),
    };
    const s = await readAccount(api, NOW);
    expect(s.subscription?.used).toBe(10);
    expect(s.usage).toBeUndefined();
    expect(s.errors[0]).toContain("401");
  });
  it("stores real costs safely and caps them", () => {
    let m = readRealCosts({ a: [1, 2, 3], bad: ["x"] });
    expect(Object.keys(m)).toEqual(["a"]);
    m = addRealCost(m, "b", { usd: 0.1 });
    expect(m.b).toEqual([-1, 0.1, 0]);
    expect(addRealCost(m, "c", {})).toBe(m);
  });
  it("the webhook reads ElevenLabs' cost", () => {
    const p = parsePostCall({ type: "post_call_transcription", data: { agent_id: "a", conversation_id: "conv_1", transcript: [], metadata: { call_duration_secs: 120, cost: 1000, cost_fiat: 0.2 } } });
    expect(p?.cost).toMatchObject({ credits: 1000, usd: 0.2 });
  });
});

describe("plain-language sums", () => {
  it("balance: runs out before renewal at a fast pace", () => {
    const b = balanceOf(snap(Array(14).fill(6000)), NOW)!;
    expect(b.left).toBe(131_000 - 51_734);
    expect(b.perDay).toBe(6000);
    expect(b.runsOutAt).toBeDefined();
    expect(b.tone).not.toBe("ok");
    expect(b.plan?.name).toBe("Creator");
  });
  it("balance: fine at a slow pace", () => {
    const b = balanceOf(snap(Array(14).fill(1000)), NOW)!;
    expect(b.runsOutAt).toBeUndefined();
    expect(b.tone).toBe("ok");
  });
  it("usage summary compares weeks and splits products", () => {
    const s = usageSummary(snap([...Array(7).fill(1000), ...Array(7).fill(2000)]), NOW)!;
    expect(s.last7).toBe(14000);
    expect(s.prev7).toBe(7000);
    expect(s.changePct).toBe(100);
    expect(s.products[0]).toMatchObject({ key: "agents", pct: 90 });
    expect(s.activeDays).toBe(14);
  });
  it("cost of a minute from credits and from real bills", () => {
    const sn = snap(Array(30).fill(5300));
    const m = minuteCost(sn, usageSummary(sn, NOW), [{ c1: [530, 0.1, 1], c2: [530, 0.08, 1] }]);
    expect(m.creditsPerMinute).toBe(477); // agents share only
    expect(m.usdPerCredit).toBeCloseTo(22 / 131_000);
    expect(m.realUsdPerMinute).toBeCloseTo(0.09);
  });
  it("plan advice", () => {
    expect(planOf("creator_annual")?.id).toBe("creator");
    expect(planAdvice("creator", 200).verdict).toBe("keep");
    expect(planAdvice("pro", 100)).toMatchObject({ verdict: "downgrade" });
    expect(planAdvice("creator", 300).verdict).toBe("overage");
    expect(planAdvice("starter", 2000)).toMatchObject({ verdict: "too_small" });
    expect(planAdvice("creator", 2000).verdict).toBe("overage"); // every plan prices extra minutes the same
    expect(productLabel("convai")).toBe("agents");
  });
  it("client forecast: margin, wallet and advice", () => {
    const conversations = Array.from({ length: 14 }, (_, i) => ({
      startedAt: new Date(NOW - (i + 0.5) * DAY).toISOString(), mode: "voice" as const, durationSec: 600, messages: 0, costUsd: 1, creditsCharged: 10, elevenLabsConversationId: `conv_${i}`,
    }));
    const f = clientForecast({ tenantId: "t", name: "Clinic", conversations, walletBalance: 50, revenuePerCredit: 0.08, real: { conv_0: [5000, 0.8, 10] } }, NOW);
    expect(f.mtd.minutes).toBe(20);
    expect(f.wallet.daysLeft).toBe(5);
    expect(f.advice).toContain("wallet_soon");
    expect(f.advice).toContain("estimate_only");
    expect(f.usdPerMinute).toBeCloseTo(13.8 / 140, 3);
    expect(f.topUp).toBeGreaterThan(0);
    expect(clientForecast({ tenantId: "t", name: "x", conversations: [], walletBalance: 0, revenuePerCredit: 0.1, real: {} }, NOW).advice).toEqual(["no_usage"]);
  });
});
