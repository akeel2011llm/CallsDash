"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin, requireSection } from "./auth";
import { safePath } from "./format";
import * as store from "./data";
import { BILLING_KEY, DEFAULT_AMOUNTS, MAX_DAYS_BEFORE, billingClientKey, parseEmails } from "./billing-status";
import { loadBillingSettings, runBillingReminders } from "./billing-server";
import { mailConfigured, sendEmail } from "./mailer";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const TO = "/admin/billing/clients";

function go(f: FormData, result: string, hash = ""): never {
  const p = safePath(f.get("returnTo"), TO);
  redirect(`${p}${p.includes("?") ? "&" : "?"}${result}${hash}`);
}

/** Billing > Clients > Reminder and payment settings (the same for every client). */
export async function saveBillingSettingsAction(f: FormData) {
  const { actor } = await requireAdmin();
  const days = Math.round(Number(str(f, "daysBefore")));
  if (!(days >= 1 && days <= MAX_DAYS_BEFORE)) go(f, "error=days", "#settings");
  const emails = parseEmails(str(f, "emailTo"));
  if (emails.invalid.length) go(f, "error=emails", "#settings");
  const amounts = [...new Set(str(f, "amounts").split(/[\s,;]+/).map(Number).filter((n) => Number.isFinite(n) && n >= 1 && n <= 100_000).map(Math.round))].sort((a, b) => a - b).slice(0, 6);
  await store.setSetting(BILLING_KEY, {
    daysBefore: days, onScreen: f.get("onScreen") === "on", email: f.get("email") === "on", emailTo: emails.valid.join(", "),
    paymentHelp: str(f, "paymentHelp").slice(0, 600), paymentHelpAr: str(f, "paymentHelpAr").slice(0, 600), amounts: amounts.length ? amounts : DEFAULT_AMOUNTS,
  });
  await store.audit(actor, `Changed the billing reminder and payment settings (remind ${days} days before)`);
  revalidatePath("/admin", "layout");
  revalidatePath("/app", "layout");
  go(f, "saved=settings", "#settings");
}

/** One client's own reminder choices (blank days follows the platform setting). */
export async function saveClientBillingAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  const tenant = await store.getTenant(id);
  if (!tenant) redirect(TO);
  const raw = str(f, "daysBefore");
  const days = raw ? Math.round(Number(raw)) : undefined;
  if (days !== undefined && !(days >= 1 && days <= MAX_DAYS_BEFORE)) go(f, "error=days", `#c-${id}`);
  const emails = parseEmails(str(f, "emailTo"));
  if (emails.invalid.length) go(f, "error=emails", `#c-${id}`);
  await store.setSetting(billingClientKey(id), { ...(days ? { daysBefore: days } : {}), ...(emails.valid.length ? { emailTo: emails.valid.join(", ") } : {}), ...(f.get("muted") === "on" ? { muted: true } : {}) });
  await store.audit(actor, `Changed the billing reminders of ${tenant.name}`, id);
  revalidatePath("/admin", "layout");
  go(f, "saved=client", `#c-${id}`);
}

const METHODS = ["bank", "benefit", "cash", "card", "other"] as const;

/** A manual top-up recorded by the admin after the client paid: credits go in at once and the note says how it was paid. */
export async function billingTopUpAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  const credits = Math.round(Number(str(f, "credits")) * 100) / 100;
  if (!await store.getTenant(id)) redirect(TO);
  if (!(credits > 0) || credits > 1_000_000) go(f, "error=credits", `#c-${id}`);
  const method = METHODS.find((m) => m === str(f, "method")) ?? "other";
  const ref = str(f, "reference").slice(0, 80);
  const label = { bank: "Bank transfer", benefit: "Benefit Pay", cash: "Cash", card: "Card", other: "Other" }[method];
  await store.topUp(id, credits, actor, `Top-up (${label}${ref ? `, ${ref}` : ""})`);
  revalidatePath("/admin", "layout");
  revalidatePath("/app", "layout");
  go(f, "topped=1", `#c-${id}`);
}

export async function runRemindersNowAction(f: FormData) {
  const { actor } = await requireAdmin();
  const run = await runBillingReminders();
  await store.audit(actor, `Ran the billing reminders (${run.alerts} alerts, ${run.emails} emails)`);
  revalidatePath("/admin", "layout");
  go(f, `ran=${run.alerts}-${run.emails}${run.emailProblem ? `&mailProblem=${encodeURIComponent(run.emailProblem.slice(0, 120))}` : ""}`, "#settings");
}

export async function testEmailAction(f: FormData) {
  await requireAdmin();
  const s = await loadBillingSettings();
  const to = parseEmails(s.emailTo).valid;
  if (!mailConfigured()) go(f, "mail=not_configured", "#settings");
  if (!to.length) go(f, "mail=no_recipient", "#settings");
  const r = await sendEmail({ to, subject: "CallsDash test email", text: "This is a test from CallsDash Billing. Reminders will arrive at this address.\n\nهذه رسالة تجريبية من فوترة CallsDash." });
  go(f, r.ok ? "mail=sent" : `mail=failed&mailProblem=${encodeURIComponent((r.ok ? "" : r.detail ?? r.reason).slice(0, 120))}`, "#settings");
}

/** The client withdraws a top-up request that is still waiting. */
export async function cancelTopUpRequestAction(f: FormData) {
  const { tenant, actor } = await requireSection("billing");
  const requestId = str(f, "requestId");
  const mine = (await store.getTopUpRequests()).find((r) => r.id === requestId && r.tenantId === tenant.id);
  if (mine) await store.declineTopUpRequest(requestId, actor);
  revalidatePath("/admin", "layout");
  redirect(`${safePath(f.get("returnTo"), "/app/credits")}?cancelled=1`);
}
