/**
 * Loads the demo data set into Postgres (DATABASE_URL), for staging demos and local testing:
 *   DATABASE_URL=postgres://... npx tsx scripts/seed-db.ts
 * Run the migration first. Tenants get fresh UUIDs; running it twice adds a second copy.
 */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { seed } from "../lib/seed";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false } });
  const d = seed();
  const ids = new Map<string, string>();
  const id = (old: string) => ids.get(old) ?? (ids.set(old, randomUUID()), ids.get(old)!);
  const c = await pool.connect();
  try {
    await c.query("begin");
    for (const t of d.tenants) {
      await c.query(
        `insert into tenants (id, slug, name, status, branding, plan, permissions, allowed_domains, zero_balance_policy, low_balance_threshold, retention_days, calendar_connected, channels, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [id(t.id), t.slug, t.name, t.status, t.branding, t.plan, t.permissions, t.allowedDomains, t.zeroBalancePolicy, t.lowBalanceThreshold, t.retentionDays, t.calendarConnected, t.channels, t.createdAt]);
      const a = d.agents[t.id];
      await c.query(`insert into agents (tenant_id, elevenlabs_agent_id, settings) values ($1,$2,$3)`, [id(t.id), a.elevenLabsAgentId, a]);
    }
    for (const v of d.agentVersions) await c.query(`insert into agent_versions (tenant_id, created_at, author, summary, settings) values ($1,$2,$3,$4,$5)`, [id(v.tenantId), v.createdAt, v.author, v.summary, v.settings]);
    for (const x of d.doctors) await c.query(`insert into doctors (id, tenant_id, name, specialty, color) values ($1,$2,$3,$4,$5)`, [id(x.id), id(x.tenantId), x.name, x.specialty, x.color]);
    for (const b of d.bookings) await c.query(`insert into bookings (tenant_id, doctor_id, patient_name, patient_phone, service, starts_at, duration_min, status) values ($1,$2,$3,$4,$5,$6,$7,$8)`, [id(b.tenantId), id(b.doctorId), b.patientName, b.patientPhone, b.service, b.startsAt, b.durationMin, b.status]);
    for (const v of d.conversations) {
      await c.query(
        `insert into conversations (id, tenant_id, channel, mode, language, started_at, duration_sec, messages, outcome, sentiment, summary, transcript, credits_charged, cost_usd)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [id(v.id), id(v.tenantId), v.channel, v.mode, v.language, v.startedAt, v.durationSec, v.messages, v.outcome, v.sentiment, v.summary, JSON.stringify(v.transcript), v.creditsCharged, v.costUsd]);
    }
    for (const k of d.knowledge) await c.query(`insert into knowledge_items (tenant_id, question, answer, language) values ($1,$2,$3,$4)`, [id(k.tenantId), k.question, k.answer, k.language]);
    for (const b of d.batches) await c.query(`insert into credit_batches (tenant_id, kind, amount, remaining, purchased_at, expires_at, note) values ($1,$2,$3,$4,$5,$6,$7)`, [id(b.tenantId), b.kind, b.amount, b.remaining, b.purchasedAt, b.expiresAt, b.note]);
    for (const l of d.ledger) await c.query(`insert into credit_ledger (tenant_id, at, kind, credits, channel, conversation_id, note) values ($1,$2,$3,$4,$5,$6,$7)`, [id(l.tenantId), l.at, l.kind, l.credits, l.channel ?? null, l.conversationId ? id(l.conversationId) : null, l.note ?? null]);
    for (const a of d.alerts) await c.query(`insert into alerts (tenant_id, at, severity, message, resolved) values ($1,$2,$3,$4,$5)`, [id(a.tenantId), a.at, a.severity, a.message, a.resolved]);
    await c.query("commit");
    console.log(`Seeded ${d.tenants.length} clients.`);
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
