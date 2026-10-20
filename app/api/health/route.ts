import { NextResponse } from "next/server";
import { usingDatabase } from "@/lib/data";
import { normalizeDatabaseUrl } from "@/lib/data/database-url";
import { createNodePgDb } from "@/lib/data/node-pg";
import { demoMode } from "@/lib/demo-flag";
import { supabasePublicKey, supabaseUrl } from "@/lib/supabase-env";

export const dynamic = "force-dynamic";

/**
 * Setup check: open /api/health to see which settings are present and whether the database answers.
 * Reports only yes/no and a short error code, never values.
 */
export async function GET() {
  const out: Record<string, unknown> = {
    demoMode: demoMode(),
    supabaseUrl: Boolean(supabaseUrl()),
    supabasePublicKey: Boolean(supabasePublicKey()),
    databaseUrl: usingDatabase(),
  };
  if (usingDatabase()) {
    out.connectionString = describeUrl(process.env.DATABASE_URL!);
    out.autoCleaned = normalizeDatabaseUrl(process.env.DATABASE_URL!) !== process.env.DATABASE_URL;
    try {
      const q = createNodePgDb(process.env.DATABASE_URL!).q;
      await q("select 1");
      out.database = "connected";
      const t = await q<{ n: string }>(`select count(*)::text as n from information_schema.tables where table_schema = 'public' and table_name in ('tenants','profiles','credit_batches','bookings')`);
      out.tablesFound = Number(t[0].n); // 4 means the migration has been run
      if (out.tablesFound === 4) out.adminProfiles = Number((await q<{ n: string }>(`select count(*)::text as n from profiles where role = 'admin'`))[0].n);
    } catch (e) {
      const err = e as { code?: string };
      out.database = `error ${err.code ?? "unknown"}`;
    }
  }
  return NextResponse.json(out);
}

/** Shape of the connection string, to spot common typos. Never returns the host, user or password themselves. */
function describeUrl(raw: string) {
  const info: Record<string, unknown> = { atSigns: (raw.match(/@/g) ?? []).length };
  try {
    const u = new URL(raw);
    const pw = decodeURIComponent(u.password);
    Object.assign(info, {
      parsed: true,
      protocol: u.protocol,
      hostKind: u.hostname.endsWith(".pooler.supabase.com") ? "pooler" : /^db\..+\.supabase\.co$/.test(u.hostname) ? "direct" : "other",
      port: u.port || "default",
      userHasProjectRef: decodeURIComponent(u.username).startsWith("postgres."),
      passwordSet: pw.length > 0,
      passwordHasBrackets: /^\[|\]$/.test(pw),
      passwordIsPlaceholder: /YOUR-PASSWORD/i.test(pw),
    });
  } catch {
    info.parsed = false; // usually an unencoded symbol in the password
  }
  return info;
}
