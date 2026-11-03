import { getSession } from "@/lib/auth";
import { loadBillingOverview } from "@/lib/billing-server";
import { toCsv } from "@/lib/stats";

export const dynamic = "force-dynamic";

/** Billing > Clients > Download CSV: every client's packages, contract, balance and renewal date, for the admin's own records. */
export async function GET() {
  const s = await getSession();
  if (!s || s.role !== "admin" || s.mustChangePassword) return new Response("Not found", { status: 404 });
  const { rows } = await loadBillingOverview();
  const day = (iso?: string) => (iso ? iso.slice(0, 10) : "");
  const out: (string | number)[][] = [["Client", "Status", "Balance (credits)", "Monthly fee (BHD)", "Packages", "Contracts", "Next renewal", "Days to renewal", "Reminder days before", "Reminders", "Top-up requests"]];
  for (const r of rows) {
    const act = r.tenant.plans.filter((p) => p.active);
    const next = r.renewals[0];
    out.push([r.tenant.name, r.tenant.status, r.balance, r.monthlyBhd, act.map((p) => p.name).join(" + "), act.map((p) => p.contractRef ?? "").filter(Boolean).join(" + "), day(next?.renewsAt), next ? next.daysLeft : "", r.daysBefore, r.muted ? "off" : "on", r.requests]);
  }
  return new Response(toCsv(out), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="callsdash-billing-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" } });
}
