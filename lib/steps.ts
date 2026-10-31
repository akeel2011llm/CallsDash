/**
 * Pure logic behind components/Stepper.tsx and the coming setup wizard: which step is done, which one a person should be
 * on, and how far along they are. Kept apart from the screen so it can be tested and reused (admin and client portals).
 */
export type StepStatus = "done" | "current" | "todo" | "skipped" | "blocked";

export interface StepInput {
  id: string;
  done: boolean;
  /** Not needed for this client (for example "Doctors" for a shop): counts as finished and shows as skipped. */
  skipped?: boolean;
  /** Ids of steps that must be finished first; until then this step is blocked. */
  needs?: string[];
}

export interface StepState {
  id: string;
  status: StepStatus;
  /** 1-based position, for "Step 2 of 5". */
  n: number;
}

const finished = (s: StepInput) => s.done || s.skipped === true;

/** The step to open: the first one not finished whose prerequisites are finished. Null when everything is finished. */
export function firstOpenStep(steps: StepInput[]): string | null {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const ready = (s: StepInput) => (s.needs ?? []).every((id) => { const d = byId.get(id); return !d || finished(d); });
  return steps.find((s) => !finished(s) && ready(s))?.id ?? steps.find((s) => !finished(s))?.id ?? null;
}

/**
 * Gives every step its status. `current` is the step on screen; left out, it is the first open step, so an existing client
 * resumes where it stopped. A step whose prerequisites are not finished is "blocked" (it can be looked at, not completed).
 */
export function stepStates(steps: StepInput[], current?: string | null): StepState[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const on = current && byId.has(current) ? current : firstOpenStep(steps);
  return steps.map((s, i) => {
    const blocked = (s.needs ?? []).some((id) => { const d = byId.get(id); return d ? !finished(d) : false; });
    const status: StepStatus =
      s.id === on ? "current" : s.skipped ? "skipped" : s.done ? "done" : blocked ? "blocked" : "todo";
    return { id: s.id, status, n: i + 1 };
  });
}

export function stepProgress(steps: StepInput[]) {
  const done = steps.filter(finished).length;
  return { done, total: steps.length, percent: steps.length ? Math.round((done / steps.length) * 100) : 0, complete: done === steps.length };
}

/** Next and previous step ids around `id`, for the wizard's Back and Next buttons. */
export function neighbours(steps: { id: string }[], id: string) {
  const i = steps.findIndex((s) => s.id === id);
  return { prev: i > 0 ? steps[i - 1].id : null, next: i >= 0 && i < steps.length - 1 ? steps[i + 1].id : null };
}

export interface TabTarget {
  href: string;
  /** Active only on exactly this address (for an Overview tab whose address is the start of all the others). */
  exact?: boolean;
}

/**
 * Which tab is active for `path`: an exact match, else the tab with the longest address that `path` sits under.
 * "/admin/clients/7/setup/business" makes the Setup tab active, not Overview ("/admin/clients/7").
 */
export function activeTab(path: string, tabs: TabTarget[]): number {
  const clean = path.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  let best = -1, len = -1;
  tabs.forEach((t, i) => {
    const h = t.href.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
    const hit = clean === h || (!t.exact && clean.startsWith(h + "/"));
    if (hit && h.length > len) { best = i; len = h.length; }
  });
  return best;
}
