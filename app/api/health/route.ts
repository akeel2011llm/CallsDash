import { NextResponse } from "next/server";
import { usingDatabase } from "@/lib/data";
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
