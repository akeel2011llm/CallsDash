import { describe, expect, it } from "vitest";
import { createPgData, type Db, type Q } from "@/lib/data/pg";
import { DuplicateError } from "@/lib/errors";
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
  it("refuses a second client with the same name or website, even when submitted twice at once", async () => {
    const { data } = await setup();
    const p = { nameAr: "", color: "#112233", planType: "package" as const, actor: "admin" };
    const results = await Promise.allSettled([
      data.createTenant({ ...p, name: "Twin Clinic", domain: "twin.example.bh" }),
      data.createTenant({ ...p, name: "Twin Clinic", domain: "twin.example.bh" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason as DuplicateError).field).toBe("name");
    await expect(data.createTenant({ ...p, name: "  twin   CLINIC ", domain: "" })).rejects.toMatchObject({ field: "name" });
    await expect(data.createTenant({ ...p, name: "Different", domain: "https://www.TWIN.example.bh/home" })).rejects.toMatchObject({ field: "domain" });
    expect(await data.listTenants()).toHaveLength(1);
    const other = await data.createTenant({ ...p, name: "Other Clinic", domain: "other.example.bh" });
    await expect(data.updateTenant(other.id, { allowedDomains: ["twin.example.bh"] }, "admin")).rejects.toMatchObject({ field: "domain" });
    await data.updateTenant(other.id, { allowedDomains: ["other.example.bh", "other2.example.bh"] }, "admin");
  });

  it("deletes a client with everything that belongs to it and keeps a trail", async () => {
    const { data, pg } = await setup();
    const t = await data.createTenant({ name: "Gone Clinic", nameAr: "", color: "#112233", domain: "gone.example.bh", planType: "package", actor: "admin" });
    const keep = await data.createTenant({ name: "Stays", nameAr: "", color: "#112233", domain: "", planType: "payg", actor: "admin" });
    await data.deleteTenant(t.id, "admin");
    expect(await data.getTenant(t.id)).toBeUndefined();
    for (const table of ["agents", "agent_versions", "credit_batches", "credit_ledger", "audit_log"])
      expect((await pg.query(`select 1 from ${table} where tenant_id = $1`, [t.id])).rows).toHaveLength(0);
    expect((await data.listTenants()).map((x) => x.id)).toEqual([keep.id]);
    expect((await pg.query(`select action from audit_log where tenant_id is null`)).rows).toEqual([{ action: 'Deleted client "Gone Clinic"' }]);
    await data.deleteTenant(t.id, "admin"); // already gone: no error
    // the name and website can be used again
    await data.createTenant({ name: "Gone Clinic", nameAr: "", color: "#112233", domain: "gone.example.bh", planType: "payg", actor: "admin" });
  });

  it("reads a wallet without writing, and still writes expiry when credits lapsed", async () => {
    const { data, pg } = await setup();
    const t = await data.createTenant({ name: "Wallet", nameAr: "", color: "#112233", domain: "", planType: "package", actor: "admin" });
    expect((await data.getWallet(t.id)).balance).toBe(2500);
    await pg.query(`update credit_batches set expires_at = now() - interval '1 day' where tenant_id = $1`, [t.id]);
    expect((await data.getWallet(t.id)).balance).toBe(0);
    expect((await pg.query(`select 1 from credit_ledger where tenant_id = $1 and kind = 'expiry'`, [t.id])).rows).toHaveLength(1);
  });
  it("keeps a catalogue and lets one client hold several packages in one wallet", async () => {
    const { data, pg } = await setup();
    const cat = await data.listPackages();
    expect(cat.map((c) => c.name)).toEqual(["Clinic package", "Extra credits bundle", "Pay as you go"]);
    await expect(data.savePackage({ name: " clinic  PACKAGE", nameAr: "", description: "", type: "package", includedCredits: 1, monthlyPriceBhd: 1, pricePerCreditBhd: 1, rolloverCap: 0 }, "admin")).rejects.toMatchObject({ field: "name" });
    const custom = await data.savePackage({ name: "Premium", nameAr: "", description: "", type: "package", includedCredits: 5000, monthlyPriceBhd: 350, pricePerCreditBhd: 0.07, rolloverCap: 0.5 }, "admin");
    await data.archivePackage(custom.id, true, "admin");
    expect((await data.listPackages()).find((c) => c.id === custom.id)!.archived).toBe(true);

    const clinic = cat[0], addon = cat[1];
    const t = await data.createTenant({ name: "Two Packs", nameAr: "", color: "#112233", domain: "", planType: "package", actor: "admin", plan: { ...clinic, packageId: clinic.id, contractRef: "C-17" } });
    expect(t.plans).toHaveLength(1);
    expect(t.plans[0]).toMatchObject({ name: "Clinic package", contractRef: "C-17", packageId: clinic.id, active: true });
    const added = await data.addPlan(t.id, { ...addon, monthlyPriceBhd: 70, packageId: addon.id }, "admin");
    const w = await data.getWallet(t.id);
    expect(w.balance).toBe(3500);
    expect(w.reference).toBe(3500);
    expect((await data.getTenant(t.id))!.plans.map((p) => p.monthlyPriceBhd)).toEqual([199, 70]);

    await pg.query(`update credit_batches set remaining = 100 where tenant_id = $1 and plan_id = $2`, [t.id, added.id]);
    await data.renewTenantPackage(t.id, "admin", added.id);
    const after = await data.getWallet(t.id);
    const live = after.batches.filter((b) => b.remaining > 0);
    expect(live.filter((b) => b.planId === "plan-1" && b.kind === "package")).toHaveLength(1); // first package untouched
    expect(live.find((b) => b.kind === "rollover")).toMatchObject({ planId: added.id, remaining: 100 });
    expect(after.balance).toBe(2500 + 1000 + 100);

    expect(await data.endPlan(t.id, added.id, "admin")).toBe(true);
    expect(await data.endPlan(t.id, "plan-1", "admin")).toBe(false); // the last active plan stays
    expect((await data.getWallet(t.id)).reference).toBe(2500);
  });

  it("reads a client stored with the old single-plan format", async () => {
    const { data, pg } = await setup();
    const t = await data.createTenant({ name: "Legacy", nameAr: "", color: "#112233", domain: "", planType: "package", actor: "admin" });
    await pg.query(`update tenants set plan = $2::jsonb where id = $1`, [t.id, JSON.stringify({ type: "package", name: "Clinic package", includedCredits: 2500, monthlyPriceBhd: 199, pricePerCreditBhd: 0.08, rolloverCap: 0.5, periodStart: "2026-10-01T00:00:00.000Z" })]);
    await pg.query(`update credit_batches set plan_id = null where tenant_id = $1`, [t.id]);
    const got = (await data.getTenant(t.id))!;
    expect(got.plans).toMatchObject([{ id: "plan-1", active: true }]);
    const r = await data.renewTenantPackage(t.id, "admin");
    expect(r.lapsed + r.carried).toBe(2500); // old batch without a plan id was adopted by the first package
  });
  it("flags conversations by the client's alert rules and raises an urgent request for emergencies", async () => {
    const { data } = await setup();
    const t = await data.createTenant({ name: "Flags", nameAr: "", color: "#112233", domain: "", planType: "package", actor: "admin" });
    expect(t.alertRules.emergency).toMatchObject({ enabled: true, notifyStaff: true });
    const base = { channel: "phone", mode: "voice", language: "en", outcome: "answered", startedAt: new Date().toISOString(), durationSec: 60, messages: 0, sentiment: "neutral" } as const;
    const line = (text: string) => [{ role: "patient" as const, text, atSec: 1 }];
    const a = await data.recordConversation(t.id, { ...base, summary: "Caller reported chest pain", transcript: line("chest pain"), elevenLabsConversationId: "f1" });
    const b = await data.recordConversation(t.id, { ...base, summary: "Pricing question", transcript: line("how much is whitening"), elevenLabsConversationId: "f2" });
    const c = await data.recordConversation(t.id, { ...base, summary: "Opening hours", transcript: line("when do you open"), elevenLabsConversationId: "f3" });
    expect(a.conversation.flags).toEqual(["emergency"]);
    expect(b.conversation.flags).toEqual(["lead"]);
    expect(c.conversation.flags).toEqual([]);
    const inbox = await data.getStaffRequests(t.id);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ kind: "handoff", urgent: true, conversationId: a.conversation.id });
    // a webhook retry does not raise it twice
    await data.recordConversation(t.id, { ...base, summary: "Caller reported chest pain", transcript: line("chest pain"), elevenLabsConversationId: "f1" });
    expect(await data.getStaffRequests(t.id)).toHaveLength(1);

    await data.setConversationReviewed(t.id, a.conversation.id, true, "staff");
    expect((await data.getConversation(t.id, a.conversation.id))!.reviewed).toBe(true);
    await data.setAlertRules(t.id, { ...t.alertRules, lead: { enabled: false, keywords: [], notifyStaff: false } }, "staff");
    expect((await data.getTenant(t.id))!.alertRules.lead.enabled).toBe(false);
  });

  it("adds and removes doctors, keeping the calendar-connected flag right", async () => {
    const { data } = await setup();
    const t = await data.createTenant({ name: "Docs", nameAr: "", color: "#112233", domain: "", planType: "package", actor: "admin" });
    const a = await data.addDoctor(t.id, { name: "Dr. A", specialty: "GP" }, "admin");
    const b = await data.addDoctor(t.id, { name: "Dr. B", specialty: "" }, "admin");
    expect(a.color).not.toBe(b.color);
    expect((await data.getDoctors(t.id)).map((d) => d.name)).toEqual(["Dr. A", "Dr. B"]);
    await data.setDoctorCalendar(t.id, a.id, "a@group.calendar.google.com", "admin");
    expect((await data.getTenant(t.id))?.calendarConnected).toBe(true);
    await data.removeDoctor(t.id, a.id, "admin");
    expect((await data.getTenant(t.id))?.calendarConnected).toBe(false);
    expect((await data.getDoctors(t.id)).map((d) => d.name)).toEqual(["Dr. B"]);
    await expect(data.removeDoctor(t.id, a.id, "admin")).rejects.toThrow("doctor not found");
  });
});
