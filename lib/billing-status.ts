/**
 * What each client owes attention on in Billing (2026-11-03): when each package renews, which credits are about to expire,
 * and the reminder settings (how many days before, email, on-screen alert). Pure functions, so the admin Billing screen, the
 * client portal, the daily reminder run and the tests agree.
 */
import { activePackages, addMonths, isActive } from "./credits";
import type { CreditBatch, Plan } from "./types";

const DAY = 86_400_000;

export const BILLING_KEY = "billing.settings";
export const billingClientKey = (tenantId: string) => `billing.client.${tenantId}`;
export const SENT_KEY = (tenantId: string) => `billing.sent.${tenantId}`;
export const LAST_RUN_KEY = "billing.lastRun";

export const DEFAULT_DAYS_BEFORE = 7;
export const MAX_DAYS_BEFORE = 60;

/** The platform-wide reminder and payment settings. */
export interface BillingSettings {
  /** Remind this many days before a package renews or credits expire. */
  daysBefore: number;
  /** Show the reminder as an alert on screen (admin bell and a banner for the admin and the client). */
  onScreen: boolean;
  /** Send the reminder by email (needs RESEND_API_KEY on the server). */
  email: boolean;
  /** The admin's own addresses, separated by commas. */
  emailTo: string;
  /** How a client pays for a top-up (shown on the client's top-up form), in English and Arabic. */
  paymentHelp: string;
  paymentHelpAr: string;
  /** Top-up amounts offered as buttons on the client's Credits page. */
  amounts: number[];
}

/** One client's own reminder choices. Empty fields follow the platform settings. */
export interface ClientBillingSettings {
  daysBefore?: number;
  /** The client's own address(es) for the reminder, separated by commas. */
  emailTo?: string;
  /** Reminders for this client are off (a client that is paused or ending). */
  muted?: boolean;
}

export const DEFAULT_AMOUNTS = [500, 1000, 2500, 5000];

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const clampDays = (n: unknown): number | undefined => {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) && v >= 1 ? Math.min(MAX_DAYS_BEFORE, Math.round(v)) : undefined;
};

export function readBillingSettings(raw: unknown): BillingSettings {
  const o = obj(raw);
  const amounts = (Array.isArray(o.amounts) ? o.amounts : []).map(Number).filter((n) => Number.isFinite(n) && n >= 1 && n <= 100_000).map(Math.round);
  return {
    daysBefore: clampDays(o.daysBefore) ?? DEFAULT_DAYS_BEFORE,
    onScreen: o.onScreen !== false,
    email: o.email !== false,
    emailTo: typeof o.emailTo === "string" ? o.emailTo : "",
    paymentHelp: typeof o.paymentHelp === "string" ? o.paymentHelp : "",
    paymentHelpAr: typeof o.paymentHelpAr === "string" ? o.paymentHelpAr : "",
    amounts: amounts.length ? [...new Set(amounts)].sort((a, b) => a - b).slice(0, 6) : DEFAULT_AMOUNTS,
  };
}

export function readClientBilling(raw: unknown): ClientBillingSettings {
  const o = obj(raw);
  const days = clampDays(o.daysBefore);
  return { ...(days ? { daysBefore: days } : {}), ...(typeof o.emailTo === "string" && o.emailTo.trim() ? { emailTo: o.emailTo.trim() } : {}), ...(o.muted === true ? { muted: true } : {}) };
}

/** A comma, semicolon or space separated list of addresses: the valid ones, once each, at most 5. */
export function parseEmails(text: string): { valid: string[]; invalid: string[] } {
  const parts = text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  const valid: string[] = [], invalid: string[] = [];
  for (const p of parts) {
    if (/^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]{2,}$/.test(p) && p.length <= 120) { if (!valid.includes(p.toLowerCase())) valid.push(p.toLowerCase()); }
    else invalid.push(p);
  }
  return { valid: valid.slice(0, 5), invalid };
}

/* ---------------------------------------------------------------- renewals and expiries */

export interface Renewal {
  planId: string;
  name: string;
  contractRef?: string;
  type: "package";
  includedCredits: number;
  monthlyPriceBhd: number;
  /** ISO date the next period starts (a month after the current one began). */
  renewsAt: string;
  /** Whole days from now; negative when the renewal date has passed and nobody renewed yet. */
  daysLeft: number;
}

/** Days from `now` to `iso`, rounded up; a date that has passed is negative. */
export const daysUntil = (iso: string, now: Date) => Math.ceil((Date.parse(iso) - now.getTime()) / DAY);

export function renewals(plans: Plan[], now: Date): Renewal[] {
  return activePackages(plans).map((p) => {
    const renewsAt = addMonths(p.periodStart, 1);
    return { planId: p.id, name: p.name, ...(p.contractRef ? { contractRef: p.contractRef } : {}), type: "package" as const, includedCredits: p.includedCredits, monthlyPriceBhd: p.monthlyPriceBhd, renewsAt, daysLeft: daysUntil(renewsAt, now) };
  }).sort((a, b) => a.daysLeft - b.daysLeft);
}

export interface Expiring {
  batchId: string;
  kind: CreditBatch["kind"];
  remaining: number;
  expiresAt: string;
  daysLeft: number;
}

/** Credits that expire within `withinDays` days, soonest first. */
export function expiring(batches: CreditBatch[], now: Date, withinDays: number): Expiring[] {
  return batches.filter((b) => isActive(b, now) && daysUntil(b.expiresAt, now) <= withinDays)
    .map((b) => ({ batchId: b.id, kind: b.kind, remaining: Math.round(b.remaining * 100) / 100, expiresAt: b.expiresAt, daysLeft: daysUntil(b.expiresAt, now) }))
    .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
}

export type ReminderKind = "renewal" | "overdue" | "expiry";
export interface Reminder {
  /** Stable per renewal date or expiry date, so each reminder is sent once. */
  key: string;
  kind: ReminderKind;
  planId?: string;
  name?: string;
  date: string;
  daysLeft: number;
  credits?: number;
}

/**
 * The reminders that are due now: a package renewing within `daysBefore` days (or whose renewal date has passed), and
 * credits expiring within that many days. Package credits that expire at renewal are not listed twice: their renewal says it.
 */
export function dueReminders(plans: Plan[], batches: CreditBatch[], now: Date, daysBefore: number): Reminder[] {
  const out: Reminder[] = [];
  const ren = renewals(plans, now);
  for (const r of ren) {
    if (r.daysLeft <= daysBefore) out.push({ key: `${r.daysLeft < 0 ? "overdue" : "renewal"}:${r.planId}:${r.renewsAt.slice(0, 10)}`, kind: r.daysLeft < 0 ? "overdue" : "renewal", planId: r.planId, name: r.name, date: r.renewsAt, daysLeft: r.daysLeft });
  }
  const periodEnds = new Set(ren.map((r) => r.renewsAt.slice(0, 10)));
  const topups = batches.filter((b) => (b.kind === "topup" || b.kind === "payg" || b.kind === "rollover") && !periodEnds.has(b.expiresAt.slice(0, 10)));
  const byDay = new Map<string, { credits: number; at: string; daysLeft: number }>();
  for (const e of expiring(topups, now, daysBefore)) {
    const d = e.expiresAt.slice(0, 10);
    const cur = byDay.get(d);
    byDay.set(d, { credits: (cur?.credits ?? 0) + e.remaining, at: e.expiresAt, daysLeft: e.daysLeft });
  }
  for (const [d, v] of byDay) out.push({ key: `expiry:${d}`, kind: "expiry", date: v.at, daysLeft: v.daysLeft, credits: Math.round(v.credits * 100) / 100 });
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

/** Packages a client pays for each month in BHD (active packages only; pay as you go has only a dashboard fee). */
export const monthlyBhd = (plans: Plan[]) => Math.round(plans.filter((p) => p.active).reduce((s, p) => s + p.monthlyPriceBhd, 0) * 1000) / 1000;
