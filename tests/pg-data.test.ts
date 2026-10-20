import { describe, expect, it } from "vitest";
import { createPgData, type Db, type Q } from "@/lib/data/pg";
import { makeDb } from "./helpers/pgdb";

async function setup() {
  const pg = await makeDb();
  const q: Q = async (sql, params) => (await pg.query(sql, params as unknown[])).rows as never;
  const db: Db = { q, tx: (fn) => pg.transaction((tx) => fn(async (sql, params) => (await tx.query(sql, params as unknown[])).rows as never)) };
  const data = createPgData(db);
  return { pg, data };
}

describe("pg data layer", () => {
  it("creates a package client with a wallet, and charges conversations once", async () => {
    const { data } = await setup();
    const t = await data.createTenant({ name: "Test Clinic", nameAr: "", color: "#112233", domain: "t.example.bh", planType: "package", actor: "admin" });
    expect(t.slug).toBe("test-clinic");
    expect((await data.getWallet(t.id)).balance).toBe(2500);
    await data.saveAgent(t.id, { ...(await data.getAgent(t.id)), elevenLabsAgentId: "agent_x" }, "admin", "connect");
    expect((await data.findTenantByAgent("agent_x"))?.id).toBe(t.id);

    const conv = { channel: "website", mode: "voice", language: "en", outcome: "answered", transcript: [{ role: "agent", text: "hi", atSec: 0 }],
      startedAt: new Date().toISOString(), durationSec: 90, messages: 0, summary: "s", sentiment: "neutral", elevenLabsConversationId: "c1" } as const;
    const first = await data.recordConversation(t.id, { ...conv, transcript: [...conv.transcript] });
    expect(first.duplicate).toBe(false);
    expect(first.conversation.creditsCharged).toBe(1.5);
    const again = await data.recordConversation(t.id, { ...conv, transcript: [...conv.transcript] });
    expect(again.duplicate).toBe(true);
    expect((await data.getWallet(t.id)).balance).toBe(2498.5);
    expect((await data.usageByChannel(t.id, new Date(0))).website).toBe(1.5);
  });

  it("rolls over at most 50% on renewal and spends rollover first", async () => {
    const { data, pg } = await setup();
    const t = await data.createTenant({ name: "Roll", nameAr: "", color: "#112233", domain: "", planType: "package", actor: "admin" });
    await pg.query(`update credit_batches set remaining = 2000 where tenant_id = $1`, [t.id]);
    const r = await data.renewTenantPackage(t.id, "admin");
    expect(r.carried).toBe(1250);
    const w = await data.getWallet(t.id);
    expect(w.balance).toBe(3750);
    const kinds = w.batches.filter((b) => b.remaining > 0).map((b) => b.kind).sort();
    expect(kinds).toEqual(["package", "rollover"]);
    const conv = { channel: "whatsapp", mode: "text", language: "ar", outcome: "booked", transcript: [], startedAt: new Date().toISOString(), durationSec: 0, messages: 40, summary: "", sentiment: "neutral" } as const;
    await data.recordConversation(t.id, { ...conv, transcript: [] });
    const after = await data.getWallet(t.id);
    expect(after.batches.find((b) => b.kind === "rollover")!.remaining).toBe(1248);
  });

  it("top-ups expire after 12 months and keep tenants separate", async () => {
    const { data, pg } = await setup();
    const a = await data.createTenant({ name: "A", nameAr: "", color: "#112233", domain: "", planType: "payg", actor: "x" });
    const b = await data.createTenant({ name: "B", nameAr: "", color: "#112233", domain: "", planType: "payg", actor: "x" });
    await data.topUp(a.id, 100, "admin");
    expect((await data.getWallet(a.id)).balance).toBe(100);
    expect((await data.getWallet(b.id)).balance).toBe(0);
    await pg.query(`update credit_batches set expires_at = now() - interval '1 day' where tenant_id = $1`, [a.id]);
    expect((await data.getWallet(a.id)).balance).toBe(0);
    expect((await data.getLedger(a.id)).some((l) => l.kind === "expiry" && l.credits === -100)).toBe(true);
    expect(await data.getConversation(b.id, "00000000-0000-0000-0000-000000000000")).toBeUndefined();
  });

  it("versions agent settings and rolls back", async () => {
    const { data } = await setup();
    const t = await data.createTenant({ name: "V", nameAr: "", color: "#112233", domain: "", planType: "payg", actor: "x" });
    const s = await data.getAgent(t.id);
    await data.saveAgent(t.id, { ...s, temperature: 0.9 }, "client", "behaviour");
    const versions = await data.getAgentVersions(t.id);
    expect(versions).toHaveLength(2);
    await data.rollbackAgent(t.id, versions[1].id, "admin");
    expect((await data.getAgent(t.id)).temperature).toBe(s.temperature);
  });
});
