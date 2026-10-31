"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession, requireAdmin, requireBookingUser, requireClient } from "./auth";
import { dayKey, safePath } from "./format";
import * as store from "./data";
import { getData } from "./data";
import { cleanOpeningHours } from "./availability";
import { readHours } from "./hours-form";
import { googleCalendarFromEnv } from "./google-calendar";
import { checkCalendar } from "./setup-check";
import { bookingService } from "./booking-service";
import { deliverConfirmation } from "./booking-notify";
import { elevenLabsFromEnv } from "./elevenlabs-api";
import { ToolError } from "./booking";
import { DuplicateError } from "./errors";
import { autoSync } from "./auto-sync";
import type { Booking, DateRange } from "./types";
import { businessFromForm, businessOf, rolesOf } from "./business-types";
import { promptForWords } from "./business-words";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const confirmed = (f: FormData) => f.get("confirm") === "on";
const hex = /^#[0-9a-fA-F]{6}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const live = (b: Booking) => b.status === "confirmed" || b.status === "rescheduled";

/** Back to the page the form came from, with a result in the address and, optionally, a section to scroll to. */
function go(f: FormData, fallback: string, result: string, hash = ""): never {
  const p = safePath(f.get("returnTo"), fallback);
  redirect(`${p}${p.includes("?") ? "&" : "?"}${result}${hash}`);
}

/**
 * The clinic's manager, or an administrator (on the client page, or viewing as the client). Receptionists and doctors
 * cannot change doctors, hours or closures.
 */
async function clinicManager(f: FormData): Promise<{ tenantId: string; actor: string; fallback: string }> {
  const s = await getSession();
  if (s?.role === "admin") {
    const { actor } = await requireAdmin();
    const tenantId = str(f, "tenantId");
    if (!(await store.getTenant(tenantId))) redirect("/admin");
    return { tenantId, actor, fallback: `/admin/clients/${tenantId}/people` };
  }
  const c = await requireClient();
  if (c.staffRole !== "manager") redirect("/app");
  return { tenantId: c.tenant.id, actor: c.actor, fallback: "/app/doctors" };
}

const refreshAll = () => { revalidatePath("/admin", "layout"); revalidatePath("/app", "layout"); revalidatePath("/doctor", "layout"); };

/* ---------- doctors ---------- */

/** The role key the form chose, if it is one of the client's roles; otherwise none (the first role). */
async function roleFrom(f: FormData, tenantId: string): Promise<string | undefined> {
  const key = str(f, "role");
  return key && rolesOf(await store.getTenant(tenantId)).some((r) => r.key === key) ? key : undefined;
}

async function doctorOf(tenantId: string, doctorId: string) {
  const d = (await store.getDoctors(tenantId)).find((x) => x.id === doctorId);
  if (!d) redirect("/app");
  return d;
}

export async function addDoctorAction(f: FormData) {
  const { tenantId, actor, fallback } = await clinicManager(f);
  const name = str(f, "name").replace(/\s+/g, " ").slice(0, 120);
  if (!name) go(f, fallback, "doc=name_missing", "#doctors");
  if ((await store.getDoctors(tenantId)).some((d) => d.name.toLowerCase() === name.toLowerCase())) go(f, fallback, "doc=name_taken", "#doctors");
  await store.addDoctor(tenantId, { name, specialty: str(f, "specialty").slice(0, 120), about: str(f, "about").slice(0, 800), aboutAr: str(f, "aboutAr").slice(0, 800), role: await roleFrom(f, tenantId) }, actor);
  await autoSync(tenantId, actor);
  refreshAll();
  go(f, fallback, "doc=added", "#doctors");
}

/** Name, specialty, colour, taking bookings or not, and the Google Calendar it writes to. */
export async function saveDoctorAction(f: FormData) {
  const { tenantId, actor, fallback } = await clinicManager(f);
  const doc = await doctorOf(tenantId, str(f, "doctorId"));
  const name = str(f, "name").replace(/\s+/g, " ").slice(0, 120);
  if (!name) go(f, fallback, "doc=name_missing", `#doctor-${doc.id}`);
  if ((await store.getDoctors(tenantId)).some((d) => d.id !== doc.id && d.name.toLowerCase() === name.toLowerCase())) go(f, fallback, "doc=name_taken", `#doctor-${doc.id}`);
  const color = str(f, "color");
  await store.updateDoctor(tenantId, doc.id, {
    name, specialty: str(f, "specialty").slice(0, 120), about: str(f, "about").slice(0, 800), aboutAr: str(f, "aboutAr").slice(0, 800), color: hex.test(color) ? color : doc.color, active: f.get("active") === "on",
    ...(f.has("role") ? { role: await roleFrom(f, tenantId) } : {}),
  }, actor);
  if (f.has("calendarId")) {
    const calendarId = str(f, "calendarId").slice(0, 300);
    if (calendarId !== (doc.googleCalendarId ?? "")) await store.setDoctorCalendar(tenantId, doc.id, calendarId, actor);
  }
  await autoSync(tenantId, actor);
  refreshAll();
  go(f, fallback, "doc=saved", `#doctor-${doc.id}`);
}

/** Tries the calendar id as typed (saved or not) with the server's Google key. */
export async function testDoctorCalendarAction(f: FormData) {
  const { tenantId, fallback } = await clinicManager(f);
  const doc = await doctorOf(tenantId, str(f, "doctorId"));
  let cal = null;
  try { cal = googleCalendarFromEnv(); } catch { /* an unreadable key shows as key_rejected below */ }
  const keyBroken = !cal && Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const result = keyBroken ? "key_rejected" : await checkCalendar(cal, str(f, "calendarId").slice(0, 300));
  go(f, fallback, `cal=${encodeURIComponent(doc.id)}:${result}`, `#doctor-${doc.id}`);
}

/** Either the clinic's hours or the doctor's own weekly hours. */
export async function saveDoctorHoursAction(f: FormData) {
  const { tenantId, actor, fallback } = await clinicManager(f);
  const doc = await doctorOf(tenantId, str(f, "doctorId"));
  let hours = null;
  if (str(f, "mode") === "own") {
    hours = cleanOpeningHours(readHours(f));
    if (!hours) go(f, fallback, "doc=hours_invalid", `#doctor-${doc.id}`);
  }
  await store.updateDoctor(tenantId, doc.id, { hours }, actor);
  await autoSync(tenantId, actor);
  refreshAll();
  go(f, fallback, "doc=saved", `#doctor-${doc.id}`);
}

/** Whole days, from and to inclusive, at most a year long, not ending in the past. */
function readRange(f: FormData): DateRange | null {
  const from = str(f, "from"), to = str(f, "to") || str(f, "from");
  if (!DATE.test(from) || !DATE.test(to) || to < from) return null;
  if (Date.parse(to) - Date.parse(from) > 366 * 86_400_000) return null;
  if (to < dayKey(new Date().toISOString())) return null;
  return { from, to, note: str(f, "note").slice(0, 120) || undefined };
}

const addRange = (list: DateRange[] | undefined, r: DateRange) =>
  [...(list ?? []).filter((x) => !(x.from === r.from && x.to === r.to)), r].sort((a, b) => a.from.localeCompare(b.from)).slice(-100);
const inRange = (b: Booking, r: DateRange) => { const k = dayKey(b.startsAt); return k >= r.from && k <= r.to; };

/** Leave for one doctor. Bookings already made on those days stay; the page says how many need moving. */
export async function addTimeOffAction(f: FormData) {
  const { tenantId, actor, fallback } = await clinicManager(f);
  const doc = await doctorOf(tenantId, str(f, "doctorId"));
  const r = readRange(f);
  if (!r) go(f, fallback, "doc=dates_invalid", `#doctor-${doc.id}`);
  await store.updateDoctor(tenantId, doc.id, { timeOff: addRange(doc.timeOff, r) }, actor);
  const clash = (await store.getBookings(tenantId)).filter((b) => b.doctorId === doc.id && live(b) && inRange(b, r)).length;
  refreshAll();
  go(f, fallback, `doc=saved&clash=${clash}`, `#doctor-${doc.id}`);
}

export async function removeTimeOffAction(f: FormData) {
  const { tenantId, actor, fallback } = await clinicManager(f);
  const doc = await doctorOf(tenantId, str(f, "doctorId"));
  await store.updateDoctor(tenantId, doc.id, { timeOff: (doc.timeOff ?? []).filter((x) => !(x.from === str(f, "from") && x.to === str(f, "to"))) }, actor);
  refreshAll();
  go(f, fallback, "doc=saved", `#doctor-${doc.id}`);
}

/**
 * Permanent, so it needs the confirmation box. A doctor with upcoming bookings or their own sign-in cannot be removed:
 * move or cancel the bookings and delete the sign-in first, or mark the doctor as not taking bookings instead.
 */
export async function removeDoctorAction(f: FormData) {
  const { tenantId, actor, fallback } = await clinicManager(f);
  const doc = await doctorOf(tenantId, str(f, "doctorId"));
  if (!confirmed(f)) go(f, fallback, "doc=confirm", `#doctor-${doc.id}`);
  const now = Date.now();
  if ((await store.getBookings(tenantId)).some((b) => b.doctorId === doc.id && live(b) && Date.parse(b.startsAt) > now)) go(f, fallback, "doc=has_bookings", `#doctor-${doc.id}`);
  if ((await store.listProfiles(tenantId)).some((p) => p.role === "doctor" && p.doctorId === doc.id)) go(f, fallback, "doc=has_login", `#doctor-${doc.id}`);
  await store.removeDoctor(tenantId, doc.id, actor);
  await autoSync(tenantId, actor);
  refreshAll();
  go(f, fallback, "doc=removed", "#doctors");
}

/* ---------- clinic closures (public holidays) ---------- */

export async function addClosureAction(f: FormData) {
  const { tenantId, actor } = await clinicManager(f);
  const r = readRange(f);
  if (!r) go(f, "/app/calendar", "closure=invalid", "#closures");
  const tenant = (await store.getTenant(tenantId))!;
  await store.updateTenant(tenantId, { closures: addRange(tenant.closures, r) }, actor);
  const clash = (await store.getBookings(tenantId)).filter((b) => live(b) && inRange(b, r)).length;
  refreshAll();
  go(f, "/app/calendar", `closure=saved&clash=${clash}`, "#closures");
}

export async function removeClosureAction(f: FormData) {
  const { tenantId, actor } = await clinicManager(f);
  const tenant = (await store.getTenant(tenantId))!;
  await store.updateTenant(tenantId, { closures: (tenant.closures ?? []).filter((x) => !(x.from === str(f, "from") && x.to === str(f, "to"))) }, actor);
  refreshAll();
  go(f, "/app/calendar", "closure=saved", "#closures");
}

/* ---------- bookings ---------- */

/** Patient name, phone, CPR number and service; the clinic team can also give the booking to another doctor at the same time. */
export async function updateBookingDetailsAction(f: FormData) {
  const { tenant, actor, doctorId, base } = await requireBookingUser();
  const id = str(f, "id");
  let err: string | null = null;
  try {
    await (await bookingService()).staffUpdateDetails(tenant.id, id, {
      patientName: str(f, "patientName"), patientPhone: str(f, "patientPhone"), patientCpr: str(f, "patientCpr"), service: str(f, "service"),
      doctorId: doctorId ? undefined : str(f, "doctorId") || undefined, language: str(f, "language") || undefined,
    }, actor, doctorId, { notify: f.get("whatsapp") === "on" });
  } catch (e) { if (e instanceof ToolError) err = e.code; else throw e; }
  revalidatePath(base, "layout");
  redirect(`${base}/bookings/${id}?${err ? `err=${err}` : "saved=1"}`);
}

/**
 * Sends the patient their WhatsApp confirmation again (it failed, or the phone number or doctor was corrected). The clinic team
 * waits for the answer here, so what happened is on the booking when the page comes back.
 */
export async function resendWhatsappConfirmationAction(f: FormData) {
  const { tenant, actor, doctorId, base } = await requireBookingUser();
  const id = str(f, "id");
  const booking = (await store.getBookings(tenant.id)).find((b) => b.id === id && (!doctorId || b.doctorId === doctorId));
  if (!booking) redirect(`${base}/bookings`);
  let outcome = "not_active";
  const api = elevenLabsFromEnv();
  if (booking.status === "confirmed" || booking.status === "rescheduled") {
    if (!api) outcome = "not_configured";
    else {
      const r = await deliverConfirmation({ api, data: await getData() }, tenant.id, id, actor);
      outcome = !r ? "not_active" : r.status === "skipped" ? r.reason : r.status;
    }
  }
  revalidatePath(base, "layout");
  redirect(`${base}/bookings/${id}?wa=${outcome}`);
}

/** Managers only. Receptionists and doctors cancel instead, which keeps the record. */
export async function deleteBookingAction(f: FormData) {
  const { tenant, actor, staffRole } = await requireClient();
  const id = str(f, "id");
  if (staffRole !== "manager") redirect(`/app/bookings/${id}`);
  if (!confirmed(f)) redirect(`/app/bookings/${id}?err=confirm`);
  try { await (await bookingService()).staffDeleteBooking(tenant.id, id, actor); }
  catch (e) { if (!(e instanceof ToolError)) throw e; }
  revalidatePath("/app", "layout");
  revalidatePath("/doctor", "layout");
  redirect("/app/bookings?deleted=1");
}

/* ---------- knowledge, messages, conversations ---------- */

export async function updateKnowledgeAction(f: FormData) {
  const { tenant, actor } = await requireClient();
  if (!tenant.permissions.editKnowledge) redirect("/app/knowledge");
  const question = str(f, "question").slice(0, 500), answer = str(f, "answer").slice(0, 2000);
  if (question && answer) {
    await store.updateKnowledge(tenant.id, str(f, "id"), { question, answer, language: str(f, "language") === "ar" ? "ar" : "en" }, actor);
    await autoSync(tenant.id, actor);
  }
  revalidatePath("/app/knowledge");
  go(f, "/app/knowledge", "saved=1");
}

export async function deleteStaffRequestAction(f: FormData) {
  const { tenant, actor, staffRole } = await requireClient();
  if (staffRole === "manager") await store.deleteStaffRequest(tenant.id, str(f, "id"), actor);
  revalidatePath("/app", "layout");
  redirect("/app/messages?deleted=1");
}

/** A patient's request to erase what was said. The credits it used stay on the bill. */
export async function deleteConversationAction(f: FormData) {
  const { tenant, actor, staffRole } = await requireClient();
  const id = str(f, "id");
  if (staffRole !== "manager") redirect(`/app/conversations/${id}`);
  if (!confirmed(f)) redirect(`/app/conversations/${id}?err=confirm`);
  await store.deleteConversation(tenant.id, id, actor);
  revalidatePath("/app", "layout");
  redirect("/app/conversations?deleted=1");
}

/* ---------- admin: clients, credits, packages ---------- */

const RETENTION = [30, 60, 90, 180, 365];

/** Legal name, status (suspend pauses the AI on every channel), recording retention and the low-balance warning level. */
export async function adminClientProfileAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  const tenant = await store.getTenant(id);
  if (!tenant) redirect("/admin");
  const name = str(f, "name").replace(/\s+/g, " ").slice(0, 120);
  if (!name) go(f, `/admin/clients/${id}/business`, "error=name", "#profile");
  const retention = Number(str(f, "retentionDays"));
  const low = Number(str(f, "lowBalancePercent"));
  const status = str(f, "status");
  try {
    await store.updateTenant(id, {
      name,
      status: status === "suspended" ? "suspended" : tenant.status === "suspended" ? "live" : tenant.status,
      retentionDays: RETENTION.includes(retention) ? retention : tenant.retentionDays,
      lowBalanceThreshold: Number.isFinite(low) && low >= 0 && low <= 90 ? Math.round(low) / 100 : tenant.lowBalanceThreshold,
    }, actor);
  } catch (e) {
    if (e instanceof DuplicateError) go(f, `/admin/clients/${id}/business`, `error=${e.field}`, "#profile");
    throw e;
  }
  await autoSync(id, actor);
  refreshAll();
  go(f, `/admin/clients/${id}/business`, "saved=1", "#profile");
}

/** Business type and its words (lib/business-types.ts). Only the words on screen follow it; no stored data changes. */
export async function adminBusinessAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  const tenant = await store.getTenant(id);
  if (!tenant) redirect("/admin");
  const business = businessFromForm((k) => str(f, k), (k) => f.has(k));
  const before = businessOf(tenant);
  if (str(f, "idKind") === "custom" && !str(f, "idEn")) go(f, `/admin/clients/${id}/business`, "err=id_name", "#business");
  // a form without the ID box (none today) keeps the rule the client has
  if (!f.has("idShown") && before.id) business.id = before.id;
  // a role still given to someone cannot be removed: they would silently become another role
  if (business.roles) {
    const kept = new Set(business.roles.map((r) => r.key));
    const firstBefore = rolesOf(tenant)[0].key;
    const team = await store.getDoctors(id);
    const orphan = team.find((d) => !kept.has(d.role ?? firstBefore));
    if (orphan) go(f, `/admin/clients/${id}/business`, `err=role_in_use&who=${encodeURIComponent(orphan.name.slice(0, 60))}`, "#business");
    // people saved before they had a role keep the role that was first until now, even if the order changes
    for (const d of team.filter((x) => !x.role)) await store.updateDoctor(id, d.id, { role: firstBefore }, actor);
  }
  const settings = await store.getAgent(id);
  const prompt = promptForWords(settings, tenant, business);
  await store.setBusiness(id, business, actor, `Business type ${before.type} -> ${business.type}${business.staffScheduling ? "" : " (no staff scheduling)"}`);
  if (prompt) await store.saveAgent(id, { ...settings, prompt }, actor, "The assistant's untouched sections follow the business words");
  await autoSync(id, actor); // the assistant's instructions use the client's words and roles
  refreshAll();
  go(f, `/admin/clients/${id}/business`, "saved=business", "#business");
}

/** A correction with a reason: plus adds credits, minus takes them away (never below zero). Both show in the history. */
export async function adminAdjustCreditsAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  if (!(await store.getTenant(id))) redirect("/admin");
  const credits = Math.round(Number(str(f, "credits")) * 100) / 100;
  const note = str(f, "note").slice(0, 120);
  if (!Number.isFinite(credits) || credits === 0 || Math.abs(credits) > 1_000_000 || !note) go(f, `/admin/clients/${id}/billing`, "error=adjust", "#wallet");
  if (credits < 0 && -credits > (await store.getWallet(id)).balance) go(f, `/admin/clients/${id}/billing`, "error=adjustTooMuch", "#wallet");
  await store.adjustCredits(id, credits, note, actor);
  refreshAll();
  go(f, `/admin/clients/${id}/billing`, "saved=1", "#wallet");
}

export async function adminDeclineTopUpAction(f: FormData) {
  const { actor } = await requireAdmin();
  await store.declineTopUpRequest(str(f, "requestId"), actor);
  refreshAll();
  go(f, "/admin", "saved=1", "#wallet");
}

/** Only a package no client was ever given; one in use can only be archived. */
export async function adminDeletePackageAction(f: FormData) {
  const { actor } = await requireAdmin();
  if (!confirmed(f)) redirect("/admin/billing/packages?error=confirm");
  const ok = await store.deletePackage(str(f, "id"), actor);
  revalidatePath("/admin", "layout");
  redirect(ok ? "/admin/billing/packages?deleted=1" : "/admin/billing/packages?error=inUse");
}
