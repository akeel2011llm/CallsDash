import { createHash, randomUUID } from "node:crypto";
import { addMonths, addTopUp, balance, creditsFor, deduct, lowBalance, renewPackage, revenuePerCredit, round2, sweepExpired, topUpKind } from "../credits";
import { DEFAULT_CATALOGUE, PLAN_PRESETS, firstPackage, normalizePlans, type PlanInput } from "../plans";
import { FLAT_RATES, USD_TO_BHD, agent as defaultAgent } from "../seed";
import { conversationCostUsd } from "../costing";
import type {
  AgentSettings, AgentToolCall, AgentVersion, Alert, AuditEntry, Booking, BookingMessage, BookingStatus, Conversation, CreditBatch, Doctor,
  CatalogPackage, KnowledgeItem, LedgerEntry, ChatSession, Channel, Customer, Item, Locale, Permissions, Profile, StaffRequest, Tenant, TenantSecrets, UnansweredQuestion,
} from "../types";
import type { Data } from "./demo";
import { DuplicateError, SlotTakenError } from "../errors";
import { findDuplicate, nameKey } from "../tenant-keys";
import { detectFlags, normalizeRules } from "../flags";

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
  id: r.id, slug: r.slug, name: r.name, status: r.status, branding: jsonish(r.branding), plans: normalizePlans(jsonish(r.plan)), alertRules: normalizeRules(r.alert_rules == null ? undefined : jsonish(r.alert_rules)),
  permissions: jsonish(r.permissions), allowedDomains: r.allowed_domains ?? [], zeroBalancePolicy: r.zero_balance_policy,
  lowBalanceThreshold: num(r.low_balance_threshold), retentionDays: r.retention_days, calendarConnected: r.calendar_connected,
  closures: r.closures == null ? [] : jsonish(r.closures),
  channels: jsonish(r.channels), openingHours: jsonish(r.opening_hours),
  integrations: r.integrations == null ? {} : jsonish<Tenant["integrations"]>(r.integrations),
  onboarding: ((o) => ({ ...o, done: o.done ?? [] }))(r.onboarding == null ? {} : jsonish<Partial<Tenant["onboarding"]>>(r.onboarding)), createdAt: iso(r.created_at),
});
const bookingOf = (r: Row): Booking => ({
  id: r.id, tenantId: r.tenant_id, doctorId: r.doctor_id, patientName: r.patient_name, patientPhone: r.patient_phone, patientCpr: r.patient_cpr ?? undefined,
  service: r.service ?? "", startsAt: iso(r.starts_at), durationMin: r.duration_min, status: r.status,
  conversationId: r.conversation_id ?? undefined, calendarEventId: r.calendar_event_id ?? undefined,
  notes: r.notes ?? undefined, source: r.source ?? "ai",
  language: r.language === "ar" || r.language === "en" ? r.language : undefined, message: r.wa_message == null ? undefined : jsonish<BookingMessage>(r.wa_message),
});
const batchOf = (r: Row): CreditBatch => ({
  id: r.id, tenantId: r.tenant_id, kind: r.kind, amount: num(r.amount), remaining: num(r.remaining),
  purchasedAt: iso(r.purchased_at), expiresAt: iso(r.expires_at), note: r.note ?? undefined, planId: r.plan_id ?? undefined,
});
const packageOf = (r: Row): CatalogPackage => ({
  id: r.id, name: r.name, nameAr: r.name_ar ?? "", description: r.description ?? "", type: r.type, includedCredits: r.included_credits,
  monthlyPriceBhd: num(r.monthly_price_bhd), pricePerCreditBhd: num(r.price_per_credit_bhd), rolloverCap: num(r.rollover_cap), archived: r.archived,
});
const profileOf = (r: Row): Profile => ({
  id: r.id, tenantId: r.tenant_id ?? null, role: r.role, doctorId: r.doctor_id ?? null, fullName: r.full_name ?? "", email: r.email ?? "",
  disabled: Boolean(r.disabled), mustChangePassword: Boolean(r.must_change_password), createdAt: iso(r.created_at),
});
const doctorOf = (r: Row): Doctor => ({
  id: r.id, tenantId: r.tenant_id, name: r.name, specialty: r.specialty ?? "", color: r.color, googleCalendarId: r.google_calendar_id ?? undefined,
  active: r.active ?? true, hours: r.hours == null ? null : jsonish(r.hours), timeOff: r.time_off == null ? [] : jsonish(r.time_off),
});
const sessionOf = (r: Row): ChatSession => ({ tenantId: r.tenant_id, channel: r.channel, externalId: r.external_id, conversationId: r.conversation_id, lastAt: iso(r.last_at) });
const staffRequestOf = (r: Row): StaffRequest => ({
  id: r.id, tenantId: r.tenant_id, kind: r.kind, name: r.name, phone: r.phone, text: r.text, urgent: r.urgent, language: r.language,
  conversationId: r.conversation_id ?? undefined, status: r.status, createdAt: iso(r.created_at), handledAt: r.handled_at ? iso(r.handled_at) : undefined,
});
const customerOf = (r: Row): Customer => ({
  id: r.id, tenantId: r.tenant_id, phone: r.phone, name: r.name, cpr: r.cpr ?? undefined, language: r.language ?? undefined, email: r.email ?? undefined,
  notes: r.notes ?? "", createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), lastContactAt: r.last_contact_at ? iso(r.last_contact_at) : undefined,
  conversationIds: r.conversation_ids ?? [], history: r.history == null ? [] : jsonish(r.history),
});
const itemOf = (r: Row): Item => ({
  id: r.id, tenantId: r.tenant_id, name: r.name, nameAr: r.name_ar ?? undefined, details: r.details, detailsAr: r.details_ar ?? undefined,
  price: r.price ?? undefined, keywords: r.keywords, active: r.active, hasImage: Boolean(r.has_image), createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
});
const ITEM_COLUMNS = `id, tenant_id, name, name_ar, details, details_ar, price, keywords, active, (image is not null) as has_image, created_at, updated_at`;
const convOf = (r: Row): Conversation => ({
  id: r.id, tenantId: r.tenant_id, channel: r.channel, mode: r.mode, language: r.language, startedAt: iso(r.started_at),
  durationSec: r.duration_sec, messages: r.messages, outcome: r.outcome, summary: r.summary, sentiment: r.sentiment,
  transcript: jsonish(r.transcript), recordingUrl: undefined, // signed URLs for `recording_path` are issued by the storage layer
  creditsCharged: num(r.credits_charged), costUsd: num(r.cost_usd), elevenLabsConversationId: r.elevenlabs_conversation_id ?? undefined,
  flags: (r.flags ?? []) as Conversation["flags"], reviewed: Boolean(r.reviewed),
});
const ledgerOf = (r: Row): LedgerEntry => ({
  id: r.id, tenantId: r.tenant_id, at: iso(r.at), kind: r.kind, credits: num(r.credits), channel: r.channel ?? undefined,
  conversationId: r.conversation_id ?? undefined, note: r.note ?? undefined,
});

/** Changes whenever a statement below is added or edited. */
export const schemaVersion = () => createHash("sha1").update(SCHEMA_ADDITIONS.join("\n")).digest("hex");

export const SCHEMA_ADDITIONS = [
  // ElevenLabs conversation ids look like "conv_01j..." and are not uuids; the agent passes one with every booking
  `alter table bookings alter column conversation_id type text using conversation_id::text`,
  `alter table credit_batches add column if not exists plan_id text`,
  `create table if not exists agent_tool_calls (
     id uuid primary key default gen_random_uuid(),
     tenant_id uuid references tenants on delete cascade,
     at timestamptz not null default now(),
     tool text not null, ok boolean not null, code text,
     detail text not null default '', ms integer not null default 0)`,
  `create index if not exists agent_tool_calls_at on agent_tool_calls (tenant_id, at desc)`,
  `alter table agent_tool_calls enable row level security`,
  `alter type user_role add value if not exists 'doctor'`,
  `alter table profiles add column if not exists doctor_id uuid references doctors on delete set null`,
  `alter table bookings add column if not exists notes text`,
  `alter table doctors add column if not exists active boolean not null default true`,
  `alter table doctors add column if not exists hours jsonb`,
  `alter table doctors add column if not exists time_off jsonb not null default '[]'`,
  `alter table tenants add column if not exists closures jsonb not null default '[]'`,
  `alter table credit_ledger drop constraint if exists credit_ledger_kind_check`,
  `do $$ begin if not exists (select 1 from pg_constraint where conname = 'credit_ledger_kind_v2') then
     alter table credit_ledger add constraint credit_ledger_kind_v2 check (kind in ('topup', 'package_renewal', 'rollover', 'usage', 'expiry', 'adjustment'));
   end if; end $$`,
  `alter table bookings add column if not exists source text not null default 'ai'`,
  // the patient's Bahraini CPR number; the agent finds a patient's bookings by it
  `alter table bookings add column if not exists patient_cpr text`,
  `create index if not exists bookings_patient_cpr on bookings (tenant_id, patient_cpr)`,
  // the language of the patient's WhatsApp confirmation, and what happened when it was sent
  `alter table bookings add column if not exists language text`,
  `alter table bookings add column if not exists wa_message jsonb`,
  // "completed" is a new status; the original check only knew the first four
  `do $$ begin if not exists (select 1 from pg_constraint where conname = 'bookings_status_v2') then
     alter table bookings drop constraint if exists bookings_status_check;
     alter table bookings add constraint bookings_status_v2 check (status in ('confirmed', 'rescheduled', 'completed', 'cancelled', 'no_show'));
   end if; end $$`,
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
  `alter table tenants add column if not exists alert_rules jsonb`,
  `alter table conversations add column if not exists flags text[] not null default '{}'`,
  `alter table conversations add column if not exists reviewed boolean not null default false`,
  `alter table profiles add column if not exists email text not null default ''`,
  `alter table profiles add column if not exists disabled boolean not null default false`,
  `alter table profiles add column if not exists must_change_password boolean not null default false`,
  `alter table profiles add column if not exists created_at timestamptz not null default now()`,
  `create unique index if not exists profiles_email_unique on profiles (lower(email)) where email <> ''`,
  `update profiles p set email = u.email from auth.users u where u.id = p.id and p.email = '' and u.email is not null`,
  `alter table tenants add column if not exists onboarding jsonb not null default '{}'`,
  `alter table tenants add column if not exists integrations jsonb not null default '{}'`,
  `create table if not exists tenant_secrets (
     tenant_id uuid primary key references tenants on delete cascade,
     data jsonb not null default '{}',
     updated_at timestamptz not null default now())`,
  `alter table tenant_secrets enable row level security`, // no policy: only the server's own connection can read it
  `create table if not exists app_settings (key text primary key, value jsonb not null, updated_at timestamptz not null default now())`,
  `alter table app_settings enable row level security`,
  `create table if not exists chat_sessions (
     tenant_id uuid not null references tenants on delete cascade,
     channel text not null,
     external_id text not null,
     conversation_id text not null,
     last_at timestamptz not null default now(),
     primary key (tenant_id, channel, external_id))`,
  `create index if not exists chat_sessions_conversation on chat_sessions (conversation_id)`,
  `alter table chat_sessions enable row level security`,
  // the people the assistant has talked to, found again by the last 8 digits of their phone number
  `create table if not exists customers (
     id uuid primary key default gen_random_uuid(),
     tenant_id uuid not null references tenants on delete cascade,
     phone text not null,
     phone_key text not null,
     name text not null default '',
     cpr text,
     language text,
     email text,
     notes text not null default '',
     conversation_ids text[] not null default '{}',
     history jsonb not null default '[]',
     last_contact_at timestamptz,
     created_at timestamptz not null default now(),
     updated_at timestamptz not null default now())`,
  `create unique index if not exists customers_phone on customers (tenant_id, phone_key)`,
  `create index if not exists customers_conversations on customers using gin (conversation_ids)`,
  `alter table customers enable row level security`,
  `create index if not exists customers_cpr on customers (tenant_id, cpr) where cpr is not null`,
  // what the clinic offers, shown by the assistant with a photo (the photo is a small data: URL kept apart from the list queries)
  `create table if not exists items (
     id uuid primary key default gen_random_uuid(),
     tenant_id uuid not null references tenants on delete cascade,
     name text not null,
     name_ar text,
     details text not null default '',
     details_ar text,
     price text,
     keywords text not null default '',
     active boolean not null default true,
     image text,
     created_at timestamptz not null default now(),
     updated_at timestamptz not null default now())`,
  `create index if not exists items_tenant on items (tenant_id, name)`,
  `alter table items enable row level security`,
  `create index if not exists customers_cpr on customers (tenant_id, cpr) where cpr is not null`,
  `create index if not exists conversations_flagged on conversations (tenant_id, started_at desc) where cardinality(flags) > 0`,
];

export function createPgData(db: Db): Data {
  const { q } = db;

  // Multi-package support adds one column and one table. They are created here, once per server start, so the
  // deploy works without anyone running SQL by hand (supabase/migrations/0003_packages.sql holds the same statements).
  let schemaReady: Promise<void> | undefined;
  const ensureSchema = () => (schemaReady ??= (async () => {
    // Every cold server would otherwise repeat dozens of statements, each a round trip to the database, before its first page.
    // The version is stored once everything has been applied, so later starts need a single check.
    const version = schemaVersion();
    const stored = await q<Row>(`select value from app_settings where key = 'schema_version'`).catch(() => []);
    if (stored[0] && String(stored[0].value).replace(/^"|"$/g, "") === version) return; // a jsonb string may arrive quoted or already parsed
    for (const sql of SCHEMA_ADDITIONS) await q(sql);
    await q(`insert into app_settings (key, value) values ('schema_version', $1) on conflict (key) do update set value = $1, updated_at = now()`, [JSON.stringify(version)]);
  })().catch((e) => { schemaReady = undefined; throw e; }));
  const tx: Db["tx"] = async (fn) => { await ensureSchema(); return db.tx(fn); };
  const tenantsWhere = async (where: string, params: unknown[]) => {
    await ensureSchema(); // new columns must exist before `select *` can return them
    return (await q<Row>(`select * from tenants ${where}`, params)).map(tenantOf);
  };

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
      await ensureSchema(); // the sign-in check reads the new columns
      const r = await q<Row>(`select * from profiles where id = $1`, [userId]);
      return r[0] ? profileOf(r[0]) : undefined;
    },
    listProfiles: async (tenantId) => {
      await ensureSchema();
      const r = tenantId
        ? await q<Row>(`select * from profiles where tenant_id = $1 order by created_at`, [tenantId])
        : await q<Row>(`select * from profiles order by created_at`);
      return r.map(profileOf);
    },
    // The auth user is created first (by the caller), so its id is what this row is keyed on.
    saveProfile: async (p, actor) => tx(async (run) => {
      const dup = await run<Row>(`select id from profiles where lower(email) = lower($1) and id <> $2`, [p.email, p.id]);
      if (dup[0]) throw new DuplicateError("email");
      const existed = (await run<Row>(`select 1 from profiles where id = $1`, [p.id])).length > 0;
      await run(
        `insert into profiles (id, tenant_id, role, full_name, email, disabled, must_change_password, doctor_id) values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (id) do update set tenant_id = $2, role = $3, full_name = $4, email = $5, disabled = $6, must_change_password = $7, doctor_id = $8`,
        [p.id, p.tenantId, p.role, p.fullName, p.email, p.disabled, p.mustChangePassword, p.doctorId ?? null]);
      await audit(run, actor, `User ${existed ? "updated" : "created"}: ${p.email} (${p.role})`, p.tenantId ?? undefined);
    }),
    patchProfile: async (userId, patch, actor, note) => tx(async (run) => {
      const r = await run<Row>(`select * from profiles where id = $1 for update`, [userId]);
      if (!r[0]) return;
      const cur = profileOf(r[0]);
      const next = { ...cur, ...patch };
      if (patch.email && patch.email.toLowerCase() !== cur.email.toLowerCase()
        && (await run<Row>(`select 1 from profiles where lower(email) = lower($1) and id <> $2`, [patch.email, userId])).length) throw new DuplicateError("email");
      await run(`update profiles set role = $2, full_name = $3, disabled = $4, must_change_password = $5, email = $6, doctor_id = $7 where id = $1`,
        [userId, next.role, next.fullName, next.disabled, next.mustChangePassword, next.email, next.doctorId ?? null]);
      await audit(run, actor, `${note}: ${cur.email}`, cur.tenantId ?? undefined);
    }),
    removeProfile: async (userId, actor) => tx(async (run) => {
      const r = await run<Row>(`delete from profiles where id = $1 returning email, tenant_id`, [userId]);
      if (r[0]) await audit(run, actor, `User deleted: ${r[0].email}`, r[0].tenant_id ?? undefined);
    }),
    setIntegrations: async (tenantId, integrations, actor, note) => tx(async (run) => {
      await run(`update tenants set integrations = $2 where id = $1`, [tenantId, JSON.stringify(integrations)]);
      if (note) await audit(run, actor, note, tenantId);
    }),
    setChannelStatus: async (tenantId, channel: Channel, status, actor) => tx(async (run) => {
      const t = await lockTenant(run, tenantId);
      if (t.channels[channel] === status) return;
      await run(`update tenants set channels = $2 where id = $1`, [tenantId, JSON.stringify({ ...t.channels, [channel]: status })]);
      await audit(run, actor, `Channel ${channel} set to ${status}`, tenantId);
    }),
    getSecrets: async (tenantId): Promise<TenantSecrets> => {
      await ensureSchema();
      const r = await q<Row>(`select data from tenant_secrets where tenant_id = $1`, [tenantId]);
      return r[0] ? jsonish<TenantSecrets>(r[0].data) : {};
    },
    setSecrets: async (tenantId, patch) => tx(async (run) => {
      const r = await run<Row>(`select data from tenant_secrets where tenant_id = $1 for update`, [tenantId]);
      const next: Record<string, string> = r[0] ? { ...jsonish<Record<string, string>>(r[0].data) } : {};
      for (const [k, v] of Object.entries(patch)) if (v) next[k] = v; else delete next[k];
      await run(`insert into tenant_secrets (tenant_id, data) values ($1,$2) on conflict (tenant_id) do update set data = $2, updated_at = now()`, [tenantId, JSON.stringify(next)]);
    }),
    getSetting: async (key) => {
      await ensureSchema();
      const r = await q<Row>(`select value from app_settings where key = $1`, [key]);
      return r[0] ? jsonish<unknown>(r[0].value) : undefined;
    },
    setSetting: async (key, value) => { await ensureSchema(); await q(`insert into app_settings (key, value) values ($1,$2) on conflict (key) do update set value = $2, updated_at = now()`, [key, JSON.stringify(value)]); },
    getChatSession: async (tenantId, channel, externalId) => {
      await ensureSchema();
      const r = await q<Row>(`select * from chat_sessions where tenant_id = $1 and channel = $2 and external_id = $3`, [tenantId, channel, externalId]);
      return r[0] ? sessionOf(r[0]) : undefined;
    },
    findChatSession: async (conversationId) => {
      await ensureSchema();
      const r = await q<Row>(`select * from chat_sessions where conversation_id = $1 limit 1`, [conversationId]);
      return r[0] ? sessionOf(r[0]) : undefined;
    },
    saveChatSession: async (s: ChatSession) => {
      await ensureSchema();
      await q(`insert into chat_sessions (tenant_id, channel, external_id, conversation_id, last_at) values ($1,$2,$3,$4,$5)
               on conflict (tenant_id, channel, external_id) do update set conversation_id = $4, last_at = $5`, [s.tenantId, s.channel, s.externalId, s.conversationId, s.lastAt]);
    },
    deleteChatSession: async (conversationId) => { await ensureSchema(); await q(`delete from chat_sessions where conversation_id = $1`, [conversationId]); },
    setOnboarding: async (tenantId, onboarding, actor, note) => tx(async (run) => {
      await run(`update tenants set onboarding = $2 where id = $1`, [tenantId, JSON.stringify(onboarding)]);
      if (note) await audit(run, actor, note, tenantId);
    }),
    getAgent: async (tenantId) => {
      const r = await q<Row>(`select settings, elevenlabs_agent_id from agents where tenant_id = $1`, [tenantId]);
      if (!r[0]) throw new Error("agent not found");
      return { ...jsonish<AgentSettings>(r[0].settings), elevenLabsAgentId: r[0].elevenlabs_agent_id ?? "" };
    },
    getAgentVersions: async (tenantId) =>
      (await q<Row>(`select * from agent_versions where tenant_id = $1 order by created_at desc`, [tenantId])).map((r): AgentVersion => ({
        id: r.id, tenantId: r.tenant_id, createdAt: iso(r.created_at), author: r.author, summary: r.summary, settings: jsonish(r.settings) })),
    getDoctors: async (tenantId) =>
      (await ensureSchema(), await q<Row>(`select * from doctors where tenant_id = $1 order by name`, [tenantId])).map(doctorOf),
    getBookings: async (tenantId) =>
      (await q<Row>(`select * from bookings where tenant_id = $1 order by starts_at`, [tenantId])).map(bookingOf),
    getConversations: async (tenantId) =>
      (await ensureSchema(), await q<Row>(`select * from conversations where tenant_id = $1 order by started_at desc limit 1000`, [tenantId])).map(convOf),
    getConversation: async (tenantId, id) =>
      (await ensureSchema(), await q<Row>(`select * from conversations where tenant_id = $1 and id = $2`, [tenantId, id])).map(convOf)[0],
    getKnowledge: async (tenantId) =>
      (await q<Row>(`select * from knowledge_items where tenant_id = $1 order by question`, [tenantId])).map((r): KnowledgeItem => ({
        id: r.id, tenantId: r.tenant_id, question: r.question, answer: r.answer, language: r.language })),
    // Unanswered questions are derived from conversations in a later phase; the demo table has no production counterpart yet.
    getUnanswered: async (): Promise<UnansweredQuestion[]> => [],
    getAlerts: async (tenantId) =>
      (await q<Row>(`select * from alerts where ($1::uuid is null or tenant_id = $1) order by at desc`, [tenantId ?? null])).map((r): Alert => ({
        id: r.id, tenantId: r.tenant_id, at: iso(r.at), severity: r.severity, message: r.message, resolved: r.resolved })),
    logToolCall: async (e) => {
      await ensureSchema();
      await q(`insert into agent_tool_calls (tenant_id, tool, ok, code, detail, ms) values ($1, $2, $3, $4, $5, $6)`,
        [e.tenantId ?? null, e.tool, e.ok, e.code ?? null, e.detail.slice(0, 600), Math.round(e.ms)]);
      // a month is plenty for chasing a problem; the table never grows past that
      if (Math.random() < 0.05) await q(`delete from agent_tool_calls where at < now() - interval '30 days'`);
    },
    getToolCalls: async (tenantId, limit = 30) => {
      await ensureSchema();
      return (await q<Row>(`select * from agent_tool_calls where ($1::uuid is null or tenant_id = $1) order by at desc limit $2`, [tenantId ?? null, limit])).map((r): AgentToolCall => ({
        id: r.id, tenantId: r.tenant_id ?? undefined, at: iso(r.at), tool: r.tool, ok: r.ok, code: r.code ?? undefined, detail: r.detail, ms: r.ms }));
    },
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
      const flags = detectFlags(conv, t.alertRules);
      const costUsd = conv.costUsd ?? conversationCostUsd(conv, FLAT_RATES);
      const ins = await run<Row>(
        `insert into conversations (tenant_id, elevenlabs_conversation_id, channel, mode, language, started_at, duration_sec, messages, outcome, sentiment, summary, transcript, credits_charged, cost_usd, flags)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         on conflict (elevenlabs_conversation_id) do nothing returning *`,
        [tenantId, conv.elevenLabsConversationId ?? null, conv.channel, conv.mode, conv.language, conv.startedAt, conv.durationSec, conv.messages,
         conv.outcome, conv.sentiment, conv.summary, JSON.stringify(conv.transcript), credits, costUsd, flags]);
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
      if (t.alertRules.emergency.notifyStaff && flags.includes("emergency"))
        await run(`insert into staff_requests (tenant_id, kind, name, phone, text, urgent, language, conversation_id) values ($1,'handoff','','',$2,true,$3,$4)`,
          [tenantId, `Call flagged as an emergency: ${conv.summary}`, conv.language, ins[0].id]);
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

    getCustomers: async (tenantId) => {
      await ensureSchema();
      return (await q<Row>(`select * from customers where tenant_id = $1 order by coalesce(last_contact_at, created_at) desc limit 5000`, [tenantId])).map(customerOf);
    },
    getCustomer: async (tenantId, customerId) => {
      await ensureSchema();
      if (!/^[0-9a-f-]{36}$/i.test(customerId)) return undefined;
      const rows = await q<Row>(`select * from customers where tenant_id = $1 and id = $2`, [tenantId, customerId]);
      return rows[0] ? customerOf(rows[0]) : undefined;
    },
    findCustomer: async (tenantId, by) => {
      await ensureSchema();
      const rows = await q<Row>(
        `select * from customers where tenant_id = $1 and (($2::text is not null and phone_key = $2) or ($3::text is not null and $3 = any(conversation_ids)) or ($4::text is not null and cpr = $4)) limit 1`,
        [tenantId, by.phoneKey || null, by.conversationId || null, by.cpr || null]);
      return rows[0] ? customerOf(rows[0]) : undefined;
    },
    putCustomer: async (tenantId, c, actor) => tx(async (run) => {
      const phoneKey = c.phone.replace(/\D/g, "").slice(-8);
      const values = [tenantId, c.phone, phoneKey, c.name, c.cpr ?? null, c.language ?? null, c.email ?? null, c.notes, c.conversationIds, JSON.stringify(c.history), c.lastContactAt ?? null];
      let rows: Row[];
      if (c.id) {
        rows = await run<Row>(
          `update customers set phone = $2, phone_key = $3, name = $4, cpr = $5, language = $6, email = $7, notes = $8, conversation_ids = $9, history = $10, last_contact_at = $11, updated_at = now()
           where tenant_id = $1 and id = $12 returning *`, [...values, c.id]);
      } else {
        // two calls from the same phone at once: the second finds the first one's row instead of failing
        rows = await run<Row>(
          `insert into customers (tenant_id, phone, phone_key, name, cpr, language, email, notes, conversation_ids, history, last_contact_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict (tenant_id, phone_key) do nothing returning *`, values);
        if (!rows[0]) rows = await run<Row>(`select * from customers where tenant_id = $1 and phone_key = $2`, [tenantId, phoneKey]);
      }
      if (!rows[0]) throw new Error("customer not found");
      // the assistant saves after every conversation; only people's own changes belong in the audit log
      if (actor !== "assistant") await audit(run, actor, `${c.id ? "Customer updated" : "Customer added"}: ${c.name || c.phone}`, tenantId);
      return customerOf(rows[0]);
    }),
    deleteCustomer: async (tenantId, customerId, actor) => tx(async (run) => {
      if (!/^[0-9a-f-]{36}$/i.test(customerId)) return;
      const r = await run(`delete from customers where tenant_id = $1 and id = $2 returning id`, [tenantId, customerId]);
      if (r[0]) await audit(run, actor, "Customer deleted", tenantId);
    }),

    getItems: async (tenantId) => {
      await ensureSchema();
      return (await q<Row>(`select ${ITEM_COLUMNS} from items where tenant_id = $1 order by lower(name) limit 2000`, [tenantId])).map(itemOf);
    },
    getItem: async (tenantId, itemId) => {
      await ensureSchema();
      if (!/^[0-9a-f-]{36}$/i.test(itemId)) return undefined;
      const rows = await q<Row>(`select ${ITEM_COLUMNS} from items where tenant_id = $1 and id = $2`, [tenantId, itemId]);
      return rows[0] ? itemOf(rows[0]) : undefined;
    },
    getItemImage: async (tenantId, itemId) => {
      await ensureSchema();
      if (!/^[0-9a-f-]{36}$/i.test(itemId)) return undefined;
      const rows = await q<Row>(`select image from items where tenant_id = $1 and id = $2`, [tenantId, itemId]);
      return rows[0]?.image ?? undefined;
    },
    putItem: async (tenantId, i, image, actor) => tx(async (run) => {
      // $11: 0 keeps the stored photo, 1 replaces it with $12 (null removes it)
      const values = [tenantId, i.name, i.nameAr ?? null, i.details, i.detailsAr ?? null, i.price ?? null, i.keywords, i.active, image === undefined ? 0 : 1, image ?? null];
      let rows: Row[];
      if (i.id) {
        rows = await run<Row>(
          `update items set name = $2, name_ar = $3, details = $4, details_ar = $5, price = $6, keywords = $7, active = $8, image = case when $9 = 1 then $10 else image end, updated_at = now()
           where tenant_id = $1 and id = $11 returning ${ITEM_COLUMNS}`, [...values, i.id]);
      } else {
        rows = await run<Row>(
          `insert into items (tenant_id, name, name_ar, details, details_ar, price, keywords, active, image) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning ${ITEM_COLUMNS}`, [...values.slice(0, 8), image ?? null]);
      }
      if (!rows[0]) throw new Error("item not found");
      await audit(run, actor, `${i.id ? "Catalogue item updated" : "Catalogue item added"}: ${i.name}`, tenantId);
      return itemOf(rows[0]);
    }),
    deleteItem: async (tenantId, itemId, actor) => tx(async (run) => {
      if (!/^[0-9a-f-]{36}$/i.test(itemId)) return;
      const r = await run<Row>(`delete from items where tenant_id = $1 and id = $2 returning name`, [tenantId, itemId]);
      if (r[0]) await audit(run, actor, `Catalogue item deleted: ${r[0].name}`, tenantId);
    }),

    setStaffRequestStatus: async (tenantId, requestId, status, actor) => tx(async (run) => {
      const rows = await run(`update staff_requests set status = $3, handled_at = case when $3 = 'done' then now() else null end where tenant_id = $1 and id = $2 returning id`, [tenantId, requestId, status]);
      if (rows[0]) await audit(run, actor, status === "done" ? "Marked a message as handled" : "Reopened a message", tenantId);
    }),

    setAlertRules: async (tenantId, rules, actor) => tx(async (run) => {
      await run(`update tenants set alert_rules = $2 where id = $1`, [tenantId, JSON.stringify(rules)]);
      await audit(run, actor, "Alert rules changed", tenantId);
    }),

    setConversationReviewed: async (tenantId, conversationId, reviewed, actor) => tx(async (run) => {
      const rows = await run(`update conversations set reviewed = $3 where tenant_id = $1 and id = $2 returning id`, [tenantId, conversationId, reviewed]);
      if (rows[0]) await audit(run, actor, reviewed ? "Reviewed a flagged conversation" : "Reopened a flagged conversation", tenantId);
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
          `insert into bookings (tenant_id, doctor_id, patient_name, patient_phone, service, starts_at, duration_min, status, conversation_id, calendar_event_id, notes, source, patient_cpr, language)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
          [tenantId, b.doctorId, b.patientName, b.patientPhone, b.service, b.startsAt, b.durationMin, b.status, b.conversationId ?? null, b.calendarEventId ?? null, b.notes ?? null, b.source ?? "ai", b.patientCpr ?? null, b.language ?? null]);
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
          `update bookings set starts_at = coalesce($3, starts_at), status = coalesce($4, status), calendar_event_id = coalesce($5, calendar_event_id), notes = coalesce($6, notes),
             patient_name = coalesce($7, patient_name), patient_phone = coalesce($8, patient_phone), service = coalesce($9, service), doctor_id = coalesce($10, doctor_id),
             patient_cpr = coalesce($11, patient_cpr), language = coalesce($12, language)
           where tenant_id = $1 and id = $2 returning *`,
          [tenantId, bookingId, patch.startsAt ?? null, patch.status ?? null, patch.calendarEventId ?? null, patch.notes ?? null,
           patch.patientName ?? null, patch.patientPhone ?? null, patch.service ?? null, patch.doctorId ?? null, patch.patientCpr ?? null, patch.language ?? null]);
        if (!r[0]) throw new Error("booking not found");
        await audit(run, actor, `Booking ${bookingId} updated`, tenantId);
        return bookingOf(r[0]);
      } catch (e) {
        if ((e as { code?: string }).code === "23505") throw new SlotTakenError();
        throw e;
      }
    }),

    setBookingMessage: async (tenantId, bookingId, message) => {
      await ensureSchema();
      const r = await q<Row>(`update bookings set wa_message = $3 where tenant_id = $1 and id = $2 returning *`, [tenantId, bookingId, JSON.stringify(message)]);
      return r[0] ? bookingOf(r[0]) : undefined;
    },

    addAlert: async (tenantId, severity, message) => { await q(`insert into alerts (tenant_id, severity, message) values ($1,$2,$3)`, [tenantId, severity, message]); },

    addDoctor: async (tenantId, input, actor) => tx(async (run) => {
      const colours = ["#0e7c86", "#d97706", "#be185d", "#7c3aed", "#c2410c", "#2563eb", "#15803d"];
      const n = Number((await run<Row>(`select count(*)::int as n from doctors where tenant_id = $1`, [tenantId]))[0].n);
      const r = await run<Row>(`insert into doctors (tenant_id, name, specialty, color) values ($1,$2,$3,$4) returning *`, [tenantId, input.name, input.specialty, colours[n % colours.length]]);
      await audit(run, actor, `Doctor added: ${input.name}`, tenantId);
      return doctorOf(r[0]);
    }),

    removeDoctor: async (tenantId, doctorId, actor) => tx(async (run) => {
      const r = await run<Row>(`delete from doctors where tenant_id = $1 and id = $2 returning name`, [tenantId, doctorId]);
      if (!r[0]) throw new Error("doctor not found");
      await run(`update tenants set calendar_connected = exists (select 1 from doctors where tenant_id = $1 and google_calendar_id is not null) where id = $1`, [tenantId]);
      await audit(run, actor, `Doctor removed: ${r[0].name}`, tenantId);
    }),

    updateDoctor: async (tenantId, doctorId, patch, actor) => tx(async (run) => {
      const cur = await run<Row>(`select * from doctors where tenant_id = $1 and id = $2 for update`, [tenantId, doctorId]);
      if (!cur[0]) throw new Error("doctor not found");
      const d = { ...doctorOf(cur[0]), ...patch };
      const r = await run<Row>(`update doctors set name = $3, specialty = $4, color = $5, active = $6, hours = $7, time_off = $8 where tenant_id = $1 and id = $2 returning *`,
        [tenantId, doctorId, d.name, d.specialty, d.color, d.active !== false, d.hours ? JSON.stringify(d.hours) : null, JSON.stringify(d.timeOff ?? [])]);
      await audit(run, actor, `Doctor updated: ${d.name}`, tenantId);
      return doctorOf(r[0]);
    }),

    deleteBooking: async (tenantId, bookingId, actor) => tx(async (run) => {
      const r = await run<Row>(`delete from bookings where tenant_id = $1 and id = $2 returning patient_name, starts_at`, [tenantId, bookingId]);
      if (!r[0]) throw new Error("booking not found");
      await audit(run, actor, `Booking deleted: ${r[0].patient_name} ${iso(r[0].starts_at)}`, tenantId);
    }),

    updateKnowledge: async (tenantId, id, p, actor) => tx(async (run) => {
      const r = await run(`update knowledge_items set question = $3, answer = $4, language = $5 where tenant_id = $1 and id = $2 returning id`, [tenantId, id, p.question, p.answer, p.language]);
      if (r[0]) await audit(run, actor, "Knowledge item edited", tenantId);
    }),

    deleteStaffRequest: async (tenantId, requestId, actor) => tx(async (run) => {
      const r = await run(`delete from staff_requests where tenant_id = $1 and id = $2 returning id`, [tenantId, requestId]);
      if (r[0]) await audit(run, actor, "Message deleted", tenantId);
    }),

    deleteConversation: async (tenantId, conversationId, actor) => tx(async (run) => {
      // the ledger keeps the credits it used; staff requests and bookings only lose their link to it
      await run(`update staff_requests set conversation_id = null where tenant_id = $1 and conversation_id = $2`, [tenantId, conversationId]);
      const r = await run(`delete from conversations where tenant_id = $1 and id = $2 returning id`, [tenantId, conversationId]);
      if (r[0]) await audit(run, actor, "Conversation deleted", tenantId);
    }),

    adjustCredits: async (tenantId, credits, note, actor) => tx(async (run) => {
      const t = await lockTenant(run, tenantId);
      const before = await loadBatches(run, tenantId);
      const after = credits > 0
        ? addTopUp(before, { id: randomUUID(), tenantId, amount: credits, now: new Date(), kind: topUpKind(t.plans), note })
        : deduct(before, -credits, new Date()).batches;
      await saveBatches(run, before, after);
      await ledger(run, { tenantId, kind: "adjustment", credits, note });
      await audit(run, actor, `Credit adjustment ${credits > 0 ? "+" : ""}${credits}: ${note}`, tenantId);
    }),

    declineTopUpRequest: async (requestId, actor) => tx(async (run) => {
      const r = await run<Row>(`update top_up_requests set status = 'done' where id = $1 and status = 'open' returning tenant_id, credits`, [requestId]);
      if (r[0]) await audit(run, actor, `Declined a top-up request of ${r[0].credits} credits`, r[0].tenant_id);
    }),

    deletePackage: async (packageId, actor) => tx(async (run) => {
      const used = await run(`select 1 from tenants where exists (select 1 from jsonb_array_elements(case when jsonb_typeof(plan) = 'array' then plan else '[]'::jsonb end) e where e->>'packageId' = $1)`, [packageId]);
      if (used.length) return false;
      const r = await run<Row>(`delete from packages where id::text = $1 returning name`, [packageId]);
      if (r[0]) await audit(run, actor, `Deleted package "${r[0].name}"`);
      return true;
    }),

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
      if (patch.allowedDomains || patch.name) await lockTenantDirectory(run);
      const t = await lockTenant(run, tenantId);
      if (patch.allowedDomains || patch.name) {
        const others = (await run<Row>(`select * from tenants where id <> $1`, [tenantId])).map(tenantOf);
        const clash = findDuplicate(others, { name: patch.name, domains: patch.allowedDomains ?? [] });
        if (clash) throw new DuplicateError(clash);
      }
      await run(
        `update tenants set zero_balance_policy = $2, allowed_domains = $3, low_balance_threshold = $4, status = $5, branding = $6, name = $7, retention_days = $8, closures = $9 where id = $1`,
        [tenantId, patch.zeroBalancePolicy ?? t.zeroBalancePolicy, patch.allowedDomains ?? t.allowedDomains, patch.lowBalanceThreshold ?? t.lowBalanceThreshold,
         patch.status ?? t.status, JSON.stringify({ ...t.branding, ...(patch.branding ?? {}) }), patch.name ?? t.name, patch.retentionDays ?? t.retentionDays,
         JSON.stringify(patch.closures ?? t.closures ?? [])]);
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
