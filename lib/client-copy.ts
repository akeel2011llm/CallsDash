import type { Data } from "./data/demo";
import type { AgentSettings, Branding, Tenant } from "./types";

type CreateInput = Parameters<Data["createTenant"]>[0];

export type CopyDeps = Pick<Data,
  "getTenant" | "getAgent" | "getKnowledge" | "getDoctors" | "createTenant" | "deleteTenant" | "updateTenant" | "setOpeningHours" | "setAlertRules"
  | "setPermissions" | "saveAgent" | "addKnowledge" | "addDoctor" | "updateDoctor" | "audit">;

export interface CopyInput {
  name: string;
  nameAr: string;
  domain: string;
  color: string;
  /** The new client's package, chosen like for any new client: the copy never inherits the old client's contract. */
  plan: NonNullable<CreateInput["plan"]>;
  copyDoctors: boolean;
  copyKnowledge: boolean;
}

export interface CopyReport { tenantId: string; renamed: number; doctors: number; knowledge: number }

export class CopyError extends Error {
  constructor(public code: "unknown_client") { super(code); }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Replaces the old clinic's names with the new ones in any text, ignoring case, and counts the replacements. Names under three
 * characters are left alone: they would match inside ordinary words.
 */
export function renamer(from: { names: string[]; namesAr: string[] }, to: { name: string; nameAr: string }) {
  const rules = [
    ...from.names.map((n) => ({ n, to: to.name })),
    ...from.namesAr.map((n) => ({ n, to: to.nameAr || to.name })),
  ].map((r) => ({ ...r, n: r.n.trim() })).filter((r) => r.n.length >= 3 && r.n.toLowerCase() !== r.to.toLowerCase());
  const seen = new Set<string>();
  const unique = rules.filter((r) => (seen.has(r.n.toLowerCase()) ? false : (seen.add(r.n.toLowerCase()), true))).sort((a, b) => b.n.length - a.n.length);
  let count = 0;
  const text = (s: string): string => {
    let out = s;
    for (const r of unique) out = out.replace(new RegExp(escapeRe(r.n), "gi"), () => { count++; return r.to; });
    return out;
  };
  const deep = <T,>(v: T): T => {
    if (typeof v === "string") return text(v) as T;
    if (Array.isArray(v)) return v.map(deep) as T;
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) as T;
    return v;
  };
  return { text, deep, count: () => count };
}

/** The look and wording of the old client, without its pictures and contact details (they belong to the old clinic). */
function brandingFor(src: Tenant, input: CopyInput, rename: (s: string) => string): Partial<Branding> {
  const b = src.branding;
  const keep: Partial<Branding> = {
    displayName: input.name, displayNameAr: input.nameAr || input.name, primaryColor: input.color, domain: input.domain || undefined,
  };
  for (const k of ["accentColor", "pattern", "sidebar", "radius", "font", "hidePoweredBy"] as const) if (b[k] !== undefined) Object.assign(keep, { [k]: b[k] });
  for (const k of ["welcome", "welcomeAr", "tagline", "taglineAr", "reportFooter"] as const) if (b[k]) Object.assign(keep, { [k]: rename(b[k]!) });
  return keep;
}

/**
 * Makes a new client from an existing one: look, hours, closures, rules, permissions, assistant instructions and options, and
 * optionally the doctors and the knowledge base, with the old clinic's name replaced by the new one.
 *
 * Never copied, because each would tie the two clinics together or leak one clinic's data to the other: patients, bookings,
 * conversations, credits and the wallet, sign-ins, the ElevenLabs agent, Google calendar ids, WhatsApp, Instagram and phone
 * settings, secrets, the contract, the logo and the support contacts. A failure part-way removes the half-made client.
 */
export async function duplicateClient(d: CopyDeps, sourceId: string, input: CopyInput, actor: string): Promise<CopyReport> {
  const src = await d.getTenant(sourceId);
  if (!src) throw new CopyError("unknown_client");
  const [srcAgent, knowledge, doctors] = await Promise.all([d.getAgent(sourceId), d.getKnowledge(sourceId), d.getDoctors(sourceId)]);
  const rn = renamer({ names: [src.name, src.branding.displayName], namesAr: [src.branding.displayNameAr] }, { name: input.name, nameAr: input.nameAr });

  // the duplicate check (name, website) happens here, before anything is made
  const created = await d.createTenant({ name: input.name, nameAr: input.nameAr, color: input.color, domain: input.domain, planType: input.plan.type, plan: input.plan, actor });
  const id = created.id;
  let doctorCount = 0, knowledgeCount = 0;
  try {
    await d.updateTenant(id, {
      zeroBalancePolicy: src.zeroBalancePolicy, lowBalanceThreshold: src.lowBalanceThreshold, retentionDays: src.retentionDays,
      closures: structuredClone(src.closures ?? []), branding: brandingFor(src, input, rn.text),
    }, actor);
    await d.setOpeningHours(id, structuredClone(src.openingHours), actor);
    await d.setAlertRules(id, structuredClone(src.alertRules), actor);
    await d.setPermissions(id, { ...src.permissions }, actor);

    const settings: AgentSettings = { ...rn.deep(structuredClone(srcAgent)), elevenLabsAgentId: "" };
    await d.saveAgent(id, settings, actor, `Copied from ${src.name}`);

    if (input.copyKnowledge) {
      for (const k of knowledge) { await d.addKnowledge(id, rn.text(k.question), rn.text(k.answer), k.language, actor); knowledgeCount++; }
    }
    if (input.copyDoctors) {
      for (const doc of doctors) {
        const nd = await d.addDoctor(id, { name: doc.name, specialty: doc.specialty }, actor);
        await d.updateDoctor(id, nd.id, { color: doc.color, ...(doc.active === false ? { active: false } : {}), ...(doc.hours ? { hours: structuredClone(doc.hours) } : {}) }, actor);
        doctorCount++;
      }
    }
    await d.audit(actor, `Copied from client "${src.name}"`, id);
  } catch (e) {
    await d.deleteTenant(id, actor).catch(() => undefined);
    throw e;
  }
  return { tenantId: id, renamed: rn.count(), doctors: doctorCount, knowledge: knowledgeCount };
}
