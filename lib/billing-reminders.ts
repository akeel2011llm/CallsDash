/**
 * The reminder run (2026-11-03): for every client, any package renewal or credit expiry that is within the reminder window
 * becomes an alert (admin bell and the on-screen banner) and an email, once per renewal date. Runs daily from the cron
 * route and, throttled, whenever the admin opens Billing, so a missed cron never means a missed reminder.
 */
import type { Data } from "./data/demo";
import { SENT_KEY, LAST_RUN_KEY, BILLING_KEY, billingClientKey, dueReminders, parseEmails, readBillingSettings, readClientBilling, type Reminder } from "./billing-status";
import { sendEmail, type MailResult } from "./mailer";
import type { Tenant } from "./types";

type D = Pick<Data, "listTenants" | "getWallet" | "getSetting" | "setSetting" | "addAlert" | "getAlerts" | "audit">;

/** The English line stored as the alert (lib/system-text.ts shows it in the reader's language). */
export function reminderMessage(r: Reminder): string {
  const day = r.date.slice(0, 10);
  if (r.kind === "overdue") return `Billing reminder: package ${r.name} was due to renew on ${day} and has not been renewed.`;
  if (r.kind === "renewal") return `Billing reminder: package ${r.name} renews on ${day} (in ${r.daysLeft} days).`;
  return `Billing reminder: ${r.credits} credits expire on ${day} (in ${r.daysLeft} days).`;
}

function emailBody(tenant: Tenant, r: Reminder): { subject: string; text: string } {
  const en = reminderMessage(r).replace("Billing reminder: ", "");
  const ar = r.kind === "overdue" ? `باقة ${r.name} كان موعد تجديدها ${r.date.slice(0, 10)} ولم يتم تجديدها.`
    : r.kind === "renewal" ? `تتجدد باقة ${r.name} في ${r.date.slice(0, 10)} (بعد ${r.daysLeft} يوم).`
      : `ينتهي ${r.credits} رصيد في ${r.date.slice(0, 10)} (بعد ${r.daysLeft} يوم).`;
  return { subject: `CallsDash billing: ${tenant.name}`, text: `${tenant.name}\n\n${en}\n\n${ar}\n\nCallsDash` };
}

export interface ReminderRun {
  checked: number;
  alerts: number;
  emails: number;
  /** Why emails were not sent, when they were wanted. */
  emailProblem?: string;
}

export async function runReminders(d: D, deps: { send?: (m: { to: string[]; subject: string; text: string }) => Promise<MailResult>; now?: Date } = {}): Promise<ReminderRun> {
  const now = deps.now ?? new Date();
  const send = deps.send ?? ((m) => sendEmail(m));
  const settings = readBillingSettings(await d.getSetting(BILLING_KEY));
  const adminTo = parseEmails(settings.emailTo).valid;
  const run: ReminderRun = { checked: 0, alerts: 0, emails: 0 };
  for (const tenant of await d.listTenants()) {
    run.checked++;
    const own = readClientBilling(await d.getSetting(billingClientKey(tenant.id)));
    if (own.muted) continue;
    const wallet = await d.getWallet(tenant.id);
    const due = dueReminders(tenant.plans, wallet.batches, now, own.daysBefore ?? settings.daysBefore);
    if (!due.length) continue;
    const sent = Array.isArray(await d.getSetting(SENT_KEY(tenant.id))) ? ((await d.getSetting(SENT_KEY(tenant.id))) as string[]) : [];
    const fresh = due.filter((r) => !sent.includes(r.key));
    for (const r of fresh) {
      if (settings.onScreen) { await d.addAlert(tenant.id, r.kind === "renewal" ? "info" : "warning", reminderMessage(r)); run.alerts++; }
      if (settings.email) {
        const to = [...new Set([...adminTo, ...parseEmails(own.emailTo ?? "").valid])];
        const res = await send({ to, ...emailBody(tenant, r) });
        if (res.ok) run.emails++; else if (res.reason !== "no_recipient") run.emailProblem = res.reason === "not_configured" ? "not_configured" : res.detail ?? "failed";
      }
    }
    // keep the keys of what is still due plus the last few sent, so a renewed package's next date is a new reminder
    await d.setSetting(SENT_KEY(tenant.id), [...new Set([...sent, ...fresh.map((r) => r.key)])].slice(-60));
  }
  await d.setSetting(LAST_RUN_KEY, { at: now.toISOString() }); // an object: Postgres settings must be JSON objects, not bare strings
  return run;
}

/** Runs the reminders at most once every `hours` hours (for page loads). Never throws. */
export async function runRemindersThrottled(d: D, hours = 6, now = new Date()): Promise<ReminderRun | null> {
  try {
    const last = (await d.getSetting(LAST_RUN_KEY) as { at?: unknown } | undefined)?.at;
    if (typeof last === "string" && now.getTime() - Date.parse(last) < hours * 3_600_000) return null;
    return await runReminders(d, { now });
  } catch {
    return null;
  }
}
