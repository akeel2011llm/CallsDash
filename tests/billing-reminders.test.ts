import { describe, expect, it, vi } from "vitest";
import { createDemoData, type Data } from "@/lib/data/demo";
import { createPgData, type Db, type Q } from "@/lib/data/pg";
import { makeDb } from "./helpers/pgdb";
import { BILLING_KEY, DEFAULT_AMOUNTS, SENT_KEY, billingClientKey, dueReminders, expiring, monthlyBhd, parseEmails, readBillingSettings, readClientBilling, renewals } from "@/lib/billing-status";
import { reminderMessage, runReminders, runRemindersThrottled } from "@/lib/billing-reminders";
import { sendEmail } from "@/lib/mailer";
import { systemText } from "@/lib/system-text";
import type { Plan } from "@/lib/types";

vi.mock("server-only", () => ({}));

async function backend(kind: "demo" | "postgres"): Promise<Data> {
  if (kind === "demo") { vi.resetModules(); return createDemoData(); }
  const pg = await makeDb();
  const q: Q = async (sql, params) => (await pg.query(sql, params as unknown[])).rows as never;
  const db: Db = { q, tx: (fn) => pg.transaction((tx) => fn(async (sql, params) => (await tx.query(sql, params as unknown[])).rows as never)) };
  return createPgData(db) as Data;
}

let n = 0;
async function clinic(d: Data) {
  n++;
  const t = await d.createTenant({ name: `Reminder Clinic ${n}`, nameAr: `عيادة ${n}`, color: "#112233", domain: `rem${n}.example.bh`, planType: "package", actor: "x" });
  return (await d.getTenant(t.id))!;
}

const plan = (o: Partial<Plan> = {}): Plan => ({ id: "p1", active: true, type: "package", name: "Clinic package", includedCredits: 2500, monthlyPriceBhd: 199, pricePerCreditBhd: 0.08, rolloverCap: 0.5, periodStart: "2026-10-21T00:00:00.000Z", ...o });

describe("billing status", () => {
  it("settings fall back to safe defaults", () => {
    expect(readBillingSettings(undefined)).toMatchObject({ daysBefore: 7, onScreen: true, email: true, amounts: DEFAULT_AMOUNTS });
    expect(readBillingSettings({ daysBefore: 999, amounts: [3000, "x", 500, 500] })).toMatchObject({ daysBefore: 60, amounts: [500, 3000] });
    expect(readClientBilling({ daysBefore: 0, emailTo: " a@b.co ", muted: true })).toEqual({ emailTo: "a@b.co", muted: true });
  });
  it("parses email lists", () => {
    expect(parseEmails("A@b.co, c@d.org;bad  a@b.co")).toEqual({ valid: ["a@b.co", "c@d.org"], invalid: ["bad"] });
  });
  it("finds the renewal date and the days left", () => {
    const [r] = renewals([plan(), plan({ id: "p2", active: false }), plan({ id: "p3", type: "payg" })], new Date("2026-11-03T09:00:00Z"));
    expect(r).toMatchObject({ planId: "p1", renewsAt: "2026-11-21T00:00:00.000Z", daysLeft: 18 });
    expect(monthlyBhd([plan(), plan({ id: "p2", monthlyPriceBhd: 20 })])).toBe(219);
  });
  it("reminds only inside the window, and flags an overdue renewal", () => {
    const p = [plan()];
    expect(dueReminders(p, [], new Date("2026-11-03T09:00:00Z"), 7)).toEqual([]);
    expect(dueReminders(p, [], new Date("2026-11-15T09:00:00Z"), 7)).toMatchObject([{ kind: "renewal", daysLeft: 6, key: "renewal:p1:2026-11-21" }]);
    expect(dueReminders(p, [], new Date("2026-11-25T09:00:00Z"), 7)).toMatchObject([{ kind: "overdue", key: "overdue:p1:2026-11-21" }]);
  });
  it("lists expiring top-up credits once per day, not the package's own", () => {
    const b = (id: string, kind: "topup" | "package", remaining: number, expiresAt: string) => ({ id, tenantId: "t", kind, amount: 1000, remaining, purchasedAt: "2026-01-01T00:00:00Z", expiresAt });
    const batches = [b("a", "topup", 100, "2026-11-10T00:00:00Z"), b("b", "topup", 50.5, "2026-11-10T20:00:00Z"), b("c", "package", 900, "2026-11-21T00:00:00Z"), b("d", "topup", 0, "2026-11-09T00:00:00Z")];
    const now = new Date("2026-11-05T00:00:00Z");
    expect(expiring(batches, now, 7).map((e) => e.batchId)).toEqual(["a", "b"]);
    const due = dueReminders([plan()], batches, now, 7).filter((r) => r.kind === "expiry");
    expect(due).toHaveLength(1);
    expect(due[0].credits).toBe(150.5);
  });
});

describe("mailer", () => {
  it("does not send without a key or recipients", async () => {
    expect(await sendEmail({ to: ["a@b.co"], subject: "s", text: "t" }, vi.fn() as never, { key: "", from: "x@y.co" })).toEqual({ ok: false, reason: "not_configured" });
    expect(await sendEmail({ to: [], subject: "s", text: "t" }, vi.fn() as never, { key: "k", from: "x@y.co" })).toEqual({ ok: false, reason: "no_recipient" });
  });
  it("posts to Resend and reports a refusal", async () => {
    const calls: { url: string; body: string }[] = [];
    const ok = vi.fn(async (url: string, init: { body: string }) => { calls.push({ url, body: init.body }); return new Response("{}", { status: 200 }); });
    expect(await sendEmail({ to: ["a@b.co"], subject: "Hi", text: "Body" }, ok as never, { key: "k", from: "billing@x.co", base: "https://r.test" })).toEqual({ ok: true });
    expect(calls[0].url).toBe("https://r.test/emails");
    expect(JSON.parse(calls[0].body)).toMatchObject({ from: "billing@x.co", to: ["a@b.co"], subject: "Hi" });
    const bad = vi.fn(async () => new Response("domain not verified", { status: 403 }));
    expect(await sendEmail({ to: ["a@b.co"], subject: "s", text: "t" }, bad as never, { key: "k", from: "x@y.co" })).toMatchObject({ ok: false, reason: "failed", detail: expect.stringContaining("403") });
  });
});

describe.each(["demo", "postgres"] as const)("reminder run (%s)", (kind) => {
  it("alerts and emails once per renewal, then again for the next one", async () => {
    const d = await backend(kind);
    const tenant = await clinic(d);
    const renewsAt = renewals(tenant.plans, new Date())[0]?.renewsAt;
    expect(renewsAt).toBeTruthy();
    const now = new Date(Date.parse(renewsAt!) - 3 * 86_400_000);
    const sent: { to: string[]; text: string }[] = [];
    const send = async (m: { to: string[]; subject: string; text: string }) => { sent.push(m); return { ok: true as const }; };
    await d.setSetting(BILLING_KEY, { daysBefore: 7, emailTo: "owner@x.co" });
    await d.setSetting(billingClientKey(tenant.id), { emailTo: "clinic@x.co" });
    const run = await runReminders(d, { send, now });
    expect(run.alerts).toBeGreaterThanOrEqual(1);
    expect(run.emails).toBe(run.alerts);
    expect(sent.find((m) => m.text.includes(tenant.name))?.to.sort()).toEqual(["clinic@x.co", "owner@x.co"]);
    const mine = (await d.getAlerts(tenant.id)).filter((a) => a.message.startsWith("Billing reminder:"));
    expect(mine.length).toBeGreaterThanOrEqual(1);
    // the same day again: nothing new
    const again = await runReminders(d, { send, now });
    expect(again.alerts).toBe(0);
    expect(again.emails).toBe(0);
    expect(Array.isArray(await d.getSetting(SENT_KEY(tenant.id)))).toBe(true);
  });
  it("respects on-screen off, email off and a muted client", async () => {
    const d = await backend(kind);
    const tenant = await clinic(d);
    const now = new Date(Date.parse(renewals(tenant.plans, new Date())[0].renewsAt) - 2 * 86_400_000);
    const send = vi.fn(async () => ({ ok: true as const }));
    await d.setSetting(BILLING_KEY, { daysBefore: 7, onScreen: false, email: false });
    const quiet = await runReminders(d, { send, now });
    expect(quiet).toMatchObject({ alerts: 0, emails: 0 });
    expect(send).not.toHaveBeenCalled();
    await d.setSetting(SENT_KEY(tenant.id), []);
    await d.setSetting(BILLING_KEY, { daysBefore: 7 });
    await d.setSetting(billingClientKey(tenant.id), { muted: true });
    const muted = await runReminders(d, { send, now });
    expect(muted.checked).toBe((await d.listTenants()).length);
    expect((await d.getAlerts(tenant.id)).some((a) => a.message.startsWith("Billing reminder:") && !a.resolved)).toBe(false);
  });
  it("is throttled and never throws", async () => {
    const d = await backend(kind);
    const now = new Date("2031-06-01T09:00:00Z"); // later than any run made by the tests above (the demo store is shared)
    expect(await runRemindersThrottled(d, 6, now)).not.toBeNull();
    expect(await runRemindersThrottled(d, 6, new Date(now.getTime() + 3_600_000))).toBeNull();
    expect(await runRemindersThrottled(d, 6, new Date(now.getTime() + 7 * 3_600_000))).not.toBeNull();
    expect(await runRemindersThrottled({ ...d, getSetting: async () => { throw new Error("db down"); } } as Data, 6, now)).toBeNull();
  });
});

describe("alert wording", () => {
  it("shows each reminder in the reader's language", () => {
    const t = (k: string, v?: Record<string, string | number>) => `${k}:${JSON.stringify(v)}`;
    for (const r of [
      { key: "k", kind: "renewal" as const, name: "Clinic package", date: "2026-11-21T00:00:00Z", daysLeft: 5 },
      { key: "k", kind: "overdue" as const, name: "Clinic package", date: "2026-11-21T00:00:00Z", daysLeft: -2 },
      { key: "k", kind: "expiry" as const, date: "2026-11-21T00:00:00Z", daysLeft: 3, credits: 120.5 },
    ]) expect(systemText(reminderMessage(r), t)).toMatch(/^sys\.bill/);
  });
});
