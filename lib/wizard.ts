/**
 * The setup wizard (milestone 5 of docs/reorganization.md): the ten checklist items grouped into five phases, with the rules
 * of the client's business type deciding what is required. Pure module, so it is tested on its own and used by the admin's
 * Setup tab and by the Go live action (which checks again on the server).
 */
import type { ChecklistId, ChecklistItem } from "./checklist";
import type { TypeRules } from "./business-types";

export const PHASES = ["business", "plan", "people", "assistant", "channels"] as const;
export type PhaseId = (typeof PHASES)[number];
export const isPhase = (v: unknown): v is PhaseId => typeof v === "string" && (PHASES as readonly string[]).includes(v);

/** One line of a phase. "content" is the knowledge-or-catalogue rule; the others are checklist items. */
export type WizardItemId = ChecklistId | "content";

export interface WizardItem {
  id: WizardItemId;
  done: boolean;
  /** Needed before the client can go live. The others are recommended. */
  required: boolean;
  /** Not needed for this business type (for example staff calendars for a shop). Shown, but never blocks. */
  notNeeded?: boolean;
  /** An admin ticks it by hand (CallsDash cannot see it). */
  manual?: boolean;
}

export interface Phase {
  id: PhaseId;
  items: WizardItem[];
  /** Every required item is done. */
  done: boolean;
}

export interface WizardFacts {
  knowledgeCount: number;
  catalogCount: number;
}

/** Where each item sits. Branding and hours are recommended; the rest are required unless the business type says otherwise. */
export function wizardPhases(items: ChecklistItem[], rules: TypeRules, facts: WizardFacts): Phase[] {
  const by = new Map(items.map((i) => [i.id, i]));
  const it = (id: ChecklistId, required = true, notNeeded = false): WizardItem => {
    const c = by.get(id);
    return { id, done: c?.done ?? false, required: required && !notNeeded, ...(notNeeded ? { notNeeded } : {}), ...(c?.manual ? { manual: true } : {}) };
  };
  // shops, salons and restaurants need something in the catalogue; the others need knowledge or catalogue
  const content: WizardItem = {
    id: "content",
    done: rules.needsCatalog ? facts.catalogCount > 0 : facts.knowledgeCount > 0 || facts.catalogCount > 0,
    required: true,
  };
  const phases: Omit<Phase, "done">[] = [
    { id: "business", items: [it("details"), it("branding", false)] },
    { id: "plan", items: [it("plan")] },
    { id: "people", items: [it("team"), it("calendar", true, !rules.needsStaff), it("hours", false)] },
    { id: "assistant", items: [content, it("agent")] },
    { id: "channels", items: [it("channel"), it("test")] },
  ];
  return phases.map((p) => ({ ...p, done: p.items.every((i) => !i.required || i.done) }));
}

/** The required items still open, in phase order: empty means the client can go live. */
export function missingForLive(phases: Phase[]): { phase: PhaseId; item: WizardItemId }[] {
  return phases.flatMap((p) => p.items.filter((i) => i.required && !i.done).map((i) => ({ phase: p.id, item: i.id })));
}
