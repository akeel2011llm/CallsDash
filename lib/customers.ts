import type { Data } from "./data/demo";
import { asciiDigits, normalizeCpr } from "./cpr";
import type { Channel, Customer, Locale } from "./types";

export type CustomerDeps = Pick<Data, "getCustomer" | "findCustomer" | "putCustomer" | "deleteCustomer">;

export class CustomerError extends Error {
  constructor(public code: "bad_phone" | "bad_cpr" | "bad_email" | "duplicate_phone" | "cpr_mismatch" | "unknown") { super(code); }
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
export async function lookupCustomer(d: CustomerDeps, tenantId: string, input: { phone: string; cpr?: string }) {
  const key = phoneKey(input.phone);
  if (!key) return { found: false, message: "That is not a full phone number. Ask the customer for it, or carry on without looking them up." };
  const c = await d.findCustomer(tenantId, { phoneKey: key });
  if (!c) return { found: false, message: "No customer with this number yet. Carry on, and when you have their name call save_customer." };
  const given = normalizeCpr(input.cpr ?? "");
  if (input.cpr && !given) return { found: true, verified: false, first_name: firstName(c.name), language: c.language, message: "The CPR number is not 9 digits. Read it back to the customer and ask again. Share nothing but the first name until it matches." };
  if (given && c.cpr && given !== c.cpr) return { found: true, verified: false, cpr_mismatch: true, message: "The CPR number does not match this phone number. Do not share anything about this customer. Do not say which part did not match." };
  if (given && c.cpr && given === c.cpr) {
    return {
      found: true, verified: true, name: c.name, language: c.language, email: c.email, notes: c.notes || undefined,
      last_contact: c.lastContactAt, recent_conversations: c.history.slice(0, 3).map((h) => ({ at: h.at, channel: h.channel, summary: h.summary })),
      message: "Verified by CPR number. You may use these details to help the customer.",
    };
  }
  return {
    found: true, verified: false, first_name: firstName(c.name), language: c.language,
    message: c.cpr
      ? "A returning customer. Greet them by first name only. To go further (notes, past conversations), ask for their CPR number and call lookup_customer again with it."
      : "A returning customer, but no CPR number is on file, so nothing more can be shared. Greet them by first name only. If they give their CPR number, pass it to save_customer so it can be checked next time.",
  };
}

export interface AssistantSave {
  phone: string; name?: string; cpr?: string; language?: Locale; email?: string; note?: string; conversationId?: string; channel?: Channel;
}

/**
 * Saves what the assistant learned: creates the customer or updates the one with this phone number (or already linked to this
 * conversation). A name, CPR or email is only changed when the CPR on file is repeated, so someone quoting another person's number
 * cannot rewrite that person's details; a note is always added. A CPR is only attached to a new customer or to an empty record (no
 * notes, no conversations): otherwise someone quoting another person's number could add their own CPR and then read that person's
 * notes. Staff add a CPR to any other record on the Customers screen.
 */
export async function saveCustomerFromAssistant(d: CustomerDeps, tenantId: string, input: AssistantSave): Promise<{ customer: Customer; created: boolean; cprSaved: boolean }> {
  const phone = cleanPhone(input.phone);
  if (!phone) throw new CustomerError("bad_phone");
  const cpr = input.cpr ? normalizeCpr(input.cpr) : null;
  const existing = await d.findCustomer(tenantId, { phoneKey: phoneKey(phone), conversationId: input.conversationId });
  const now = new Date().toISOString();
  const email = input.email && emailOk(input.email.trim()) ? clip(input.email, 120) : undefined;
  const note = input.note ? clip(input.note, 400) : "";
  const stamp = (n: string) => `${now.slice(0, 10)}: ${n}`;
  const convs = (c: string[]) => (input.conversationId && !c.includes(input.conversationId) ? [input.conversationId, ...c] : c).slice(0, MAX_CONVERSATIONS);

  if (!existing) {
    const customer = await d.putCustomer(tenantId, {
      phone, name: clip(input.name ?? "", 120), cpr: cpr ?? undefined, language: input.language, email, notes: note ? stamp(note) : "",
      createdAt: now, updatedAt: now, lastContactAt: now, conversationIds: convs([]), history: [],
    }, "assistant");
    return { customer, created: true, cprSaved: Boolean(cpr) };
  }
  // someone who knows the number but not the CPR on file may add a note, but not change who the customer is
  const mayChange = !existing.cpr || (cpr !== null && cpr === existing.cpr);
  if (!mayChange && (input.name || input.email || cpr)) throw new CustomerError("cpr_mismatch");
  const notes = note ? `${existing.notes ? `${existing.notes}\n` : ""}${stamp(note)}`.slice(-MAX_NOTES) : existing.notes;
  const attach = cpr !== null && !existing.cpr && !existing.notes && existing.history.length === 0;
  const customer = await d.putCustomer(tenantId, {
    ...existing,
    name: input.name ? clip(input.name, 120) : existing.name,
    cpr: existing.cpr ?? (attach ? cpr : undefined),
    language: input.language ?? existing.language,
    email: email ?? existing.email,
    notes, updatedAt: now, lastContactAt: now, conversationIds: convs(existing.conversationIds),
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

export interface StaffCustomerInput { id?: string; name: string; phone: string; cpr?: string; email?: string; language?: Locale; notes?: string }

/** Add (no id) or edit a customer from the Customers screen. Phone numbers are unique per client. */
export async function saveCustomerByStaff(d: CustomerDeps, tenantId: string, input: StaffCustomerInput, actor: string): Promise<Customer> {
  const phone = cleanPhone(input.phone);
  if (!phone) throw new CustomerError("bad_phone");
  const cprRaw = (input.cpr ?? "").trim();
  const cpr = cprRaw ? normalizeCpr(cprRaw) : null;
  if (cprRaw && !cpr) throw new CustomerError("bad_cpr");
  const email = (input.email ?? "").trim();
  if (email && !emailOk(email)) throw new CustomerError("bad_email");
  const other = await d.findCustomer(tenantId, { phoneKey: phoneKey(phone) });
  if (other && other.id !== input.id) throw new CustomerError("duplicate_phone");
  const now = new Date().toISOString();
  if (input.id) {
    const cur = await d.getCustomer(tenantId, input.id);
    if (!cur) throw new CustomerError("unknown");
    return d.putCustomer(tenantId, {
      ...cur, name: clip(input.name, 120), phone, cpr: cpr ?? undefined, email: email || undefined, language: input.language,
      notes: clip(input.notes ?? "", MAX_NOTES), updatedAt: now,
    }, actor);
  }
  return d.putCustomer(tenantId, {
    name: clip(input.name, 120), phone, cpr: cpr ?? undefined, email: email || undefined, language: input.language, notes: clip(input.notes ?? "", MAX_NOTES),
    createdAt: now, updatedAt: now, conversationIds: [], history: [],
  }, actor);
}
