import type { Data } from "./data/demo";
import { asciiDigits } from "./cpr";
import { ID_CPR, asksId, idify, normalizeId, type IdRule } from "./id-rule";
import { cleanExtra, mergeExtra, type ExtraField } from "./extra-fields";
import type { Channel, Customer, Locale } from "./types";

export type CustomerDeps = Pick<Data, "getCustomer" | "findCustomer" | "putCustomer" | "deleteCustomer">;

export class CustomerError extends Error {
  constructor(public code: "bad_phone" | "bad_cpr" | "bad_email" | "duplicate_phone" | "cpr_mismatch" | "bad_extra" | "unknown", readonly detail = "") { super(code); }
}

const MAX_HISTORY = 50;
const MAX_CONVERSATIONS = 30;
const MAX_NOTES = 2000;
const clip = (s: string, n: number) => s.trim().slice(0, n);

/** The last 8 digits of a phone number, so +973 3600 1122, 36001122 and Arabic digits are the same customer. "" when too short. */
export function phoneKey(raw: string | null | undefined): string {
  const digits = asciiDigits(String(raw ?? "")).replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(-8) : "";
}

/** The number as it is shown and stored: +973 for an 8-digit Bahrain number, otherwise the digits given with a leading +. Null when it is not a phone number. */
export function cleanPhone(raw: string | null | undefined): string | null {
  const digits = asciiDigits(String(raw ?? "")).replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return digits.length === 8 ? `+973${digits}` : `+${digits.replace(/^00/, "")}`;
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? "";
const emailOk = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/** What the assistant is told about a caller. A phone number alone is not proof of who is calling, so notes and history need the CPR on file. */
export type LookupMode = "phone" | "cpr";

/**
 * How this clinic's assistant finds a returning customer. Phone number unless the clinic chose the CPR number (or its own ID
 * number, lib/id-rule.ts). A business that asks for no ID number always finds customers by phone number.
 */
export const lookupModeOf = (s: { customerLookup?: LookupMode } | undefined, rule: IdRule = ID_CPR): LookupMode =>
  (s?.customerLookup === "cpr" && asksId(rule) ? "cpr" : "phone");

/** `rule` is the client's ID number (lib/id-rule.ts); the CPR number unless the client chose another. */
export async function lookupCustomer(d: CustomerDeps, tenantId: string, input: { phone?: string; cpr?: string }, mode: LookupMode = "phone", rule: IdRule = ID_CPR) {
  if (mode === "cpr" && asksId(rule)) return lookupByCpr(d, tenantId, input.cpr ?? "", rule);
  const key = phoneKey(input.phone);
  if (!key) return { found: false, message: "That is not a full phone number. Ask the customer for it, or carry on without looking them up." };
  const c = await d.findCustomer(tenantId, { phoneKey: key });
  if (!c) return { found: false, message: "No customer with this number yet. Carry on, and when you have their name call save_customer." };
  // without an ID number nothing proves who is calling, so only the first name is ever shared
  if (!asksId(rule)) return { found: true, verified: false, first_name: firstName(c.name), language: c.language, message: "A returning customer. Greet them by first name only; nothing else about them can be shared." };
  const given = normalizeId(rule, input.cpr ?? "");
  if (input.cpr && !given) return { found: true, verified: false, first_name: firstName(c.name), language: c.language, message: idify("The CPR number is not 9 digits. Read it back to the customer and ask again. Share nothing but the first name until it matches.", rule) };
  if (given && c.cpr && given !== c.cpr) return { found: true, verified: false, cpr_mismatch: true, message: idify("The CPR number does not match this phone number. Do not share anything about this customer. Do not say which part did not match.", rule) };
  if (given && c.cpr && given === c.cpr) {
    return {
      found: true, verified: true, name: c.name, language: c.language, email: c.email, notes: c.notes || undefined,
      last_contact: c.lastContactAt, recent_conversations: c.history.slice(0, 3).map((h) => ({ at: h.at, channel: h.channel, summary: h.summary })),
      message: idify("Verified by CPR number. You may use these details to help the customer.", rule),
    };
  }
  return {
    found: true, verified: false, first_name: firstName(c.name), language: c.language,
    message: c.cpr
      ? idify("A returning customer. Greet them by first name only. To go further (notes, past conversations), ask for their CPR number and call lookup_customer again with it.", rule)
      : idify("A returning customer, but no CPR number is on file, so nothing more can be shared. Greet them by first name only. If they give their CPR number, pass it to save_customer so it can be checked next time.", rule),
  };
}

/** CPR mode: the CPR number is the key and the proof at once, so a match gives the customer's details. */
async function lookupByCpr(d: CustomerDeps, tenantId: string, rawCpr: string, rule: IdRule) {
  const cpr = normalizeId(rule, rawCpr);
  if (!cpr) return { found: false, message: idify("Ask the customer for their CPR number (9 digits, from the Bahraini ID card), read it back digit by digit, then call lookup_customer again with it as patient_cpr. Without a valid CPR number, carry on without looking them up.", rule) };
  const c = await d.findCustomer(tenantId, { cpr });
  if (!c) return { found: false, message: idify("No customer with this CPR number yet. Carry on, and when you have their name and phone number call save_customer.", rule) };
  return {
    found: true, verified: true, name: c.name, language: c.language, email: c.email, notes: c.notes || undefined,
    last_contact: c.lastContactAt, recent_conversations: c.history.slice(0, 3).map((h) => ({ at: h.at, channel: h.channel, summary: h.summary })),
    message: idify("Found by CPR number. You may use these details to help the customer. Never say the CPR number aloud.", rule),
  };
}

export interface AssistantSave {
  phone: string; name?: string; cpr?: string; language?: Locale; email?: string; note?: string; conversationId?: string; channel?: Channel;
  /** Answers to the client's own customer fields that the assistant asks for (lib/extra-fields.ts), already tidied. */
  extra?: Record<string, string>;
}

/**
 * Saves what the assistant learned: creates the customer or updates the one with this phone number (or already linked to this
 * conversation). A name, CPR or email is only changed when the CPR on file is repeated, so someone quoting another person's number
 * cannot rewrite that person's details; a note is always added. A CPR is only attached to a new customer or to an empty record (no
 * notes, no conversations): otherwise someone quoting another person's number could add their own CPR and then read that person's
 * notes. Staff add a CPR to any other record on the Customers screen.
 */
export async function saveCustomerFromAssistant(d: CustomerDeps, tenantId: string, input: AssistantSave, mode: LookupMode = "phone", rule: IdRule = ID_CPR): Promise<{ customer: Customer; created: boolean; cprSaved: boolean }> {
  const cpr = input.cpr ? normalizeId(rule, input.cpr) : null;
  // CPR mode: the customer is the one with this CPR number, whatever phone they call from now
  const byCpr = mode === "cpr" && cpr ? await d.findCustomer(tenantId, { cpr }) : undefined;
  const phone = cleanPhone(input.phone) ?? (byCpr ? byCpr.phone : null);
  if (!phone) throw new CustomerError("bad_phone");
  const existing = byCpr ?? await d.findCustomer(tenantId, { phoneKey: phoneKey(phone), conversationId: input.conversationId });
  const now = new Date().toISOString();
  const email = input.email && emailOk(input.email.trim()) ? clip(input.email, 120) : undefined;
  const note = input.note ? clip(input.note, 400) : "";
  const stamp = (n: string) => `${now.slice(0, 10)}: ${n}`;
  const convs = (c: string[]) => (input.conversationId && !c.includes(input.conversationId) ? [input.conversationId, ...c] : c).slice(0, MAX_CONVERSATIONS);

  const extra = input.extra && Object.keys(input.extra).length ? input.extra : undefined;
  if (!existing) {
    const customer = await d.putCustomer(tenantId, {
      phone, name: clip(input.name ?? "", 120), cpr: cpr ?? undefined, language: input.language, email, notes: note ? stamp(note) : "", ...(extra ? { extra } : {}),
      createdAt: now, updatedAt: now, lastContactAt: now, conversationIds: convs([]), history: [],
    }, "assistant");
    return { customer, created: true, cprSaved: Boolean(cpr) };
  }
  // someone who knows the number but not the CPR on file may add a note, but not change who the customer is
  const mayChange = !existing.cpr || (cpr !== null && cpr === existing.cpr);
  if (!mayChange && (input.name || input.email || cpr || extra)) throw new CustomerError("cpr_mismatch");
  const notes = note ? `${existing.notes ? `${existing.notes}\n` : ""}${stamp(note)}`.slice(-MAX_NOTES) : existing.notes;
  // CPR mode also fills in a record the post-call webhook made from a bare phone number (no name, no notes): it starts afresh with its
  // earlier conversations dropped, since nothing shows they were this person's
  const fresh = mode === "cpr" && !existing.name && !existing.notes;
  const attach = cpr !== null && !existing.cpr && (fresh || (!existing.notes && existing.history.length === 0));
  const base = attach && fresh ? { ...existing, history: [], conversationIds: [] } : existing;
  const customer = await d.putCustomer(tenantId, {
    ...base,
    name: input.name ? clip(input.name, 120) : existing.name,
    cpr: existing.cpr ?? (attach ? cpr : undefined),
    language: input.language ?? existing.language,
    email: email ?? existing.email,
    ...(extra ? { extra: { ...(existing.extra ?? {}), ...extra } } : {}),
    notes, updatedAt: now, lastContactAt: now, conversationIds: convs(base.conversationIds),
  }, "assistant");
  return { customer, created: false, cprSaved: attach };
}

/**
 * Adds a finished conversation to the customer's history (called by the post-call webhook). The customer is found by the caller's
 * number when ElevenLabs sent one, otherwise by the conversation id the assistant linked with save_customer. A caller's number
 * with no customer yet becomes one. Returns null when the conversation cannot be tied to anyone.
 */
export async function recordVisit(d: CustomerDeps, tenantId: string, v: { conversationId: string; phone?: string; channel: Channel; language: Locale; summary: string; at: string }): Promise<Customer | null> {
  const phone = cleanPhone(v.phone ?? "");
  const found = await d.findCustomer(tenantId, { phoneKey: phone ? phoneKey(phone) : undefined, conversationId: v.conversationId });
  const entry = { at: v.at, channel: v.channel, conversationId: v.conversationId, summary: clip(v.summary, 400) };
  if (!found) {
    if (!phone) return null;
    return d.putCustomer(tenantId, {
      phone, name: "", language: v.language, notes: "", createdAt: v.at, updatedAt: v.at, lastContactAt: v.at,
      conversationIds: [v.conversationId], history: [entry],
    }, "assistant");
  }
  if (found.history.some((h) => h.conversationId === v.conversationId)) return found; // the same webhook delivered twice
  return d.putCustomer(tenantId, {
    ...found, language: found.language ?? v.language,
    lastContactAt: found.lastContactAt && found.lastContactAt > v.at ? found.lastContactAt : v.at,
    conversationIds: found.conversationIds.includes(v.conversationId) ? found.conversationIds : [v.conversationId, ...found.conversationIds].slice(0, MAX_CONVERSATIONS),
    history: [entry, ...found.history].slice(0, MAX_HISTORY),
  }, "assistant");
}

export interface StaffCustomerInput {
  id?: string; name: string; phone: string; cpr?: string; email?: string; language?: Locale; notes?: string;
  /** Answers to the client's own customer fields, as typed; only the fields given are changed. */
  extra?: Record<string, unknown>;
}

/**
 * Add (no id) or edit a customer from the Customers screen. Phone numbers are unique per client. A business that asks for no
 * ID number has no ID box, so an edit keeps any number saved before.
 */
export async function saveCustomerByStaff(d: CustomerDeps, tenantId: string, input: StaffCustomerInput, actor: string, rule: IdRule = ID_CPR, fields: ExtraField[] = [], need: "all" | "none" = "all"): Promise<Customer> {
  const phone = cleanPhone(input.phone);
  if (!phone) throw new CustomerError("bad_phone");
  const cprRaw = asksId(rule) ? (input.cpr ?? "").trim() : "";
  const before = input.id ? (await d.getCustomer(tenantId, input.id))?.cpr : undefined;
  // a number saved before the client changed its ID rule stays valid while nobody changes it
  const cpr = cprRaw && cprRaw === before ? before : cprRaw ? normalizeId(rule, cprRaw) : null;
  if (cprRaw && !cpr) throw new CustomerError("bad_cpr");
  const email = (input.email ?? "").trim();
  if (email && !emailOk(email)) throw new CustomerError("bad_email");
  const answers = input.extra && fields.length ? cleanExtra(fields, input.extra, need) : null;
  if (answers?.errors.length) throw new CustomerError("bad_extra", answers.errors.map((e) => fields.find((f) => f.key === e.key)?.label ?? e.key).join(", "));
  const other = await d.findCustomer(tenantId, { phoneKey: phoneKey(phone) });
  if (other && other.id !== input.id) throw new CustomerError("duplicate_phone");
  const now = new Date().toISOString();
  if (input.id) {
    const cur = await d.getCustomer(tenantId, input.id);
    if (!cur) throw new CustomerError("unknown");
    return d.putCustomer(tenantId, {
      ...cur, name: clip(input.name, 120), phone, cpr: asksId(rule) ? cpr ?? undefined : cur.cpr, email: email || undefined, language: input.language,
      ...(answers ? { extra: mergeExtra(cur.extra, fields, answers.values) } : {}),
      notes: clip(input.notes ?? "", MAX_NOTES), updatedAt: now,
    }, actor);
  }
  return d.putCustomer(tenantId, {
    name: clip(input.name, 120), phone, cpr: cpr ?? undefined, email: email || undefined, language: input.language, notes: clip(input.notes ?? "", MAX_NOTES),
    ...(answers && Object.values(answers.values).some(Boolean) ? { extra: mergeExtra(undefined, fields, answers.values) } : {}),
    createdAt: now, updatedAt: now, conversationIds: [], history: [],
  }, actor);
}
