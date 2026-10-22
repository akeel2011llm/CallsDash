import { describe, expect, it } from "vitest";
import { LLM_CATALOG, defaultLlm } from "@/lib/agent-catalog";
import { conversationCostUsd, ratesFor } from "@/lib/costing";
import { DEFAULT_FEES, MODELS_KEY, UNKNOWN_MODEL, pricesKey } from "@/lib/pricing";
import { createPgData, type Db, type Q } from "@/lib/data/pg";
import { makeDb } from "./helpers/pgdb";

const withModel = (llm: string) => ({ studio: { llm } }) as never;
/** The dearest model the built-in catalogue knows, by what it charges for the instructions it reads. */
const dearest = LLM_CATALOG.filter((m) => m.usd).sort((a, b) => b.usd![0] - a.usd![0])[0].id;

describe("what a minute and a message cost us", () => {
  it("uses the default model and ElevenLabs' fee when nothing is chosen or saved", () => {
    const r = ratesFor(undefined, undefined, undefined);
    expect(r.minuteUsd).toBeGreaterThan(DEFAULT_FEES.minuteUsd);
    expect(r.minuteUsd).toBeLessThan(DEFAULT_FEES.minuteUsd + 0.1);
    expect(r.messageUsd).toBeGreaterThan(DEFAULT_FEES.messageUsd);
  });

  it("charges more once a dearer model is chosen", () => {
    const base = ratesFor({} as never, undefined, undefined);
    const pricey = ratesFor(withModel(dearest), undefined, undefined);
    expect(dearest).not.toBe(defaultLlm());
    expect(pricey.minuteUsd).toBeGreaterThan(base.minuteUsd);
    expect(pricey.messageUsd).toBeGreaterThan(base.messageUsd);
  });

  it("follows the fees an admin saved", () => {
    const a = ratesFor({} as never, { minuteUsd: 0.1, messageUsd: 0.004 }, undefined);
    const b = ratesFor({} as never, undefined, undefined);
    expect(a.minuteUsd - b.minuteUsd).toBeCloseTo(0.1 - DEFAULT_FEES.minuteUsd, 10);
    expect(a.messageUsd - b.messageUsd).toBeCloseTo(0.004 - DEFAULT_FEES.messageUsd, 10);
  });

  it("prefers the prices ElevenLabs gave the studio for this client over the built-in estimate", () => {
    const saved = { at: "2026-10-21T00:00:00Z", promptChars: 5000, prices: [{ llm: "gpt-6-luna", perMinute: 0.25, perMessage: 0.04 }] };
    const r = ratesFor(withModel("gpt-6-luna"), undefined, saved);
    expect(r.minuteUsd).toBeCloseTo(DEFAULT_FEES.minuteUsd + 0.25, 10);
    expect(r.messageUsd).toBeCloseTo(DEFAULT_FEES.messageUsd + 0.04, 10);
  });

  it("assumes a small extra for a model nobody has a price for", () => {
    const r = ratesFor(withModel("brand-new-model"), undefined, undefined);
    expect(r.minuteUsd).toBeCloseTo(DEFAULT_FEES.minuteUsd + UNKNOWN_MODEL.perMinute, 10);
    expect(r.messageUsd).toBeCloseTo(DEFAULT_FEES.messageUsd + UNKNOWN_MODEL.perMessage, 10);
  });

  it("never throws on damaged saved data", () => {
    for (const junk of [null, 5, "x", [], { prices: 3, promptChars: "big" }, { prices: [null] }, { prices: [{}] }]) {
      expect(() => ratesFor(withModel(defaultLlm()), junk, junk)).not.toThrow();
    }
    expect(Number.isFinite(ratesFor(withModel(defaultLlm()), { minuteUsd: "x" }, { prices: "no" }).minuteUsd)).toBe(true);
  });

  it("keeps each client's prices under its own key", () => {
    expect(MODELS_KEY).toBe("elevenlabs.models");
    expect(pricesKey("t_a")).not.toBe(pricesKey("t_b"));
  });
});

describe("what a conversation cost us", () => {
  const rates = { minuteUsd: 0.1, messageUsd: 0.004 };
  it("charges a call by its minutes and a chat by its messages", () => {
    expect(conversationCostUsd({ mode: "voice", durationSec: 90, messages: 0 }, rates)).toBe(0.15);
    expect(conversationCostUsd({ mode: "text", durationSec: 0, messages: 12 }, rates)).toBe(0.048);
  });
  it("keeps four decimals, so a short chat is not rounded up to a cent", () => {
    expect(conversationCostUsd({ mode: "text", durationSec: 0, messages: 1 }, rates)).toBe(0.004);
    expect(conversationCostUsd({ mode: "voice", durationSec: 7, messages: 0 }, rates)).toBe(0.0117);
  });
});

describe("recording a conversation", () => {
  async function setup() {
    const pg = await makeDb();
    const q: Q = async (sql, params) => (await pg.query(sql, params as unknown[])).rows as never;
    const db: Db = { q, tx: (fn) => pg.transaction((tx) => fn(async (sql, params) => (await tx.query(sql, params as unknown[])).rows as never)) };
    const data = createPgData(db);
    const t = await data.createTenant({ name: "Cost Clinic", nameAr: "", color: "#112233", domain: "", planType: "package", actor: "admin" });
    return { data, t };
  }
  const conv = { channel: "website", mode: "voice", language: "en", outcome: "answered", transcript: [], startedAt: new Date().toISOString(), durationSec: 120, messages: 0, summary: "", sentiment: "neutral" } as const;

  it("stores the cost worked out for the client's model", async () => {
    const { data, t } = await setup();
    const r = await data.recordConversation(t.id, { ...conv, transcript: [], elevenLabsConversationId: "k1", costUsd: 0.4321 });
    expect(r.conversation.costUsd).toBe(0.4321);
    expect((await data.getConversations(t.id))[0].costUsd).toBe(0.4321);
  });

  it("falls back to the flat estimate when no one worked the cost out", async () => {
    const { data, t } = await setup();
    const r = await data.recordConversation(t.id, { ...conv, transcript: [], elevenLabsConversationId: "k2" });
    expect(r.conversation.costUsd).toBeCloseTo(2 * 0.13, 4);
  });
});
