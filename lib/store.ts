import "server-only";
import { addTopUp, balance, creditsFor, deduct, lowBalance, renewPackage, revenuePerCredit, round2, sweepExpired, addMonths, topUpKind } from "./credits";
import { detectFlags, DEFAULT_RULES } from "./flags";
import { PLAN_PRESETS, firstPackage, type PlanInput } from "./plans";
import { DuplicateError, SlotTakenError } from "./errors";
import { findDuplicate, nameKey } from "./tenant-keys";
import { DEFAULT_OPENING_HOURS } from "./availability";
import { seed, type DB, FLAT_RATES } from "./seed";
import { pictureBytes } from "./photo-size";
import { conversationCostUsd } from "./costing";
import { USD_TO_BHD } from "./pricing";
import type {
  AgentToolCall,
  NewConversation,
  AgentSettings, Booking, BookingMessage, BookingStatus, Channel, Conversation, ChatSession, Customer, Doctor, Item, Locale, Permissions, Profile, StaffRequest, Tenant, TenantSecrets,
} from "./types";

/**
 * Demo data layer. State lives in process memory and is re-seeded on cold start, so it is only
 * for demos and local development. The production schema is in supabase/migrations; the Supabase
 * adapter replaces this module behind the same function names.
 */
const g = globalThis as unknown as { __callsdash?: DB };
const db = (): DB => (g.__callsdash ??= seed());
const id = (p: string) => `${p}_${++db().seq}`;
const now = () => new Date();

function sweep(tenantId: string) {
  const d = db();
  const mine = d.batches.filter((b) => b.tenantId === tenantId);
  const { batches, expired } = sweepExpired(mine, now());
  if (expired > 0) {
    d.batches = [...d.batches.filter((b) => b.tenantId !== tenantId), ...batches];
    d.ledger.push({ id: id("l"), tenantId, at: now().toISOString(), kind: "expiry", credits: -expired, note: "Credits expired" });
  }
}

export const listTenants = () => db().tenants;
/** Demo sign-in is a cookie, so these profiles only fill the Users pages with something to look at. */
export const getProfile = (userId: string): Profile | undefined => db().profiles.find((p) => p.id === userId);
export const listProfiles = (tenantId?: string): Profile[] =>
  db().profiles.filter((p) => !tenantId || p.tenantId === tenantId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

/** Adds a person. Emails are unique across the whole system, whatever the capitalisation. */
export function saveProfile(p: Profile, actor: string) {
  const d = db();
  if (d.profiles.some((x) => x.id !== p.id && x.email.toLowerCase() === p.email.toLowerCase())) throw new DuplicateError("email");
  const i = d.profiles.findIndex((x) => x.id === p.id);
  if (i >= 0) d.profiles[i] = p; else d.profiles.push(p);
  audit(actor, `User ${i >= 0 ? "updated" : "created"}: ${p.email} (${p.role})`, p.tenantId ?? undefined);
}

export function patchProfile(userId: string, patch: Partial<Pick<Profile, "role" | "fullName" | "disabled" | "mustChangePassword" | "email" | "doctorId">>, actor: string, note: string) {
  const p = db().profiles.find((x) => x.id === userId);
  if (!p) return;
  Object.assign(p, patch);
  audit(actor, `${note}: ${p.email}`, p.tenantId ?? undefined);
}

export function removeProfile(userId: string, actor: string) {
  const d = db();
  const p = d.profiles.find((x) => x.id === userId);
  if (!p) return;
  d.profiles = d.profiles.filter((x) => x.id !== userId);
  audit(actor, `User deleted: ${p.email}`, p.tenantId ?? undefined);
}

export function setIntegrations(tenantId: string, integrations: Tenant["integrations"], actor: string, note?: string) {
  getTenant(tenantId)!.integrations = integrations;
  if (note) audit(actor, note, tenantId);
}

export function setChannelStatus(tenantId: string, channel: Channel, status: Tenant["channels"][Channel], actor: string) {
  const t = getTenant(tenantId)!;
  if (t.channels[channel] === status) return;
  t.channels[channel] = status;
  audit(actor, `Channel ${channel} set to ${status}`, tenantId);
}

export const getSecrets = (tenantId: string): TenantSecrets => ({ ...(db().secrets[tenantId] ?? {}) });

/** Merges into the stored secrets. An empty string removes a value. */
export function setSecrets(tenantId: string, patch: Partial<TenantSecrets>) {
  const next: Record<string, string> = { ...(db().secrets[tenantId] ?? {}) };
  for (const [k, v] of Object.entries(patch)) if (v) next[k] = v; else delete next[k];
  db().secrets[tenantId] = next;
}

export const getSetting = (key: string): unknown => db().settings[key];
export function setSetting(key: string, value: unknown) { db().settings[key] = value; }

export const getChatSession = (tenantId: string, channel: Channel, externalId: string) =>
  db().chatSessions.find((s) => s.tenantId === tenantId && s.channel === channel && s.externalId === externalId);
export const findChatSession = (conversationId: string) => db().chatSessions.find((s) => s.conversationId === conversationId);
export function saveChatSession(s: ChatSession) {
  const d = db();
  d.chatSessions = [...d.chatSessions.filter((x) => !(x.tenantId === s.tenantId && x.channel === s.channel && x.externalId === s.externalId)), s];
}
export function deleteChatSession(conversationId: string) {
  const d = db();
  d.chatSessions = d.chatSessions.filter((x) => x.conversationId !== conversationId);
}

export function setOnboarding(tenantId: string, onboarding: Tenant["onboarding"], actor: string, note?: string) {
  getTenant(tenantId)!.onboarding = onboarding;
  if (note) audit(actor, note, tenantId);
}
export function setBusiness(tenantId: string, business: NonNullable<Tenant["business"]>, actor: string, note?: string) {
  getTenant(tenantId)!.business = business;
  if (note) audit(actor, note, tenantId);
}
export const getTenant = (tenantId: string) => db().tenants.find((t) => t.id === tenantId);
export const getAgent = (tenantId: string) => db().agents[tenantId];
export const getAgentVersions = (tenantId: string) =>
  db().agentVersions.filter((v) => v.tenantId === tenantId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
export const getDoctors = (tenantId: string) => db().doctors.filter((d) => d.tenantId === tenantId);
export const getBookings = (tenantId: string) =>
  db().bookings.filter((b) => b.tenantId === tenantId).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
export const getConversations = (tenantId: string) => db().conversations.filter((c) => c.tenantId === tenantId);
export const getConversation = (tenantId: string, convId: string) =>
  db().conversations.find((c) => c.tenantId === tenantId && c.id === convId);
export const getKnowledge = (tenantId: string) => db().knowledge.filter((k) => k.tenantId === tenantId);
export const getUnanswered = (tenantId: string) => db().unanswered.filter((u) => u.tenantId === tenantId);
export const getAlerts = (tenantId?: string) =>
  db().alerts.filter((a) => !tenantId || a.tenantId === tenantId).sort((a, b) => b.at.localeCompare(a.at));
export const getStaffRequests = (tenantId: string) =>
  db().staffRequests.filter((r) => r.tenantId === tenantId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

/** Customers of a client, the most recently in touch first. */
export const getCustomers = (tenantId: string) =>
  (db().customers ??= []).filter((c) => c.tenantId === tenantId).sort((a, b) => (b.lastContactAt ?? b.createdAt).localeCompare(a.lastContactAt ?? a.createdAt));
export const getCustomer = (tenantId: string, customerId: string) => (db().customers ??= []).find((c) => c.tenantId === tenantId && c.id === customerId);
/** Finds a customer by the last 8 digits of the phone number, the CPR number, or a linked ElevenLabs conversation id. */
export const findCustomer = (tenantId: string, by: { phoneKey?: string; conversationId?: string; cpr?: string }) =>
  (db().customers ??= []).find((c) => c.tenantId === tenantId
    && ((by.phoneKey && c.phone.replace(/\D/g, "").slice(-8) === by.phoneKey) || (by.cpr && c.cpr === by.cpr) || (by.conversationId && c.conversationIds.includes(by.conversationId))));
/** Adds the customer (no existing id) or replaces the stored one; the new id is returned inside the record. */
export function putCustomer(tenantId: string, c: Omit<Customer, "id" | "tenantId"> & { id?: string }, actor: string): Customer {
  const list = (db().customers ??= []);
  const i = c.id ? list.findIndex((x) => x.tenantId === tenantId && x.id === c.id) : -1;
  const saved: Customer = { ...structuredClone(c), id: i >= 0 ? list[i].id : id("cu"), tenantId };
  if (i >= 0) list[i] = saved; else list.push(saved);
  // the assistant saves after every conversation; only people's own changes belong in the audit log
  if (actor !== "assistant") audit(actor, `${i >= 0 ? "Customer updated" : "Customer added"}: ${saved.name || saved.phone}`, tenantId);
  return saved;
}
export function deleteCustomer(tenantId: string, customerId: string, actor: string) {
  const d = db();
  const list = (d.customers ??= []);
  const before = list.length;
  d.customers = list.filter((x) => !(x.tenantId === tenantId && x.id === customerId));
  if (d.customers.length < before) audit(actor, "Customer deleted", tenantId);
}

/** The catalogue of a client, by name. */
export const getItems = (tenantId: string) =>
  (db().items ??= []).filter((i) => i.tenantId === tenantId).sort((a, b) => a.name.localeCompare(b.name));
export const getItem = (tenantId: string, itemId: string) => (db().items ??= []).find((i) => i.tenantId === tenantId && i.id === itemId);
/** The stored photo of an item as a data: URL, if it has one. */
export function getItemImage(tenantId: string, itemId: string): string | undefined {
  return getItem(tenantId, itemId) ? (db().itemImages ??= {})[itemId] : undefined;
}
/** Adds the item (no id) or replaces it. `image` is a data: URL to store, null to remove the photo, undefined to keep it. */
export function putItem(tenantId: string, i: Omit<Item, "id" | "tenantId" | "hasImage" | "updatedAt"> & { id?: string }, image: string | null | undefined, actor: string): Item {
  const d = db();
  const list = (d.items ??= []);
  const images = (d.itemImages ??= {});
  const at = list.findIndex((x) => x.tenantId === tenantId && x.id === i.id);
  const itemId = at >= 0 ? list[at].id : id("it");
  if (image) images[itemId] = image; else if (image === null) delete images[itemId];
  const saved: Item = { ...structuredClone(i), id: itemId, tenantId, hasImage: Boolean(images[itemId]), updatedAt: now().toISOString() };
  if (at >= 0) list[at] = saved; else list.push(saved);
  audit(actor, `${at >= 0 ? "Catalogue item updated" : "Catalogue item added"}: ${saved.name}`, tenantId);
  return saved;
}
export function deleteItem(tenantId: string, itemId: string, actor: string) {
  const d = db();
  const list = (d.items ??= []);
  const gone = list.find((x) => x.tenantId === tenantId && x.id === itemId);
  if (!gone) return;
  d.items = list.filter((x) => x !== gone);
  delete (d.itemImages ??= {})[itemId];
  audit(actor, `Catalogue item deleted: ${gone.name}`, tenantId);
}

export function addStaffRequest(tenantId: string, r: Pick<StaffRequest, "kind" | "name" | "phone" | "text" | "urgent" | "language"> & { conversationId?: string }) {
  const req: StaffRequest = { ...r, id: id("sr"), tenantId, status: "open", createdAt: now().toISOString() };
  db().staffRequests.push(req);
  return req;
}

export function setStaffRequestStatus(tenantId: string, requestId: string, status: "open" | "done", actor: string) {
  const r = db().staffRequests.find((x) => x.tenantId === tenantId && x.id === requestId);
  if (!r) return;
  r.status = status;
  r.handledAt = status === "done" ? now().toISOString() : undefined;
  audit(actor, status === "done" ? "Marked a message as handled" : "Reopened a message", tenantId);
}

export function setAlertRules(tenantId: string, rules: Tenant["alertRules"], actor: string) {
  getTenant(tenantId)!.alertRules = rules;
  audit(actor, "Alert rules changed", tenantId);
}

export function setConversationReviewed(tenantId: string, conversationId: string, reviewed: boolean, actor: string) {
  const c = db().conversations.find((x) => x.tenantId === tenantId && x.id === conversationId);
  if (!c) return;
  c.reviewed = reviewed;
  audit(actor, reviewed ? "Reviewed a flagged conversation" : "Reopened a flagged conversation", tenantId);
}

export function setOpeningHours(tenantId: string, hours: Tenant["openingHours"], actor: string) {
  getTenant(tenantId)!.openingHours = hours;
  audit(actor, "Opening hours changed", tenantId);
}

/** Keeps the newest 300 tool calls; older ones are only useful while a problem is being chased. */
export function logToolCall(e: Omit<AgentToolCall, "id" | "at">) {
  const d = db();
  d.toolCalls.push({ ...e, id: id("tc"), at: now().toISOString() });
  if (d.toolCalls.length > 300) d.toolCalls.splice(0, d.toolCalls.length - 300);
}

export const getToolCalls = (tenantId?: string, limit = 30) =>
  db().toolCalls.filter((c) => !tenantId || c.tenantId === tenantId).sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);

export const getAudit = (tenantId?: string) =>
  db().audit.filter((a) => !tenantId || a.tenantId === tenantId).sort((a, b) => b.at.localeCompare(a.at));
export const getLedger = (tenantId: string) => db().ledger.filter((l) => l.tenantId === tenantId).sort((a, b) => b.at.localeCompare(a.at));
export const getTopUpRequests = () => db().topUpRequests.filter((r) => r.status === "open");

export function getWallet(tenantId: string) {
  sweep(tenantId);
  const t = getTenant(tenantId)!;
  const batches = db().batches.filter((b) => b.tenantId === tenantId);
  const n = now();
  const low = lowBalance(batches, t.plans, t.lowBalanceThreshold, n);
  return { batches, balance: balance(batches, n), low: low.low, reference: low.reference };
}

export function usageByChannel(tenantId: string, since: Date) {
  const out: Record<Channel, number> = { website: 0, whatsapp: 0, instagram: 0, phone: 0 };
  for (const c of getConversations(tenantId)) if (new Date(c.startedAt) >= since) out[c.channel] = round2(out[c.channel] + c.creditsCharged);
  return out;
}

export function audit(actor: string, action: string, tenantId?: string) {
  db().audit.push({ id: id("au"), tenantId, at: now().toISOString(), actor, action });
}

/** Credits for one finished conversation, deducted from the wallet. Returns whether the wallet ran dry. */
export function recordConversation(tenantId: string, input: NewConversation) {
  const { aiFlags: _aiFlags, ...conv } = input;
  const d = db();
  const t = getTenant(tenantId);
  if (!t) throw new Error("unknown tenant");
  // webhooks are retried, so the same ElevenLabs conversation must never be charged twice
  const dup = conv.elevenLabsConversationId && d.conversations.find((c) => c.elevenLabsConversationId === conv.elevenLabsConversationId);
  if (dup) return { conversation: dup, shortfall: 0, duplicate: true };
  sweep(tenantId);
  const credits = creditsFor(conv);
  const mine = d.batches.filter((b) => b.tenantId === tenantId);
  const res = deduct(mine, credits, now());
  d.batches = [...d.batches.filter((b) => b.tenantId !== tenantId), ...res.batches];
  const flags = detectFlags(input, t.alertRules);
  const full: Conversation = {
    ...conv, id: id("c"), tenantId, creditsCharged: credits, flags, reviewed: false,
    costUsd: conv.costUsd ?? conversationCostUsd(conv, FLAT_RATES),
  };
  d.conversations.unshift(full);
  if (t.alertRules.emergency.notifyStaff && flags.includes("emergency"))
    addStaffRequest(tenantId, { kind: "handoff", name: "", phone: "", text: `Call flagged as an emergency: ${conv.summary}`, urgent: true, language: conv.language, conversationId: full.id });
  d.ledger.push({ id: id("l"), tenantId, at: conv.startedAt, kind: "usage", credits: -credits, channel: conv.channel, conversationId: full.id });
  const after = getWallet(tenantId);
  if (res.shortfall > 0 || after.low) {
    const already = d.alerts.some((a) => a.tenantId === tenantId && !a.resolved && a.message.startsWith("Low credit"));
    if (!already) d.alerts.push({ id: id("a"), tenantId, at: now().toISOString(), severity: "warning", resolved: false, message: `Low credit balance: ${after.balance} credits left.` });
  }
  return { conversation: full, shortfall: res.shortfall, duplicate: false };
}

export function topUp(tenantId: string, credits: number, actor: string, note = "Top-up") {
  const d = db();
  const t = getTenant(tenantId)!;
  d.batches = addTopUp(d.batches, { id: id("cb"), tenantId, amount: credits, now: now(), kind: topUpKind(t.plans), note });
  d.ledger.push({ id: id("l"), tenantId, at: now().toISOString(), kind: "topup", credits, note });
  d.topUpRequests.filter((r) => r.tenantId === tenantId && r.status === "open").forEach((r) => (r.status = "done"));
  d.alerts.filter((a) => a.tenantId === tenantId && a.message.startsWith("Low credit")).forEach((a) => (a.resolved = true));
  audit(actor, `Added ${credits} credits`, tenantId);
}

export function requestTopUp(tenantId: string, credits: number, actor: string) {
  db().topUpRequests.push({ id: id("tr"), tenantId, at: now().toISOString(), credits, status: "open" });
  audit(actor, `Requested a top-up of ${credits} credits`, tenantId);
}

/** Start the next period of one package (admin button here; a monthly cron in production). Other packages are untouched. */
export function renewTenantPackage(tenantId: string, actor: string, planId?: string) {
  const d = db();
  const t = getTenant(tenantId)!;
  const plan = t.plans.find((p) => p.active && p.type === "package" && (!planId || p.id === planId));
  if (!plan) throw new Error("not a package plan");
  const periodStart = addMonths(plan.periodStart, 1);
  const res = renewPackage(d.batches.filter((b) => b.tenantId === tenantId), {
    tenantId, plan, periodStart, ids: { rollover: id("cb"), package: id("cb") }, adoptUnowned: firstPackage(t.plans)?.id === plan.id,
  });
  d.batches = [...d.batches.filter((b) => b.tenantId !== tenantId), ...res.batches];
  plan.periodStart = periodStart;
  const at = now().toISOString();
  if (res.lapsed > 0) d.ledger.push({ id: id("l"), tenantId, at, kind: "expiry", credits: -res.lapsed, note: `Unused credits lapsed (${plan.name})` });
  if (res.carried > 0) d.ledger.push({ id: id("l"), tenantId, at, kind: "rollover", credits: res.carried, note: `Rollover from previous month (${plan.name})` });
  d.ledger.push({ id: id("l"), tenantId, at, kind: "package_renewal", credits: plan.includedCredits, note: plan.name });
  audit(actor, `Renewed ${plan.name}: ${res.carried} credits rolled over, ${res.lapsed} lapsed`, tenantId);
  return res;
}

/** Adds another plan to a client. A package starts today with its included credits; they join the shared wallet. */
export function addPlan(tenantId: string, input: PlanInput & { packageId?: string; contractRef?: string }, actor: string) {
  const d = db();
  const t = getTenant(tenantId)!;
  const start = now().toISOString();
  const plan = { ...input, contractRef: input.contractRef || undefined, id: id("plan"), active: true, periodStart: start };
  t.plans.push(plan);
  if (plan.type === "package") {
    d.batches.push({ id: id("cb"), tenantId, kind: "package", planId: plan.id, amount: plan.includedCredits, remaining: plan.includedCredits, purchasedAt: start, expiresAt: addMonths(start, 1), note: plan.name });
    d.ledger.push({ id: id("l"), tenantId, at: start, kind: "package_renewal", credits: plan.includedCredits, note: plan.name });
  }
  audit(actor, `Added plan ${plan.name}`, tenantId);
  return plan;
}

/** Stops a plan from renewing. Credits already paid for stay usable until they expire. At least one plan must remain active. */
export function endPlan(tenantId: string, planId: string, actor: string) {
  const t = getTenant(tenantId)!;
  const plan = t.plans.find((p) => p.id === planId && p.active);
  if (!plan || t.plans.filter((p) => p.active).length < 2) return false;
  plan.active = false;
  audit(actor, `Ended plan ${plan.name}`, tenantId);
  return true;
}

export function saveAgent(tenantId: string, settings: AgentSettings, actor: string, summary: string) {
  const d = db();
  d.agents[tenantId] = settings;
  d.agentVersions.push({ id: id("v"), tenantId, createdAt: now().toISOString(), author: actor, summary, settings: structuredClone(settings) });
  audit(actor, `Agent settings saved: ${summary}`, tenantId);
}

export function rollbackAgent(tenantId: string, versionId: string, actor: string) {
  const v = db().agentVersions.find((x) => x.id === versionId && x.tenantId === tenantId);
  if (!v) throw new Error("version not found");
  saveAgent(tenantId, structuredClone(v.settings), actor, `Rolled back to version of ${v.createdAt.slice(0, 10)}`);
}

export function addKnowledge(tenantId: string, question: string, answer: string, language: Locale, actor: string) {
  db().knowledge.push({ id: id("k"), tenantId, question, answer, language });
  audit(actor, "Knowledge item added", tenantId);
}
export function deleteKnowledge(tenantId: string, itemId: string, actor: string) {
  const d = db();
  d.knowledge = d.knowledge.filter((k) => !(k.tenantId === tenantId && k.id === itemId));
  audit(actor, "Knowledge item deleted", tenantId);
}
export function dismissUnanswered(tenantId: string, itemId: string) {
  const d = db();
  d.unanswered = d.unanswered.filter((u) => !(u.tenantId === tenantId && u.id === itemId));
}

export function setBookingStatus(tenantId: string, bookingId: string, status: BookingStatus, actor: string) {
  const b = db().bookings.find((x) => x.tenantId === tenantId && x.id === bookingId);
  if (!b) throw new Error("booking not found");
  b.status = status;
  audit(actor, `Booking ${bookingId} set to ${status}`, tenantId);
}

export function createBooking(tenantId: string, b: Omit<Booking, "id" | "tenantId">, actor: string): Booking {
  const d = db();
  const live = (x: Booking) => x.status === "confirmed" || x.status === "rescheduled";
  if (live(b as Booking) && d.bookings.some((x) => x.doctorId === b.doctorId && x.startsAt === b.startsAt && live(x))) throw new SlotTakenError();
  const booking: Booking = { ...b, id: id("b"), tenantId };
  d.bookings.push(booking);
  audit(actor, `Booking ${booking.id} created`, tenantId);
  return booking;
}

export function updateBooking(tenantId: string, bookingId: string, patch: Partial<Pick<Booking, "startsAt" | "status" | "calendarEventId" | "notes" | "patientName" | "patientPhone" | "patientCpr" | "service" | "doctorId" | "language">>, actor: string): Booking {
  const d = db();
  const b = d.bookings.find((x) => x.tenantId === tenantId && x.id === bookingId);
  if (!b) throw new Error("booking not found");
  const startsAt = patch.startsAt ?? b.startsAt;
  const doctorId = patch.doctorId ?? b.doctorId;
  if (d.bookings.some((x) => x.id !== b.id && x.doctorId === doctorId && x.startsAt === startsAt && (x.status === "confirmed" || x.status === "rescheduled"))
    && (patch.startsAt || patch.doctorId || patch.status === "confirmed")) throw new SlotTakenError();
  Object.assign(b, patch);
  audit(actor, `Booking ${bookingId} updated`, tenantId);
  return b;
}

/** Records the last attempt to send the booking's WhatsApp confirmation. It is a log of what happened, so it is not audited. */
export function setBookingMessage(tenantId: string, bookingId: string, message: BookingMessage): Booking | undefined {
  const b = db().bookings.find((x) => x.tenantId === tenantId && x.id === bookingId);
  if (b) b.message = message;
  return b;
}

export function addAlert(tenantId: string, severity: "info" | "warning" | "error", message: string) {
  db().alerts.push({ id: id("a"), tenantId, at: now().toISOString(), severity, message, resolved: false });
}

export function setDoctorCalendar(tenantId: string, doctorId: string, calendarId: string, actor: string) {
  const doc = db().doctors.find((x) => x.tenantId === tenantId && x.id === doctorId);
  if (!doc) throw new Error("doctor not found");
  doc.googleCalendarId = calendarId || undefined;
  getTenant(tenantId)!.calendarConnected = db().doctors.some((x) => x.tenantId === tenantId && x.googleCalendarId);
  audit(actor, `Calendar for ${doc.name} ${calendarId ? "linked" : "unlinked"}`, tenantId);
}

const DOCTOR_COLOURS = ["#0e7c86", "#d97706", "#be185d", "#7c3aed", "#c2410c", "#2563eb", "#15803d"];

export function addDoctor(tenantId: string, input: { name: string; specialty: string; about?: string; aboutAr?: string }, actor: string): Doctor {
  const doctors = db().doctors.filter((x) => x.tenantId === tenantId);
  const doc: Doctor = { id: id("d"), tenantId, name: input.name, specialty: input.specialty, ...(input.about ? { about: input.about } : {}), ...(input.aboutAr ? { aboutAr: input.aboutAr } : {}), color: DOCTOR_COLOURS[doctors.length % DOCTOR_COLOURS.length] };
  db().doctors.push(doc);
  audit(actor, `Doctor added: ${doc.name}`, tenantId);
  return doc;
}

export function removeDoctor(tenantId: string, doctorId: string, actor: string) {
  const i = db().doctors.findIndex((x) => x.tenantId === tenantId && x.id === doctorId);
  if (i < 0) throw new Error("doctor not found");
  const [doc] = db().doctors.splice(i, 1);
  delete (db().doctorImages ??= {})[doc.id];
  getTenant(tenantId)!.calendarConnected = db().doctors.some((x) => x.tenantId === tenantId && x.googleCalendarId);
  audit(actor, `Doctor removed: ${doc.name}`, tenantId);
}

/** The stored photo of a doctor as a data: URL, if there is one. */
export function getDoctorImage(tenantId: string, doctorId: string): string | undefined {
  return db().doctors.some((x) => x.tenantId === tenantId && x.id === doctorId) ? (db().doctorImages ??= {})[doctorId] : undefined;
}
/** Sets (a data: URL) or removes (null) a doctor's photo. */
export function setDoctorImage(tenantId: string, doctorId: string, image: string | null, actor: string): void {
  const doc = db().doctors.find((x) => x.tenantId === tenantId && x.id === doctorId);
  if (!doc) throw new Error("doctor not found");
  const images = (db().doctorImages ??= {});
  if (image) { images[doctorId] = image; doc.photoAt = now().toISOString(); } else { delete images[doctorId]; delete doc.photoAt; }
  audit(actor, `Doctor photo ${image ? "set" : "removed"}: ${doc.name}`, tenantId);
}

/** Every stored photo of a client with the size of the picture itself in bytes, for the Data screen. */
export function getPhotoUsage(tenantId: string): { kind: "item" | "doctor"; id: string; name: string; bytes: number }[] {
  const d = db();
  const out: { kind: "item" | "doctor"; id: string; name: string; bytes: number }[] = [];
  for (const i of getItems(tenantId)) { const img = (d.itemImages ??= {})[i.id]; if (img) out.push({ kind: "item", id: i.id, name: i.name, bytes: pictureBytes(img) }); }
  for (const x of d.doctors.filter((y) => y.tenantId === tenantId)) { const img = (d.doctorImages ??= {})[x.id]; if (img) out.push({ kind: "doctor", id: x.id, name: x.name, bytes: pictureBytes(img) }); }
  return out;
}

/** The whole database's size in bytes; only Postgres can tell, the demo store has none. */
export function databaseSize(): number | undefined {
  return undefined;
}

export function setPermissions(tenantId: string, p: Permissions, actor: string) {
  getTenant(tenantId)!.permissions = p;
  audit(actor, "Client permissions changed", tenantId);
}

export function updateTenant(tenantId: string, patch: Partial<Pick<Tenant, "zeroBalancePolicy" | "status" | "allowedDomains" | "lowBalanceThreshold" | "name" | "retentionDays" | "closures">> & { branding?: Partial<Tenant["branding"]> }, actor: string) {
  const t = getTenant(tenantId)!;
  const { branding, ...rest } = patch;
  if (patch.allowedDomains || patch.name) {
    const clash = findDuplicate(db().tenants.filter((x) => x.id !== tenantId), { name: patch.name, domains: patch.allowedDomains ?? [] });
    if (clash) throw new DuplicateError(clash);
  }
  Object.assign(t, rest);
  if (branding) t.branding = { ...t.branding, ...branding };
  audit(actor, "Client settings changed", tenantId);
}

export function resolveAlert(alertId: string) {
  const a = db().alerts.find((x) => x.id === alertId);
  if (a) a.resolved = true;
}

export function createTenant(p: {
  name: string; nameAr: string; color: string; domain: string; planType: "package" | "payg"; actor: string;
  /** Terms chosen from the catalogue; when absent the default package for `planType` is used. */
  plan?: PlanInput & { packageId?: string; contractRef?: string };
}) {
  const d = db();
  const clash = findDuplicate(d.tenants, { name: p.name, domains: p.domain ? [p.domain] : [] });
  if (clash) throw new DuplicateError(clash);
  const tid = id("t");
  const start = new Date(Date.UTC(now().getUTCFullYear(), now().getUTCMonth(), 1)).toISOString();
  const chosen = p.plan ?? (p.planType === "package" ? PLAN_PRESETS.clinic : PLAN_PRESETS.payg);
  const pkg = chosen.type === "package";
  const tenant: Tenant = {
    id: tid, slug: p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || tid,
    name: p.name, status: "live",
    branding: { displayName: p.name, displayNameAr: p.nameAr || p.name, primaryColor: p.color, domain: p.domain || undefined },
    plans: [{ ...chosen, contractRef: (p.plan as { contractRef?: string } | undefined)?.contractRef || undefined, id: "plan-1", active: true, periodStart: start }],
    permissions: { editPrompt: true, editVoice: true, editBehaviour: true, editKnowledge: true },
    allowedDomains: p.domain ? [p.domain] : [], zeroBalancePolicy: "pause", lowBalanceThreshold: 0.15, retentionDays: 90,
    alertRules: structuredClone(DEFAULT_RULES), calendarConnected: false, openingHours: DEFAULT_OPENING_HOURS, channels: { website: "pending", whatsapp: "off", instagram: "off", phone: "off" }, onboarding: { done: [] }, integrations: {},
    createdAt: now().toISOString(),
  };
  d.tenants.push(tenant);
  const template = d.agents.t_alnoor;
  d.agents[tid] = { ...structuredClone(template), elevenLabsAgentId: "", prompt: { ...template.prompt, identity: `You are the virtual receptionist of ${p.name}. Be warm, calm and concise.` } };
  if (pkg) {
    d.batches.push({ id: id("cb"), tenantId: tid, kind: "package", planId: "plan-1", amount: chosen.includedCredits, remaining: chosen.includedCredits, purchasedAt: start, expiresAt: addMonths(start, 1), note: chosen.name });
    d.ledger.push({ id: id("l"), tenantId: tid, at: now().toISOString(), kind: "package_renewal", credits: chosen.includedCredits, note: chosen.name });
  }
  audit(p.actor, "Created client from clinic template", tid);
  return tenant;
}

/** Permanently removes a client and everything that belongs to it. The audit trail keeps one entry without a client. */
export function deleteTenant(tenantId: string, actor: string) {
  const d = db();
  const t = getTenant(tenantId);
  if (!t) return;
  d.tenants = d.tenants.filter((x) => x.id !== tenantId);
  delete d.agents[tenantId];
  delete d.secrets[tenantId];
  for (const x of d.doctors.filter((y) => y.tenantId === tenantId)) delete (d.doctorImages ??= {})[x.id];
  const lists = d as unknown as Record<string, { tenantId?: string }[]>;
  for (const k of ["agentVersions", "doctors", "bookings", "conversations", "knowledge", "unanswered", "batches", "ledger", "alerts", "audit", "topUpRequests", "staffRequests", "customers", "profiles", "chatSessions"])
    lists[k] = lists[k].filter((x) => x.tenantId !== tenantId);
  for (const i of (d.items ??= []).filter((x) => x.tenantId === tenantId)) delete (d.itemImages ??= {})[i.id];
  d.items = d.items.filter((x) => x.tenantId !== tenantId);
  audit(actor, `Deleted client "${t.name}"`);
}

export const listPackages = () => db().packages;

/** Creates (no id) or updates a catalogue package. Names are unique. Existing clients keep the terms they signed. */
export function savePackage(input: PlanInput & { id?: string; nameAr: string; description: string }, actor: string) {
  const d = db();
  if (d.packages.some((x) => x.id !== input.id && nameKey(x.name) === nameKey(input.name))) throw new DuplicateError("name");
  const { id: pid, ...rest } = input;
  const existing = pid ? d.packages.find((x) => x.id === pid) : undefined;
  if (existing) Object.assign(existing, rest);
  const pkg = existing ?? { ...rest, id: id("pkg"), archived: false };
  if (!existing) d.packages.push(pkg);
  audit(actor, `${existing ? "Updated" : "Created"} package "${pkg.name}"`);
  return pkg;
}

export function archivePackage(packageId: string, archived: boolean, actor: string) {
  const pkg = db().packages.find((x) => x.id === packageId);
  if (!pkg) return;
  pkg.archived = archived;
  audit(actor, `${archived ? "Archived" : "Restored"} package "${pkg.name}"`);
}

export function marginFor(tenantId: string, since: Date) {
  const t = getTenant(tenantId)!;
  const convs = getConversations(tenantId).filter((c) => new Date(c.startedAt) >= since);
  const credits = round2(convs.reduce((s, c) => s + c.creditsCharged, 0));
  const costBhd = round2(convs.reduce((s, c) => s + c.costUsd, 0) * USD_TO_BHD);
  const perCredit = revenuePerCredit(t.plans);
  const revenueBhd = round2(credits * perCredit);
  return { conversations: convs.length, credits, costBhd, revenueBhd, marginBhd: round2(revenueBhd - costBhd) };
}

export function creditsOwed() {
  const n = now();
  return round2(db().batches.reduce((s, b) => (b.remaining > 0 && new Date(b.expiresAt) > n ? s + b.remaining : s), 0));
}

export function findTenantByAgent(agentId: string) {
  return db().tenants.find((t) => db().agents[t.id]?.elevenLabsAgentId === agentId);
}

/* ---------- edit and delete everywhere ---------- */

export function updateDoctor(tenantId: string, doctorId: string, patch: Partial<Pick<Doctor, "name" | "specialty" | "about" | "aboutAr" | "color" | "active" | "hours" | "timeOff">>, actor: string): Doctor {
  const doc = db().doctors.find((x) => x.tenantId === tenantId && x.id === doctorId);
  if (!doc) throw new Error("doctor not found");
  Object.assign(doc, patch);
  audit(actor, `Doctor updated: ${doc.name}`, tenantId);
  return doc;
}

export function deleteBooking(tenantId: string, bookingId: string, actor: string) {
  const d = db();
  const b = d.bookings.find((x) => x.tenantId === tenantId && x.id === bookingId);
  if (!b) throw new Error("booking not found");
  d.bookings = d.bookings.filter((x) => x !== b);
  audit(actor, `Booking deleted: ${b.patientName} ${b.startsAt}`, tenantId);
}

export function updateKnowledge(tenantId: string, itemId: string, p: { question: string; answer: string; language: Locale }, actor: string) {
  const k = db().knowledge.find((x) => x.tenantId === tenantId && x.id === itemId);
  if (!k) return;
  Object.assign(k, p);
  audit(actor, "Knowledge item edited", tenantId);
}

export function deleteStaffRequest(tenantId: string, requestId: string, actor: string) {
  const d = db();
  const before = d.staffRequests.length;
  d.staffRequests = d.staffRequests.filter((x) => !(x.tenantId === tenantId && x.id === requestId));
  if (d.staffRequests.length < before) audit(actor, "Message deleted", tenantId);
}

/** Removes the transcript and summary (a patient's deletion request). The credits it used stay in the ledger. */
export function deleteConversation(tenantId: string, conversationId: string, actor: string) {
  const d = db();
  const before = d.conversations.length;
  d.conversations = d.conversations.filter((x) => !(x.tenantId === tenantId && x.id === conversationId));
  if (d.conversations.length < before) audit(actor, "Conversation deleted", tenantId);
}

/** A manual correction: positive adds a top-up batch, negative takes credits away (oldest first). */
export function adjustCredits(tenantId: string, credits: number, note: string, actor: string) {
  const d = db();
  const t = getTenant(tenantId)!;
  if (credits > 0) d.batches = addTopUp(d.batches, { id: id("cb"), tenantId, amount: credits, now: now(), kind: topUpKind(t.plans), note });
  else {
    const mine = d.batches.filter((b) => b.tenantId === tenantId);
    const res = deduct(mine, -credits, now());
    d.batches = [...d.batches.filter((b) => b.tenantId !== tenantId), ...res.batches];
  }
  d.ledger.push({ id: id("l"), tenantId, at: now().toISOString(), kind: "adjustment", credits, note });
  audit(actor, `Credit adjustment ${credits > 0 ? "+" : ""}${credits}: ${note}`, tenantId);
}

export function declineTopUpRequest(requestId: string, actor: string) {
  const r = db().topUpRequests.find((x) => x.id === requestId && x.status === "open");
  if (!r) return;
  r.status = "done";
  audit(actor, `Declined a top-up request of ${r.credits} credits`, r.tenantId);
}

/** Only a package no client has ever been given can be deleted; otherwise archive it. */
export function deletePackage(packageId: string, actor: string): boolean {
  const d = db();
  if (d.tenants.some((t) => t.plans.some((p) => p.packageId === packageId))) return false;
  const pkg = d.packages.find((x) => x.id === packageId);
  d.packages = d.packages.filter((x) => x.id !== packageId);
  if (pkg) audit(actor, `Deleted package "${pkg.name}"`);
  return true;
}
