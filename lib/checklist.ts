import type { Tenant } from "./types";

export type ChecklistId = "details" | "branding" | "plan" | "knowledge" | "hours" | "calendar" | "team" | "agent" | "channel" | "test";

export interface ChecklistItem {
  id: ChecklistId;
  done: boolean;
  /** Cannot be worked out from the data, so an admin ticks it by hand. */
  manual: boolean;
  /** Part of the client's own "getting started" card (the rest is admin-only). */
  forClient: boolean;
}

export interface ChecklistFacts {
  knowledgeCount: number;
  doctorCount: number;
  userCount: number;
  conversationCount: number;
  agentId: string;
  balance: number;
}

/** What is left before a client is truly live. Items turn green by themselves when their data exists. */
export function setupChecklist(t: Tenant, f: ChecklistFacts): ChecklistItem[] {
  const ticked = new Set(t.onboarding.done);
  const b = t.branding;
  const item = (id: ChecklistId, done: boolean, o: { manual?: boolean; forClient?: boolean } = {}): ChecklistItem =>
    ({ id, done: done || (o.manual === true && ticked.has(id)), manual: o.manual === true, forClient: o.forClient === true });
  return [
    item("details", Boolean(b.domain && (b.supportPhone || b.supportEmail))),
    item("branding", Boolean(b.logoUrl)),
    item("plan", t.plans.some((p) => p.active) && f.balance > 0),
    item("knowledge", f.knowledgeCount > 0, { forClient: true }),
    item("hours", false, { manual: true, forClient: true }),
    item("calendar", t.calendarConnected && f.doctorCount > 0, { forClient: true }),
    item("team", f.userCount > 0),
    item("agent", f.agentId.trim() !== ""),
    item("channel", Object.values(t.channels).some((c) => c === "connected")),
    item("test", f.conversationCount > 0, { forClient: true }),
  ];
}

export const progress = (items: ChecklistItem[]) => ({ done: items.filter((i) => i.done).length, total: items.length });
