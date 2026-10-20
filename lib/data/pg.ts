import { randomUUID } from "node:crypto";
import { addMonths, addTopUp, balance, creditsFor, deduct, lowBalance, renewPackage, revenuePerCredit, round2, sweepExpired, topUpKind } from "../credits";
import { DEFAULT_CATALOGUE, PLAN_PRESETS, firstPackage, normalizePlans, type PlanInput } from "../plans";
import { ELEVENLABS_USD_PER_MIN, ELEVENLABS_USD_PER_MSG, USD_TO_BHD, agent as defaultAgent } from "../seed";
import type {
  AgentSettings, AgentVersion, Alert, AuditEntry, Booking, BookingStatus, Conversation, CreditBatch, Doctor,
  CatalogPackage, KnowledgeItem, LedgerEntry, Locale, Permissions, StaffRequest, Tenant, UnansweredQuestion,
} from "../types";
import type { Data } from "./demo";
import { DuplicateError, SlotTakenError } from "../errors";
import { findDuplicate, nameKey } from "../tenant-keys";

/** Minimal query surface shared by `pg` (production) and PGlite (tests). */
export type Q = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
export interface Db {
  q: Q;
  /** Runs `fn` in one transaction; everything it queries commits or rolls back together. */
  tx<T>(fn: (q: Q) => Promise<T>): Promise<T>;
}

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
const num = (v: unknown) => Number(v);
const jsonish = <T>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : (v as T));

const tenantOf = (r: Row): Tenant => ({
  id: r.id, slug: r.slug, name: r.name, status: r.status, branding: jsonish(r.branding), plans: normalizePlans(jsonish(r.plan)),
  permissions: jsonish(r.permissions), allowedDomains: r.allowed_domains ?? [], zeroBalancePolicy: r.zero_balance_policy,
  lowBalanceThreshold: num(r.low_balance_threshold), retentionDays: r.retention_days, calendarConnected: r.calendar_connected,
  channels: jsonish(r.channels), openingHours: jsonish(r.opening_hours), createdAt: iso(r.created_at),
});
const bookingOf = (r: Row): Booking => ({
  id: r.id, tenantId: r.tenant_id, doctorId: r.doctor_id, patientName: r.patient_name, patientPhone: r.patient_phone,
  service: r.service ?? "", startsAt: iso(r.starts_at), durationMin: r.duration_min, status: r.status,
  conversationId: r.conversation_id ?? undefined, calendarEventId: r.calendar_event_id ?? undefined,
});
const batchOf = (r: Row): CreditBatch => ({
  id: r.id, tenantId: r.tenant_id, kind: r.kind, amount: num(r.amount), remaining: num(r.remaining),
  purchasedAt: iso(r.purchased_at), expiresAt: iso(r.expires_at), note: r.note ?? undefined, planId: r.plan_id ?? undefined,
});
const packageOf = (r: Row): CatalogPackage => ({
  id: r.id, name: r.name, nameAr: r.name_ar ?? "", description: r.description ?? "", type: r.type, includedCredits: r.included_credits,
  monthlyPriceBhd: num(r.monthly_price_bhd), pricePerCreditBhd: num(r.price_per_credit_bhd), rolloverCap: num(r.rollover_cap), archived: r.archived,
});
const staffRequestOf = (r: Row): StaffRequest => ({
  id: r.id, tenantId: r.tenant_id, kind: r.kind, name: r.name, phone: r.phone, text: r.text, urgent: r.urgent, language: r.language,
  conversationId: r.conversation_id ?? undefined, status: r.status, createdAt: iso(r.created_at), handledAt: r.handled_at ? iso(r.handled_at) : undefined,
});
const convOf = (r: Row): Conversation => ({
  id: r.id, tenantId: r.tenant_id, channel: r.channel, mode: r.mode, language: r.language, startedAt: iso(r.started_at),
  durationSec: r.duration_sec, messages: r.messages, outcome: r.outcome, summary: r.summary, sentiment: r.sentiment,
  transcript: jsonish(r.transcript), recordingUrl: undefined, // signed URLs for `recording_path` are issued by the storage layer
  creditsCharged: num(r.credits_charged), costUsd: num(r.cost_usd), elevenLabsConversationId: r.elevenlabs_conversation_id ?? undefined,
});
const ledgerOf = (r: Row): LedgerEntry => ({
  id: r.id, tenantId: r.tenant_id, at: iso(r.at), kind: r.kind, credits: num(r.credits), channel: r.channel ?? undefined,
  conversationId: r.conversation_id ?? undefined, note: r.note ?? undefined,
});

export const SCHEMA_ADDITIONS = [
  `alter table credit_batches add column if not exists plan_id text`,
  `create table if not exists packages (
     id uuid primary key default gen_random_uuid(),
     name text not null, name_ar text, description text,
     type text not null check (type in ('package', 'payg')),
     included_credits integer not null default 0,
     monthly_price_bhd numeric(10,3) not null,
     price_per_credit_bhd numeric(10,4) not null,
     rollover_cap numeric(4,3) not null default 0,
     archived boolean not null default false,
     created_at timestamptz not null default now())`,
  `alter table packages enable row level security`,
  `create table if not exists staff_requests (
     id uuid primary key default gen_random_uuid(),
     tenant_id uuid not null references tenants on delete cascade,
     kind text not null check (kind in ('message', 'handoff')),
     name text not null default '', phone text not null default '', text text not null default '',
     urgent boolean not null default false,
     language text not null default 'en',
     conversation_id text,
     status text not null default 'open' check (status in ('open', 'done')),
     created_at timestamptz not null default now(),
     handled_at timestamptz)`,
  `create index if not exists staff_requests_tenant on staff_requests (tenant_id, status, created_at desc)`,
  `alter table staff_requests enable row level security`,
];

export function createPgData(db: Db): Data {
  const { q } = db;

  // Multi-package support adds one column and one table. They are created here, once per server start, so the
  // deploy works without anyone running SQL by hand (supabase/migrations/0003_packages.sql holds the same statements).
  let schemaReady: Promise<void> | undefined;
  const ensureSchema = () => (schemaReady ??= (async () => {
    for (const sql of SCHEMA_ADDITIONS) await q(sql);
  })().catch((e) => { schemaReady = undefined; throw e; }));
  const tx: Db["tx"] = async (fn) => { await ensureSchema(); return db.tx(fn); };
  const tenantsWhere = async (where: string, params: unknown[]) => (await q<Row>(`select * from tenants ${where}`, params)).map(tenantOf);

  async function audit(run: Q, actor: string, action: string, tenantId?: string) {
    await run(`insert into audit_log (tenant_id, actor, action) values ($1, $2, $3)`, [tenantId ?? null, actor, action]);
  }

  /** Serializes client create/rename/domain changes so two quick submits cannot both pass the duplicate check. */
  async function lockTenantDirectory(run: Q) {
    await run(`select pg_advisory_xact_lock(hashtext('callsdash_tenant_directory'))`);
  }

  const savePlans = (run: Q, tenantId: string, plans: Tenant["plans"]) =>
    run(`update tenants set plan = $2 where id = $1`, [tenantId, JSON.stringify(plans)]);

  async function lockTenant(run: Q, tenantId: string) {
    const r = await run<Row>(`select * from tenants where id = $1 for update`, [tenantId]);
    if (!r[0]) throw new Error("unknown tenant");
    return tenantOf(r[0]);
  }

  const loadBatches = async (run: Q, tenantId: string) =>
    (await run<Row>(`select * from credit_batches where tenant_id = $1 order by purchased_at`, [tenantId])).map(batchOf);

  async function saveBatches(run: Q, before: CreditBatch[], after: CreditBatch[]) {
    const old = new Map(before.map((b) => [b.id, b]));
    for (const b of after) {
      const o = old.get(b.id);
      if (!o) {
        await run(
          `insert into credit_batches (id, tenant_id, kind, amount, remaining, purchased_at, expires_at, note, plan_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [b.id, b.tenantId, b.kind, b.amount, b.remaining, b.purchasedAt, b.expiresAt, b.note ?? null, b.planId ?? null]);
      } else if (o.remaining !== b.remaining) {
        await run(`update credit_batches set remaining = $2 where id = $1`, [b.id, b.remaining]);
      }
    }
  }

  const ledger = (run: Q, e: Omit<LedgerEntry, "id" | "at"> & { at?: string }) =>
    run(`insert into credit_ledger (tenant_id, at, kind, credits, channel, conversation_id, note) values ($1, coalesce($2, now()), $3, $4, $5, $6, $7)`,
      [e.tenantId, e.at ?? null, e.kind, e.credits, e.channel ?? null, e.conversationId ?? null, e.note ?? null]);

  async function sweep(run: Q, tenantId: string, now = new Date()) {
    const before = await loadBatches(run, tenantId);
    const { batches, expired } = sweepExpired(before, now);
    if (expired > 0) {
      await saveBatches(run, before, batches);
      await ledger(run, { tenantId, kind: "expiry", credits: -expired, note: "Credits expired" });
    }
    return batches;
  }

  async function walletOf(run: Q, t: Tenant) {
    const batches = await sweep(run, t.id);
    const now = new Date();
    const low = lowBalance(batches, t.plans, t.lowBalanceThreshold, now);
    return { batches, balance: balance(batches, now), low: low.low, reference: low.reference };
  }

  async function saveAgentRow(run: Q, tenantId: string, settings: AgentSettings, actor: string, summary: string) {
    await run(`update agents set settings = $2, elevenlabs_agent_id = $3, updated_at = now() where tenant_id = $1`, [tenantId, JSON.stringify(settings), settings.elevenLabsAgentId || null]);
    await run(`insert into agent_versions (tenant_id, author, summary, settings) values ($1,$2,$3,$4)`, [tenantId, actor, summary, JSON.stringify(settings)]);
    await audit(run, actor, `Agent settings saved: ${summary}`, tenantId);
  }

  const data: Data = {
    listTenants: async () => tenantsWhere("order by created_at", []),
    getTenant: async (id) => (await tenantsWhere("where id = $1", [id]))[0],
    getProfile: async (userId) => {
      const r = await q<Row>(`select role, tenant_id from profiles where id = $1`, [userId]);
      return r[0] ? { role: r[0].role, tenantId: r[0].tenant_id ?? null } : undefined;
    },
    getAgent: async (tenantId) => {
      const r = await q<Row>(`select settings, elevenlabs_agent_id from agents where tenant_id = $1`, [tenantId]);
      if (!r[0]) throw new Error("agent not found");
      return { ...jsonish<AgentSettings>(r[0].settings), elevenLabsAgentId: r[0].elevenlabs_agent_id ?? "" };
    },
    getAgentVersions: async (tenantId) =>
      (await q<Row>(`select * from agent_versions where tenant_id = $1 order by created_at desc`, [tenantId])).map((r): AgentVersion => ({
        id: r.id, tenantId: r.tenant_id, createdAt: iso(r.created_at), author: r.author, summary: r.summary, settings: jsonish(r.settings) })),
    getDoctors: async (tenantId) =>
      (await q<Row>(`select * from doctors where tenant_id = $1 order by name`, [tenantId])).map((r): Doctor => ({
        id: r.id, tenantId: r.tenant_id, name: r.name, specialty: r.specialty ?? "", color: r.color, googleCalendarId: r.google_calendar_id ?? undefined })),
    getBookings: async (tenantId) =>
      (await q<Row>(`select * from bookings where tenant_id = $1 order by starts_at`, [tenantId])).map(bookingOf),
    getConversations: async (tenantId) =>
      (await q<Row>(`select * from conversations where tenant_id = $1 order by started_at desc limit 1000`, [tenantId])).map(convOf),
    getConversation: async (tenantId, id) =>
      (await q<Row>(`select * from conversations where tenant_id = $1 and id = $2`, [tenantId, id])).map(convOf)[0],
    getKnowledge: async (tenantId) =>
      (await q<Row>(`select * from knowledge_items where tenant_id = $1 order by question`, [tenantId])).map((r): KnowledgeItem => ({
        id: r.id, tenantId: r.tenant_id, question: r.question, answer: r.answer, language: r.language })),
    // Unanswered questions are derived from conversations in a later phase; the demo table has no production counterpart yet.
    getUnanswered: async (): Promise<UnansweredQuestion[]> => [],
    getAlerts: async (tenantId) =>
      (await q<Row>(`select * from alerts where ($1::uuid is null or tenant_id = $1) order by at desc`, [tenantId ?? null])).map((r): Alert => ({
        id: r.id, tenantId: r.tenant_id, at: iso(r.at), severity: r.severity, message: r.message, resolved: r.resolved })),
    getAudit: async (tenantId) =>
      (await q<Row>(`select * from audit_log where ($1::uuid is null or tenant_id = $1) order by at desc limit 500`, [tenantId ?? null])).map((r): AuditEntry => ({
        id: r.id, tenantId: r.tenant_id ?? undefined, at: iso(r.at), actor: r.actor, action: r.action })),
    getLedger: async (tenantId) =>
      (await q<Row>(`select * from credit_ledger where tenant_id = $1 order by at desc limit 500`, [tenantId])).map(ledgerOf),
    getTopUpRequests: async () =>
      (await q<Row>(`select * from top_up_requests where status = 'open' order by at`)).map((r) => ({
        id: r.id, tenantId: r.tenant_id, at: iso(r.at), credits: r.credits, status: r.status as "open" | "done" })),

    getWallet: async (tenantId) => {
      // Read path without a transaction or row lock; only when credits have lapsed do we take the locked path that writes the expiry.
      const [rows, batches] = await Promise.all([tenantsWhere("where id = $1", [tenantId]), loadBatches(q, tenantId)]);
      const t = rows[0];
      if (!t) throw new Error("unknown tenant");
      const now = new Date();
      if (sweepExpired(batches, now).expired === 0) {
        const low = lowBalance(batches, t.plans, t.lowBalanceThreshold, now);
        return { batches, balance: balance(batches, now), low: low.low, reference: low.reference };
      }
      return tx(async (run) => walletOf(run, await lockTenant(run, tenantId)));
    },

    usageByChannel: async (tenantId, since) => {
      const out = { website: 0, whatsapp: 0, instagram: 0, phone: 0 };
      for (const r of await q<Row>(`select channel, sum(credits_charged) as c from conversations where tenant_id = $1 and started_at >= $2 group by channel`, [tenantId, since.toISOString()]))
        out[r.channel as keyof typeof out] = round2(num(r.c));
      return out;
    },

    audit: async (actor, action, tenantId) => { await audit(q, actor, action, tenantId); },

    recordConversation: async (tenantId, conv) => tx(async (run) => {
      const t = await lockTenant(run, tenantId); // serialises charges per tenant
      const credits = creditsFor(conv);
      const costUsd = round2(conv.mode === "voice" ? (conv.durationSec / 60) * ELEVENLABS_USD_PER_MIN : conv.messages * ELEVENLABS_USD_PER_MSG);
      const ins = await run<Row>(
        `insert into conversations (tenant_id, elevenlabs_conversation_id, channel, mode, language, started_at, duration_sec, messages, outcome, sentiment, summary, transcript, credits_charged, cost_usd)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         on conflict (elevenlabs_conversation_id) do nothing returning *`,
        [tenantId, conv.elevenLabsConversationId ?? null, conv.channel, conv.mode, conv.language, conv.startedAt, conv.durationSec, conv.messages,
         conv.outcome, conv.sentiment, conv.summary, JSON.stringify(conv.transcript), credits, costUsd]);
      if (!ins[0]) {
        const existing = await run<Row>(`select * from conversations where elevenlabs_conversation_id = $1`, [conv.elevenLabsConversationId]);
        return { conversation: convOf(existing[0]), shortfall: 0, duplicate: true };
      }
      const now = new Date();
      const before = await sweep(run, tenantId, now);
      const res = deduct(before, credits, now);
      await saveBatches(run, before, res.batches);
      await ledger(run, { tenantId, at: conv.startedAt, kind: "usage", credits: -credits, channel: conv.channel, conversationId: ins[0].id });
      const low = lowBalance(res.batches, t.plans, t.lowBalanceThreshold, now);
      if (res.shortfall > 0 || low.low) {
        const open = await run(`select 1 from alerts where tenant_id = $1 and not resolved and message like 'Low credit%'`, [tenantId]);
        if (open.length === 0) await run(`insert into alerts (tenant_id, severity, message) values ($1,'warning',$2)`, [tenantId, `Low credit balance: ${low.balance} credits left.`]);
      }
      return { conversation: convOf(ins[0]), shortfall: res.shortfall, duplicate: false };
    }),

    topUp: async (tenantId, credits, actor, note = "Top-up") => tx(async (run) => {
      const t = await lockTenant(run, tenantId);
      const before = await loadBatches(run, tenantId);
      const after = addTopUp(before, { id: randomUUID(), tenantId, amount: credits, now: new Date(), kind: topUpKind(t.plans), note });
      await saveBatches(run, before, after);
      await ledger(run, { tenantId, kind: "topup", credits, note });
      await run(`update top_up_requests set status = 'done' where tenant_id = $1 and status = 'open'`, [tenantId]);
      await run(`update alerts set resolved = true where tenant_id = $1 and message like 'Low credit%'`, [tenantId]);
      await audit(run, actor, `Added ${credits} credits`, tenantId);
    }),

    requestTopUp: async (tenantId, credits, actor) => tx(async (run) => {
      await run(`insert into top_up_requests (tenant_id, credits) values ($1,$2)`, [tenantId, credits]);
      await audit(run, actor, `Requested a top-up of ${credits} credits`, tenantId);
    }),

    renewTenantPackage: async (tenantId, actor, planId) => tx(async (run) => {
      const t = await lockTenant(run, tenantId);
      const plan = t.plans.find((p) => p.active && p.type === "package" && (!planId || p.id === planId));
      if (!plan) throw new Error("not a package plan");
      const periodStart = addMonths(plan.periodStart, 1);
      const before = await loadBatches(run, tenantId);
      const res = renewPackage(before, { tenantId, plan, periodStart, ids: { rollover: randomUUID(), package: randomUUID() }, adoptUnowned: firstPackage(t.plans)?.id === plan.id });
      await saveBatches(run, before, res.batches);
      await savePlans(run, tenantId, t.plans.map((p) => (p.id === plan.id ? { ...p, periodStart } : p)));
      if (res.lapsed > 0) await ledger(run, { tenantId, kind: "expiry", credits: -res.lapsed, note: `Unused credits lapsed (${plan.name})` });
      if (res.carried > 0) await ledger(run, { tenantId, kind: "rollover", credits: res.carried, note: `Rollover from previous month (${plan.name})` });
      await ledger(run, { tenantId, kind: "package_renewal", credits: plan.includedCredits, note: plan.name });
      await audit(run, actor, `Renewed ${plan.name}: ${res.carried} credits rolled over, ${res.lapsed} lapsed`, tenantId);
      return res;
    }),

    getStaffRequests: async (tenantId) => {
      await ensureSchema();
      return (await q<Row>(`select * from staff_requests where tenant_id = $1 order by created_at desc limit 500`, [tenantId])).map(staffRequestOf);
    },

    addStaffRequest: async (tenantId, r) => tx(async (run) => {
      const rows = await run<Row>(
        `insert into staff_requests (tenant_id, kind, name, phone, text, urgent, language, conversation_id) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [tenantId, r.kind, r.name, r.phone, r.text, r.urgent, r.language, r.conversationId ?? null]);
      return staffRequestOf(rows[0]);
    }),

    setStaffRequestStatus: async (tenantId, requestId, status, actor) => tx(async (run) => {
      const rows = await run(`update staff_requests set status = $3, handled_at = case when $3 = 'done' then now() else null end where tenant_id = $1 and id = $2 returning id`, [tenantId, requestId, status]);
      if (rows[0]) await audit(run, actor, status === "done" ? "Marked a message as handled" : "Reopened a message", tenantId);
    }),

    setOpeningHours: async (tenantId, hours, actor) => tx(async (run) => {
      await run(`update tenants set opening_hours = $2 where id = $1`, [tenantId, JSON.stringify(hours)]);
      await audit(run, actor, "Opening hours changed", tenantId);
    }),

    addPlan: async (tenantId, input, actor) => tx(async (run) => {
      const t = await lockTenant(run, tenantId);
      const start = new Date().toISOString();
      const plan = { ...input, contractRef: input.contractRef || undefined, id: randomUUID(), active: true, periodStart: start };
      await savePlans(run, tenantId, [...t.plans, plan]);
      if (plan.type === "package") {
        await saveBatches(run, [], [{ id: randomUUID(), tenantId, kind: "package", planId: plan.id, amount: plan.includedCredits, remaining: plan.includedCredits, purchasedAt: start, expiresAt: addMonths(start, 1), note: plan.name }]);
        await ledger(run, { tenantId, kind: "package_renewal", credits: plan.includedCredits, note: plan.name });
      }
      await audit(run, actor, `Added plan ${plan.name}`, tenantId);
      return plan;
    }),

    endPlan: async (tenantId, planId, actor) => tx(async (run) => {
      const t = await lockTenant(run, tenantId);
      const plan = t.plans.find((p) => p.id === planId && p.active);
      if (!plan || t.plans.filter((p) => p.active).length < 2) return false;
      await savePlans(run, tenantId, t.plans.map((p) => (p.id === planId ? { ...p, active: false } : p)));
      await audit(run, actor, `Ended plan ${plan.name}`, tenantId);
      return true;
    }),

    listPackages: async () => {
      await ensureSchema();
      let rows = await q<Row>(`select * from packages order by created_at, name`);
      if (rows.length === 0) {
        await tx(async (run) => {
          await run(`select pg_advisory_xact_lock(hashtext('callsdash_packages_seed'))`);
          if ((await run(`select 1 from packages limit 1`)).length > 0) return;
          for (const p of DEFAULT_CATALOGUE)
            await run(`insert into packages (name, name_ar, description, type, included_credits, monthly_price_bhd, price_per_credit_bhd, rollover_cap) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
              [p.name, p.nameAr, p.description, p.type, p.includedCredits, p.monthlyPriceBhd, p.pricePerCreditBhd, p.rolloverCap]);
        });
        rows = await q<Row>(`select * from packages order by created_at, name`);
      }
      return rows.map(packageOf);
    },

    savePackage: async (input, actor) => tx(async (run) => {
      await run(`select pg_advisory_xact_lock(hashtext('callsdash_packages_seed'))`);
      const all = (await run<Row>(`select * from packages`)).map(packageOf);
      if (all.some((x) => x.id !== input.id && nameKey(x.name) === nameKey(input.name))) throw new DuplicateError("name");
      const vals = [input.name, input.nameAr, input.description, input.type, input.includedCredits, input.monthlyPriceBhd, input.pricePerCreditBhd, input.rolloverCap];
      const rows = input.id && all.some((x) => x.id === input.id)
        ? await run<Row>(`update packages set name=$2, name_ar=$3, description=$4, type=$5, included_credits=$6, monthly_price_bhd=$7, price_per_credit_bhd=$8, rollover_cap=$9 where id=$1 returning *`, [input.id, ...vals])
        : await run<Row>(`insert into packages (name, name_ar, description, type, included_credits, monthly_price_bhd, price_per_credit_bhd, rollover_cap) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`, vals);
      await audit(run, actor, `${input.id ? "Updated" : "Created"} package "${input.name}"`);
      return packageOf(rows[0]);
    }),

    archivePackage: async (packageId, archived, actor) => tx(async (run) => {
      const rows = await run<Row>(`update packages set archived = $2 where id = $1 returning name`, [packageId, archived]);
      if (rows[0]) await audit(run, actor, `${archived ? "Archived" : "Restored"} package "${rows[0].name}"`);
    }),

    saveAgent: async (tenantId, settings, actor, summary) => tx((run) => saveAgentRow(run, tenantId, settings, actor, summary)),

    rollbackAgent: async (tenantId, versionId, actor) => tx(async (run) => {
      const v = await run<Row>(`select * from agent_versions where id = $1 and tenant_id = $2`, [versionId, tenantId]);
      if (!v[0]) throw new Error("version not found");
      await saveAgentRow(run, tenantId, jsonish<AgentSettings>(v[0].settings), actor, `Rolled back to version of ${iso(v[0].created_at).slice(0, 10)}`);
    }),

    addKnowledge: async (tenantId, question, answer, language: Locale, actor) => tx(async (run) => {
      await run(`insert into knowledge_items (tenant_id, question, answer, language) values ($1,$2,$3,$4)`, [tenantId, question, answer, language]);
      await audit(run, actor, "Knowledge item added", tenantId);
    }),
    deleteKnowledge: async (tenantId, id, actor) => tx(async (run) => {
      await run(`delete from knowledge_items where tenant_id = $1 and id = $2`, [tenantId, id]);
      await audit(run, actor, "Knowledge item deleted", tenantId);
    }),
    dismissUnanswered: async () => {},

    setBookingStatus: async (tenantId, bookingId, status: BookingStatus, actor) => tx(async (run) => {
      const r = await run(`update bookings set status = $3 where tenant_id = $1 and id = $2 returning id`, [tenantId, bookingId, status]);
      if (!r[0]) throw new Error("booking not found");
      await audit(run, actor, `Booking ${bookingId} set to ${status}`, tenantId);
    }),

    createBooking: async (tenantId, b, actor) => tx(async (run) => {
      try {
        const r = await run<Row>(
          `insert into bookings (tenant_id, doctor_id, patient_name, patient_phone, service, starts_at, duration_min, status, conversation_id, calendar_event_id)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
          [tenantId, b.doctorId, b.patientName, b.patientPhone, b.service, b.startsAt, b.durationMin, b.status, b.conversationId ?? null, b.calendarEventId ?? null]);
        await audit(run, actor, `Booking ${r[0].id} created`, tenantId);
        return bookingOf(r[0]);
      } catch (e) {
        if ((e as { code?: string }).code === "23505") throw new SlotTakenError();
        throw e;
      }
    }),

    updateBooking: async (tenantId, bookingId, patch, actor) => tx(async (run) => {
      try {
        const r = await run<Row>(
          `update bookings set starts_at = coalesce($3, starts_at), status = coalesce($4, status), calendar_event_id = coalesce($5, calendar_event_id)
           where tenant_id = $1 and id = $2 returning *`,
          [tenantId, bookingId, patch.startsAt ?? null, patch.status ?? null, patch.calendarEventId ?? null]);
        if (!r[0]) throw new Error("booking not found");
        await audit(run, actor, `Booking ${bookingId} updated`, tenantId);
        return bookingOf(r[0]);
      } catch (e) {
        if ((e as { code?: string }).code === "23505") throw new SlotTakenError();
        throw e;
      }
    }),

    addAlert: async (tenantId, severity, message) => { await q(`insert into alerts (tenant_id, severity, message) values ($1,$2,$3)`, [tenantId, severity, message]); },

    setDoctorCalendar: async (tenantId, doctorId, calendarId, actor) => tx(async (run) => {
      const r = await run<Row>(`update doctors set google_calendar_id = $3 where tenant_id = $1 and id = $2 returning name`, [tenantId, doctorId, calendarId || null]);
      if (!r[0]) throw new Error("doctor not found");
      await run(`update tenants set calendar_connected = exists (select 1 from doctors where tenant_id = $1 and google_calendar_id is not null) where id = $1`, [tenantId]);
      await audit(run, actor, `Calendar for ${r[0].name} ${calendarId ? "linked" : "unlinked"}`, tenantId);
    }),

    setPermissions: async (tenantId, p: Permissions, actor) => tx(async (run) => {
      await run(`update tenants set permissions = $2 where id = $1`, [tenantId, JSON.stringify(p)]);
      await audit(run, actor, "Client permissions changed", tenantId);
    }),

    updateTenant: async (tenantId, patch, actor) => tx(async (run) => {
      if (patch.allowedDomains) await lockTenantDirectory(run);
      const t = await lockTenant(run, tenantId);
      if (patch.allowedDomains) {
        const others = (await run<Row>(`select * from tenants where id <> $1`, [tenantId])).map(tenantOf);
        const clash = findDuplicate(others, { domains: patch.allowedDomains });
        if (clash) throw new DuplicateError(clash);
      }
      await run(
        `update tenants set zero_balance_policy = $2, allowed_domains = $3, low_balance_threshold = $4, status = $5, branding = $6 where id = $1`,
        [tenantId, patch.zeroBalancePolicy ?? t.zeroBalancePolicy, patch.allowedDomains ?? t.allowedDomains, patch.lowBalanceThreshold ?? t.lowBalanceThreshold,
         patch.status ?? t.status, JSON.stringify({ ...t.branding, ...(patch.branding ?? {}) })]);
      await audit(run, actor, "Client settings changed", tenantId);
    }),

    resolveAlert: async (alertId) => { await q(`update alerts set resolved = true where id = $1`, [alertId]); },

    createTenant: async (p) => tx(async (run) => {
      await lockTenantDirectory(run);
      const clash = findDuplicate((await run<Row>(`select * from tenants`)).map(tenantOf), { name: p.name, domains: p.domain ? [p.domain] : [] });
      if (clash) throw new DuplicateError(clash);
      const start = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
      const chosen = p.plan ?? (p.planType === "package" ? PLAN_PRESETS.clinic : PLAN_PRESETS.payg);
      const pkg = chosen.type === "package";
      const plan = { ...chosen, contractRef: (p.plan as { contractRef?: string } | undefined)?.contractRef || undefined, id: "plan-1", active: true, periodStart: start };
      const slugBase = p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "client";
      const taken = new Set((await run<Row>(`select slug from tenants where slug like $1`, [`${slugBase}%`])).map((r) => r.slug));
      let slug = slugBase;
      for (let i = 2; taken.has(slug); i++) slug = `${slugBase}-${i}`;
      const rows = await run<Row>(
        `insert into tenants (slug, name, branding, plan, allowed_domains) values ($1,$2,$3,$4,$5) returning *`,
        [slug, p.name, JSON.stringify({ displayName: p.name, displayNameAr: p.nameAr || p.name, primaryColor: p.color, domain: p.domain || undefined }),
         JSON.stringify([plan]), p.domain ? [p.domain] : []]);
      const t = tenantOf(rows[0]);
      const settings = defaultAgent("", p.name);
      await run(`insert into agents (tenant_id, elevenlabs_agent_id, settings) values ($1, null, $2)`, [t.id, JSON.stringify(settings)]);
      await run(`insert into agent_versions (tenant_id, author, summary, settings) values ($1,$2,'Initial clinic template',$3)`, [t.id, p.actor, JSON.stringify(settings)]);
      if (pkg) {
        await saveBatches(run, [], [{ id: randomUUID(), tenantId: t.id, kind: "package", planId: "plan-1", amount: chosen.includedCredits, remaining: chosen.includedCredits, purchasedAt: start, expiresAt: addMonths(start, 1), note: chosen.name }]);
        await ledger(run, { tenantId: t.id, kind: "package_renewal", credits: chosen.includedCredits, note: chosen.name });
      }
      await audit(run, p.actor, "Created client from clinic template", t.id);
      return t;
    }),

    deleteTenant: async (tenantId, actor) => tx(async (run) => {
      await lockTenantDirectory(run);
      const r = await run<Row>(`select name from tenants where id = $1 for update`, [tenantId]);
      if (!r[0]) return;
      await run(`delete from tenants where id = $1`, [tenantId]); // every client table cascades
      await audit(run, actor, `Deleted client "${r[0].name}"`);
    }),

    marginFor: async (tenantId, since) => {
      const t = (await tenantsWhere("where id = $1", [tenantId]))[0];
      const r = (await q<Row>(`select count(*) as n, coalesce(sum(credits_charged),0) as c, coalesce(sum(cost_usd),0) as u from conversations where tenant_id = $1 and started_at >= $2`, [tenantId, since.toISOString()]))[0];
      const credits = round2(num(r.c));
      const costBhd = round2(num(r.u) * USD_TO_BHD);
      const perCredit = revenuePerCredit(t.plans);
      const revenueBhd = round2(credits * perCredit);
      return { conversations: num(r.n), credits, costBhd, revenueBhd, marginBhd: round2(revenueBhd - costBhd) };
    },

    creditsOwed: async () => round2(num((await q<Row>(`select coalesce(sum(remaining),0) as s from credit_batches where remaining > 0 and expires_at > now()`))[0].s)),

    findTenantByAgent: async (agentId) => (await tenantsWhere("where id = (select tenant_id from agents where elevenlabs_agent_id = $1)", [agentId]))[0],
  };
  return data;
}
