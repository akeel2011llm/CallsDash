/**
 * Which parts of the client portal each person may open (2026-11-02, "access per person").
 *
 * A manager (and the admin viewing as the client) always has every section. A receptionist gets the client's default
 * for receptionists, unless the admin or the manager ticked a list for that person. Nothing set means every section,
 * which is how the portal worked before. Home and the person's own settings are always open.
 *
 * Stored as one setting per client (`access.<tenantId>`), so no table change is needed.
 */
export const SECTIONS = ["inbox", "bookings", "customers", "catalog", "assistant", "reports", "billing"] as const;
export type Section = (typeof SECTIONS)[number];

export interface AccessRules {
  /** What a receptionist without a list of their own may open. Missing = every section. */
  receptionist?: Section[];
  /** Lists for single people, by user id. */
  people?: Record<string, Section[]>;
}

export const accessKey = (tenantId: string) => `access.${tenantId}`;
export const isSection = (v: unknown): v is Section => typeof v === "string" && (SECTIONS as readonly string[]).includes(v);
const clean = (v: unknown): Section[] | undefined => (Array.isArray(v) ? SECTIONS.filter((s) => v.includes(s)) : undefined);

/** Reads the stored setting, dropping anything unknown. */
export function readAccess(v: unknown): AccessRules {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const people: Record<string, Section[]> = {};
  const p = o.people && typeof o.people === "object" && !Array.isArray(o.people) ? (o.people as Record<string, unknown>) : {};
  for (const [id, list] of Object.entries(p)) { const c = clean(list); if (c && /^[\w-]{1,80}$/.test(id)) people[id] = c; }
  const receptionist = clean(o.receptionist);
  return { ...(receptionist ? { receptionist } : {}), ...(Object.keys(people).length ? { people } : {}) };
}

/** The sections this person may open. */
export function sectionsFor(rules: AccessRules, role: "manager" | "receptionist", userId?: string): Section[] {
  if (role === "manager") return [...SECTIONS];
  return (userId && rules.people?.[userId]) || rules.receptionist || [...SECTIONS];
}

/** The portal section an address belongs to, or null for pages everyone may open (home, settings, account). */
export function sectionOf(path: string): Section | null {
  const p = path.split(/[?#]/)[0];
  const under = (...hs: string[]) => hs.some((h) => p === h || p.startsWith(h + "/"));
  if (under("/app/conversations", "/app/attention", "/app/messages", "/app/recordings")) return "inbox";
  if (under("/app/bookings", "/app/calendar", "/app/services", "/app/roles", "/app/doctors")) return "bookings";
  if (under("/app/customers")) return "customers";
  if (under("/app/catalogue", "/app/tables", "/app/data")) return "catalog";
  if (under("/app/assistant", "/app/knowledge", "/app/agent", "/app/voice", "/app/website")) return "assistant";
  if (under("/app/reports")) return "reports";
  if (under("/app/credits")) return "billing";
  return null;
}

/** The ticked boxes of an access form (`s_<section>`), as a list. */
export function sectionsFromForm(get: (k: string) => unknown): Section[] {
  return SECTIONS.filter((s) => get(`s_${s}`) === "on");
}

/** Saves one list: `who` is "receptionist" (the default) or a user id; `list` null removes that person's own list. */
export function withList(rules: AccessRules, who: string, list: Section[] | null): AccessRules {
  if (who === "receptionist") {
    const { receptionist: _drop, ...rest } = rules;
    return list ? { ...rest, receptionist: list } : rest;
  }
  const people = { ...(rules.people ?? {}) };
  if (list) people[who] = list; else delete people[who];
  const { people: _p, ...rest } = rules;
  return Object.keys(people).length ? { ...rest, people } : rest;
}
