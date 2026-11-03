import "server-only";
import { getData, getSetting, getTopUpRequests, getWallet, listTenants } from "./data";
import { BILLING_KEY, LAST_RUN_KEY, billingClientKey, dueReminders, expiring, monthlyBhd, readBillingSettings, readClientBilling, renewals, type Reminder } from "./billing-status";
import { runReminders, runRemindersThrottled } from "./billing-reminders";
import { sendEmail } from "./mailer";
import { parseEmails } from "./billing-status";
import type { Tenant } from "./types";

export const loadBillingSettings = async () => readBillingSettings(await getSetting(BILLING_KEY).catch(() => undefined));
export const loadClientBilling = async (tenantId: string) => readClientBilling(await getSetting(billingClientKey(tenantId)).catch(() => undefined));

/** Runs the reminders now (cron route, the admin's button). */
export async function runBillingReminders() {
  return runReminders(await getData());
}

/** The same, at most every few hours, for page loads. */
export async function runBillingRemindersSoon() {
  return runRemindersThrottled(await getData());
}

/** Emails the admin addresses about something that needs them (a client asked for a top-up). Never throws. */
export async function notifyAdmin(subject: string, text: string) {
  try {
    const s = await loadBillingSettings();
    if (!s.email) return;
    await sendEmail({ to: parseEmails(s.emailTo).valid, subject, text });
  } catch { /* the request itself is already saved */ }
}

export interface ClientBillingRow {
  tenant: Tenant;
  balance: number;
  low: boolean;
  daysBefore: number;
  muted: boolean;
  emailTo: string;
  ownDays?: number;
  renewals: ReturnType<typeof renewals>;
  expiring: ReturnType<typeof expiring>;
  due: Reminder[];
  monthlyBhd: number;
  lastRun?: string;
  requests: number;
}

/** Everything the admin Billing > Clients tab shows. */
export async function loadBillingOverview(now = new Date()) {
  const [settings, tenants, requests, lastRun] = await Promise.all([loadBillingSettings(), listTenants(), getTopUpRequests(), getSetting(LAST_RUN_KEY).catch(() => undefined)]);
  const rows: ClientBillingRow[] = await Promise.all(tenants.map(async (tenant) => {
    const [w, own] = await Promise.all([getWallet(tenant.id), loadClientBilling(tenant.id)]);
    const days = own.daysBefore ?? settings.daysBefore;
    return {
      tenant, balance: w.balance, low: w.low, daysBefore: days, muted: Boolean(own.muted), emailTo: own.emailTo ?? "", ...(own.daysBefore ? { ownDays: own.daysBefore } : {}),
      renewals: renewals(tenant.plans, now), expiring: expiring(w.batches, now, days), due: own.muted ? [] : dueReminders(tenant.plans, w.batches, now, days),
      monthlyBhd: monthlyBhd(tenant.plans), requests: requests.filter((r) => r.tenantId === tenant.id).length,
    };
  }));
  return { settings, rows, lastRun: typeof (lastRun as { at?: unknown } | undefined)?.at === "string" ? (lastRun as { at: string }).at : undefined };
}
