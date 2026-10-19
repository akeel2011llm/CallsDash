import { describe, expect, it } from "vitest";
import { makeDb } from "./helpers/pgdb";

describe("migration 0001", () => {
  it("applies cleanly and enforces tenant isolation through RLS", async () => {
    const db = await makeDb();
    const t = async (slug: string) => (await db.query<{ id: string }>(`insert into tenants (slug, name) values ($1, $1) returning id`, [slug])).rows[0].id;
    const a = await t("a"), b = await t("b");
    const u = (await db.query<{ id: string }>(`insert into auth.users (email) values ('x@y.z') returning id`)).rows[0].id;
    await db.query(`insert into profiles (id, tenant_id, role) values ($1, $2, 'manager')`, [u, a]);
    await db.query(`insert into bookings (tenant_id, patient_name, patient_phone, starts_at) values ($1,'p','1',now()), ($2,'q','2',now())`, [a, b]);
    // run as a non-superuser role so RLS applies
    await db.exec(`create role app_user; grant usage on schema auth, public to app_user; grant select, insert, update, delete on all tables in schema public to app_user; grant execute on all functions in schema auth, public to app_user;`);
    await db.exec(`set role app_user; select set_config('request.jwt.sub', '${u}', false);`);
    const seen = await db.query<{ tenant_id: string }>(`select tenant_id from bookings`);
    expect(seen.rows.map((r) => r.tenant_id)).toEqual([a]);
    await expect(db.query(`insert into bookings (tenant_id, patient_name, patient_phone, starts_at) values ($1,'z','3',now())`, [b])).rejects.toThrow();
    await expect(db.query(`insert into credit_batches (tenant_id, kind, amount, remaining, expires_at) values ($1,'topup',5,5,now())`, [a])).rejects.toThrow(); // wallet is server-written only
    expect((await db.query(`select * from credit_batches`)).rows).toHaveLength(0);
  });

  it("purges transcripts and recordings after the retention window", async () => {
    const db = await makeDb();
    const t = (await db.query<{ id: string }>(`insert into tenants (slug, name, retention_days) values ('a','a',90) returning id`)).rows[0].id;
    await db.query(
      `insert into conversations (tenant_id, channel, mode, language, started_at, outcome, transcript, recording_path)
       values ($1,'website','voice','en', now() - interval '100 days','answered','[{"text":"hi"}]','r/1.mp3'),
              ($1,'website','voice','en', now() - interval '10 days','answered','[{"text":"hi"}]','r/2.mp3')`, [t]);
    expect((await db.query<{ n: number }>(`select purge_expired_conversations() as n`)).rows[0].n).toBe(1);
    const rows = (await db.query<{ recording_path: string | null }>(`select recording_path from conversations order by started_at`)).rows;
    expect(rows.map((r) => r.recording_path)).toEqual([null, "r/2.mp3"]);
  });

  it("finds Arabic and English text in transcripts", async () => {
    const db = await makeDb();
    const t = (await db.query<{ id: string }>(`insert into tenants (slug, name) values ('a','a') returning id`)).rows[0].id;
    await db.query(`insert into conversations (tenant_id, channel, mode, language, started_at, outcome, summary) values ($1,'website','text','ar',now(),'answered','سأل عن دوام الجمعة')`, [t]);
    const r = await db.query(`select 1 from conversations where search @@ plainto_tsquery('simple', 'الجمعة')`);
    expect(r.rows).toHaveLength(1);
  });
});
