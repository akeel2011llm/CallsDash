import type { Channel, CreditBatch, Plan } from "./types";

// 1 credit = 1 voice minute = 20 text messages (see implementation plan, "Credits and billing").
export const TEXT_MESSAGES_PER_CREDIT = 20;
export const TOP_UP_VALIDITY_MONTHS = 12;

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function addMonths(iso: string, months: number): string {
  const d = new Date(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString();
}

/** Credits a finished conversation costs. Voice is billed per second, text per message, both rounded to 0.01. */
export function creditsFor(c: { mode: "voice" | "text"; durationSec: number; messages: number }): number {
  return c.mode === "voice" ? round2(c.durationSec / 60) : round2(c.messages / TEXT_MESSAGES_PER_CREDIT);
}

export const isActive = (b: CreditBatch, now: Date) => b.remaining > 0 && new Date(b.expiresAt) > now;

export function balance(batches: CreditBatch[], now: Date): number {
  return round2(batches.filter((b) => isActive(b, now)).reduce((s, b) => s + b.remaining, 0));
}

const rank = (b: CreditBatch) => (b.kind === "rollover" ? 0 : b.kind === "package" ? 1 : 2);

/** Spend order: rollover first, then this month's package credits, then top-ups oldest first. */
export function spendOrder(batches: CreditBatch[], now: Date): CreditBatch[] {
  return batches
    .filter((b) => isActive(b, now))
    .sort((a, b) => rank(a) - rank(b) || a.purchasedAt.localeCompare(b.purchasedAt));
}

export interface Allocation {
  batchId: string;
  amount: number;
}

export function deduct(
  batches: CreditBatch[],
  amount: number,
  now: Date,
): { batches: CreditBatch[]; allocations: Allocation[]; shortfall: number } {
  let left = round2(amount);
  const allocations: Allocation[] = [];
  const next = batches.map((b) => ({ ...b }));
  const byId = new Map(next.map((b) => [b.id, b]));
  for (const b of spendOrder(next, now)) {
    if (left <= 0) break;
    const take = round2(Math.min(b.remaining, left));
    byId.get(b.id)!.remaining = round2(b.remaining - take);
    allocations.push({ batchId: b.id, amount: take });
    left = round2(left - take);
  }
  return { batches: next, allocations, shortfall: Math.max(0, left) };
}

export function addTopUp(
  batches: CreditBatch[],
  p: { id: string; tenantId: string; amount: number; now: Date; kind?: "topup" | "payg"; note?: string },
): CreditBatch[] {
  const at = p.now.toISOString();
  return [
    ...batches,
    {
      id: p.id,
      tenantId: p.tenantId,
      kind: p.kind ?? "topup",
      amount: p.amount,
      remaining: p.amount,
      purchasedAt: at,
      expiresAt: addMonths(at, TOP_UP_VALIDITY_MONTHS),
      note: p.note,
    },
  ];
}

/** Zero out batches that have passed their expiry. Returns the credits that lapsed. */
export function sweepExpired(batches: CreditBatch[], now: Date): { batches: CreditBatch[]; expired: number } {
  let expired = 0;
  const next = batches.map((b) => {
    if (b.remaining > 0 && new Date(b.expiresAt) <= now) {
      expired = round2(expired + b.remaining);
      return { ...b, remaining: 0 };
    }
    return b;
  });
  return { batches: next, expired };
}

/**
 * Start a new package period. Unused included credits of the period that just ended roll over,
 * capped at plan.rolloverCap (50%) of the included credits, for one month only (the rollover batch
 * expires with the new period and is never rolled again). Everything else from the old period lapses.
 */
export function renewPackage(
  batches: CreditBatch[],
  p: { tenantId: string; plan: Plan; periodStart: string; ids: { rollover: string; package: string } },
): { batches: CreditBatch[]; carried: number; lapsed: number } {
  const periodEnd = addMonths(p.periodStart, 1);
  const cap = round2(p.plan.includedCredits * p.plan.rolloverCap);
  const prevPackage = batches
    .filter((b) => b.kind === "package" && b.tenantId === p.tenantId)
    .sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt))[0];
  const carried = prevPackage ? round2(Math.min(prevPackage.remaining, cap)) : 0;

  let lapsed = 0;
  const next = batches.map((b) => {
    if ((b.kind === "package" || b.kind === "rollover") && b.remaining > 0) {
      // the carried part of the previous package batch moves to the new rollover batch; the rest lapses
      lapsed = round2(lapsed + b.remaining - (b.id === prevPackage?.id ? carried : 0));
      return { ...b, remaining: 0 };
    }
    return b;
  });

  if (carried > 0) {
    next.push({
      id: p.ids.rollover,
      tenantId: p.tenantId,
      kind: "rollover",
      amount: carried,
      remaining: carried,
      purchasedAt: p.periodStart,
      expiresAt: periodEnd,
      note: "Rollover from previous month",
    });
  }
  next.push({
    id: p.ids.package,
    tenantId: p.tenantId,
    kind: "package",
    amount: p.plan.includedCredits,
    remaining: p.plan.includedCredits,
    purchasedAt: p.periodStart,
    expiresAt: periodEnd,
    note: p.plan.name,
  });
  return { batches: next, carried, lapsed };
}

export function lowBalance(batches: CreditBatch[], plan: Plan, threshold: number, now: Date) {
  const bal = balance(batches, now);
  const topups = batches.filter((b) => (b.kind === "topup" || b.kind === "payg") && isActive(b, now));
  const reference = plan.type === "package" ? plan.includedCredits : Math.max(0, ...topups.map((b) => b.amount));
  return { low: reference > 0 ? bal <= reference * threshold : bal <= 0, balance: bal, reference };
}

export const CHANNEL_LABEL: Record<Channel, string> = {
  website: "Website",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  phone: "Phone",
};
