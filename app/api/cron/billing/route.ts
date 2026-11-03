import { NextResponse } from "next/server";
import { runBillingReminders } from "@/lib/billing-server";

export const dynamic = "force-dynamic";

/**
 * The daily billing reminder run. Vercel's timer (vercel.json) calls it with `Authorization: Bearer <CRON_SECRET>`; with no
 * CRON_SECRET set it refuses, so the reminders then still run from the admin's own page loads.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const run = await runBillingReminders();
  return NextResponse.json({ ok: true, ...run });
}
