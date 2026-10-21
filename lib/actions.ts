"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { demoMode, requireAdmin, requireClient } from "./auth";
import { safePath } from "./format";
import { supabaseConfigured, supabaseServer } from "./supabase";
import * as store from "./data";
import { DuplicateError } from "./errors";
import { nameKey } from "./tenant-keys";
import { googleCalendarFromEnv } from "./google-calendar";
import { checkCalendar } from "./setup-check";
import { cleanOpeningHours } from "./availability";
import { cleanCatalogInput, type PlanInput } from "./plans";
import { FLAG_KINDS, normalizeRules } from "./flags";
import { FONT_STYLES, PATTERN_STYLES, RADIUS_STYLES, SIDEBAR_STYLES, coverDataUrl, isCoverUrl, isHex, isLogoUrl, logoDataUrl } from "./theme";
import type { AgentSettings, Branding, BookingStatus, Locale, Permissions } from "./types";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string) => Number(f.get(k));
const back = (f: FormData, fallback: string, extra = "saved=1") => {
  const p = safePath(f.get("returnTo"), fallback);
  redirect(p + (p.includes("?") ? "&" : "?") + extra);
};
const cookieOpts = { path: "/", httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production" };

export async function setLocale(f: FormData) {
  const l: Locale = str(f, "locale") === "ar" ? "ar" : "en";
  (await cookies()).set("cd_locale", l, { path: "/", sameSite: "lax", maxAge: 31_536_000 });
  redirect(safePath(f.get("returnTo"), "/"));
}

export async function login(f: FormData) {
  if (!demoMode()) redirect("/login");
  const who = str(f, "who");
  const jar = await cookies();
  if (who === "admin") {
    jar.set("cd_session", "admin", cookieOpts);
    jar.delete("cd_view");
    redirect("/admin");
  }
  if (who.startsWith("client:") && await store.getTenant(who.slice(7))) {
    jar.set("cd_session", who, cookieOpts);
    redirect("/app");
  }
  redirect("/login");
}

export async function loginWithPassword(f: FormData) {
  if (!supabaseConfigured() || demoMode()) redirect("/login");
  const { error } = await (await supabaseServer()).auth.signInWithPassword({ email: str(f, "email"), password: String(f.get("password") ?? "") });
  if (error) redirect("/login?error=1");
  redirect("/");
}

export async function logout() {
  if (supabaseConfigured() && !demoMode()) await (await supabaseServer()).auth.signOut();
  const jar = await cookies();
  jar.delete("cd_session");
  jar.delete("cd_view");
  redirect("/login");
}

export async function viewAsClient(f: FormData) {
  await requireAdmin();
  const id = str(f, "tenantId");
  if (!await store.getTenant(id)) redirect("/admin");
  (await cookies()).set("cd_view", id, cookieOpts);
  redirect("/app");
}

export async function exitViewAs() {
  await requireAdmin();
  (await cookies()).delete("cd_view");
  redirect("/admin");
}

/* ---------- client actions ---------- */

export async function saveAgentAction(f: FormData) {
  const { tenant, actor } = await requireClient();
  const cur = await store.getAgent(tenant.id);
  const next: AgentSettings = structuredClone(cur);
  const changed: string[] = [];
  if (f.has("prompt.identity")) {
    if (!tenant.permissions.editPrompt) throw new Error("forbidden");
    for (const k of Object.keys(next.prompt) as (keyof AgentSettings["prompt"])[]) next.prompt[k] = str(f, `prompt.${k}`).slice(0, 2000);
    changed.push("prompt");
  }
  if (f.has("temperature")) {
    if (!tenant.permissions.editBehaviour) throw new Error("forbidden");
    next.temperature = Math.min(1, Math.max(0, num(f, "temperature")));
    const rl = str(f, "replyLength");
    if (rl === "short" || rl === "normal" || rl === "detailed") next.replyLength = rl;
    const fm = str(f, "formality");
    if (fm === "casual" || fm === "polite" || fm === "formal") next.formality = fm;
    const as = str(f, "arabicWrittenStyle");
    if (as === "gulf" || as === "msa") next.arabicWrittenStyle = as;
    changed.push("behaviour");
  }
  if (f.has("voiceEn")) {
    if (!tenant.permissions.editVoice) throw new Error("forbidden");
    next.voiceEn = str(f, "voiceEn");
    next.voiceAr = str(f, "voiceAr");
    changed.push("voice");
  }
  if (changed.length) await store.saveAgent(tenant.id, next, actor, changed.join(", "));
  revalidatePath("/app", "layout");
  back(f, "/app/agent");
}

export async function addKnowledgeAction(f: FormData) {
  const { tenant, actor } = await requireClient();
  if (!tenant.permissions.editKnowledge) throw new Error("forbidden");
  const q = str(f, "question"), a = str(f, "answer");
  if (q && a) await store.addKnowledge(tenant.id, q.slice(0, 500), a.slice(0, 2000), str(f, "language") === "ar" ? "ar" : "en", actor);
  const fromUnanswered = str(f, "unansweredId");
  if (fromUnanswered) await store.dismissUnanswered(tenant.id, fromUnanswered);
  revalidatePath("/app/knowledge");
  back(f, "/app/knowledge");
}

export async function deleteKnowledgeAction(f: FormData) {
  const { tenant, actor } = await requireClient();
  if (!tenant.permissions.editKnowledge) throw new Error("forbidden");
  await store.deleteKnowledge(tenant.id, str(f, "id"), actor);
  revalidatePath("/app/knowledge");
  back(f, "/app/knowledge", "deleted=1");
}

export async function dismissUnansweredAction(f: FormData) {
  const { tenant } = await requireClient();
  await store.dismissUnanswered(tenant.id, str(f, "id"));
  revalidatePath("/app/knowledge");
  back(f, "/app/knowledge", "deleted=1");
}

export async function setBookingStatusAction(f: FormData) {
  const { tenant, actor } = await requireClient();
  const status = str(f, "status") as BookingStatus;
  if (!["cancelled", "no_show", "confirmed"].includes(status)) throw new Error("bad status");
  await store.setBookingStatus(tenant.id, str(f, "id"), status, actor);
  revalidatePath("/app", "layout");
  back(f, "/app/bookings");
}

export async function requestTopUpAction(f: FormData) {
  const { tenant, actor } = await requireClient();
  const credits = Math.min(100_000, Math.max(1, Math.round(num(f, "credits")) || 500));
  await store.requestTopUp(tenant.id, credits, actor);
  revalidatePath("/admin");
  back(f, "/app/credits", "requested=1");
}

export async function staffRequestStatusAction(f: FormData) {
  const { tenant, actor } = await requireClient();
  await store.setStaffRequestStatus(tenant.id, str(f, "id"), str(f, "status") === "open" ? "open" : "done", actor);
  revalidatePath("/app", "layout");
  redirect("/app/messages");
}

export async function setOpeningHoursAction(f: FormData) {
  const { tenant, actor } = await requireClient();
  const raw: Record<string, [string, string][]> = {};
  for (let d = 0; d < 7; d++)
    raw[String(d)] = (["a", "b"] as const).map((r): [string, string] => [str(f, `open${d}${r}`), str(f, `close${d}${r}`)]).filter(([a, b]) => a || b);
  const hours = cleanOpeningHours(raw);
  if (!hours) redirect("/app/calendar?hours=invalid#hours");
  await store.setOpeningHours(tenant.id, hours, actor);
  revalidatePath("/app", "layout");
  redirect("/app/calendar?hours=saved#hours");
}

export async function reviewConversationAction(f: FormData) {
  const { tenant, actor } = await requireClient();
  await store.setConversationReviewed(tenant.id, str(f, "id"), str(f, "reviewed") === "1", actor);
  revalidatePath("/app", "layout");
  back(f, "/app/attention", "done=1");
}

export async function setAlertRulesAction(f: FormData) {
  const { tenant, actor } = await requireClient();
  const raw: Record<string, unknown> = {};
  for (const k of FLAG_KINDS)
    raw[k] = {
      enabled: f.get(`${k}_enabled`) === "on",
      notifyStaff: f.get(`${k}_notify`) === "on",
      keywords: str(f, `${k}_keywords`).split(/[\n,،]/).map((s) => s.trim().slice(0, 60)).filter(Boolean).slice(0, 50),
    };
  await store.setAlertRules(tenant.id, normalizeRules(raw), actor);
  revalidatePath("/app", "layout");
  redirect("/app/attention?rules=saved#rules");
}

/* ---------- admin actions ---------- */

export async function adminTopUpAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  const credits = Math.round(num(f, "credits") * 100) / 100;
  if (!await store.getTenant(id) || !(credits > 0) || credits > 1_000_000) redirect(`/admin/clients/${id}`);
  await store.topUp(id, credits, actor, str(f, "note") || "Top-up");
  revalidatePath("/admin", "layout");
  back(f, `/admin/clients/${id}`);
}

export async function adminRenewAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  const tenant = await store.getTenant(id);
  const planId = str(f, "planId");
  if (tenant?.plans.some((p) => p.active && p.type === "package" && (!planId || p.id === planId))) await store.renewTenantPackage(id, actor, planId || undefined);
  revalidatePath("/admin", "layout");
  back(f, `/admin/clients/${id}`);
}

/**
 * Terms of a catalogue package, optionally with a client-specific price from their signed contract.
 * The plan keeps a copy, so later catalogue edits never change a client's contract.
 */
async function planFromForm(f: FormData): Promise<(PlanInput & { packageId?: string; contractRef?: string }) | null> {
  const pkg = (await store.listPackages()).find((p) => p.id === str(f, "packageId") && !p.archived);
  if (!pkg) return null;
  const fee = str(f, "monthlyPriceBhd"), per = str(f, "pricePerCreditBhd");
  const terms = cleanCatalogInput({
    ...pkg, monthlyPriceBhd: fee !== "" ? Number(fee) : pkg.monthlyPriceBhd, pricePerCreditBhd: per !== "" ? Number(per) : pkg.pricePerCreditBhd,
  });
  if (!terms) return null;
  const { nameAr: _a, description: _d, ...plan } = terms; // eslint-disable-line @typescript-eslint/no-unused-vars
  return { ...plan, packageId: pkg.id, contractRef: str(f, "contractRef").slice(0, 120) || undefined };
}

export async function adminAddPlanAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  const plan = await planFromForm(f);
  if (!plan || !(await store.getTenant(id))) redirect(`/admin/clients/${id}?error=plan`);
  await store.addPlan(id, plan, actor);
  revalidatePath("/admin", "layout");
  back(f, `/admin/clients/${id}`);
}

export async function adminEndPlanAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  const ended = await store.endPlan(id, str(f, "planId"), actor);
  revalidatePath("/admin", "layout");
  if (!ended) redirect(`/admin/clients/${id}?error=lastPlan`);
  back(f, `/admin/clients/${id}`);
}

export async function adminSavePackageAction(f: FormData) {
  const { actor } = await requireAdmin();
  const pid = str(f, "id");
  const input = cleanCatalogInput({
    type: str(f, "type") === "payg" ? "payg" : "package", name: str(f, "name"), nameAr: str(f, "nameAr"), description: str(f, "description"),
    includedCredits: Number(str(f, "includedCredits")), monthlyPriceBhd: Number(str(f, "monthlyPriceBhd")),
    pricePerCreditBhd: Number(str(f, "pricePerCreditBhd")), rolloverCap: Number(str(f, "rolloverPercent") || 0) / 100,
  });
  if (!input) redirect("/admin/packages?error=invalid");
  try {
    await store.savePackage({ ...input, id: pid || undefined }, actor);
  } catch (e) {
    if (e instanceof DuplicateError) redirect("/admin/packages?error=name");
    throw e;
  }
  revalidatePath("/admin", "layout");
  redirect("/admin/packages?saved=1");
}

export async function adminArchivePackageAction(f: FormData) {
  const { actor } = await requireAdmin();
  await store.archivePackage(str(f, "id"), str(f, "archived") === "1", actor);
  revalidatePath("/admin", "layout");
  redirect("/admin/packages?saved=1");
}

export async function adminPermissionsAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  const p: Permissions = {
    editPrompt: f.get("editPrompt") === "on",
    editVoice: f.get("editVoice") === "on",
    editBehaviour: f.get("editBehaviour") === "on",
    editKnowledge: f.get("editKnowledge") === "on",
  };
  await store.setPermissions(id, p, actor);
  revalidatePath("/admin", "layout");
  back(f, `/admin/clients/${id}`);
}

const hex = /^#[0-9a-fA-F]{6}$/;
export async function adminTenantSettingsAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  const color = str(f, "primaryColor");
  const branding: Partial<import("./types").Branding> = {};
  if (str(f, "displayName")) branding.displayName = str(f, "displayName").slice(0, 120);
  if (str(f, "displayNameAr")) branding.displayNameAr = str(f, "displayNameAr").slice(0, 120);
  if (hex.test(color)) branding.primaryColor = color;
  try {
    await store.updateTenant(id, {
      zeroBalancePolicy: str(f, "zeroBalancePolicy") === "overdraft" ? "overdraft" : "pause",
      allowedDomains: str(f, "allowedDomains").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
      branding,
    }, actor);
  } catch (e) {
    if (e instanceof DuplicateError) redirect(`/admin/clients/${id}?error=${e.field}`);
    throw e;
  }
  revalidatePath("/admin", "layout");
  back(f, `/admin/clients/${id}`);
}

const text = (f: FormData, k: string, max: number) => str(f, k).slice(0, max);

/** The branding studio. Every field is optional; an empty text field clears the setting. */
export async function adminBrandingAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  const b: Partial<Branding> = {
    welcome: text(f, "welcome", 240), welcomeAr: text(f, "welcomeAr", 240),
    tagline: text(f, "tagline", 160), taglineAr: text(f, "taglineAr", 160),
    supportPhone: text(f, "supportPhone", 40), supportEmail: text(f, "supportEmail", 120), supportWhatsapp: text(f, "supportWhatsapp", 40),
    reportFooter: text(f, "reportFooter", 200),
    hidePoweredBy: f.get("hidePoweredBy") === "on",
  };
  if (str(f, "displayName")) b.displayName = text(f, "displayName", 120);
  if (str(f, "displayNameAr")) b.displayNameAr = text(f, "displayNameAr", 120);
  if (isHex(str(f, "primaryColor"))) b.primaryColor = str(f, "primaryColor");
  b.accentColor = isHex(str(f, "accentColor")) ? str(f, "accentColor") : "";
  const sidebar = str(f, "sidebar"), radius = str(f, "radius"), font = str(f, "font");
  if (SIDEBAR_STYLES.includes(sidebar as never)) b.sidebar = sidebar as Branding["sidebar"];
  if (RADIUS_STYLES.includes(radius as never)) b.radius = radius as Branding["radius"];
  if (FONT_STYLES.includes(font as never)) b.font = font as Branding["font"];
  const pattern = str(f, "pattern");
  if (PATTERN_STYLES.includes(pattern as never)) b.pattern = pattern as Branding["pattern"];

  let logoError = false;
  const file = f.get("logo");
  if (f.get("removeLogo") === "on") b.logoUrl = "";
  else if (file instanceof File && file.size > 0) {
    const url = await logoDataUrl(file);
    if (url && isLogoUrl(url)) b.logoUrl = url;
    else logoError = true;
  }
  const cover = f.get("cover");
  if (f.get("removeCover") === "on") b.coverUrl = "";
  else if (cover instanceof File && cover.size > 0) {
    const url = await coverDataUrl(cover);
    if (url && isCoverUrl(url)) b.coverUrl = url;
    else logoError = true;
  }
  await store.updateTenant(id, { branding: b }, actor);
  revalidatePath("/admin", "layout");
  revalidatePath("/app", "layout");
  redirect(`/admin/clients/${id}/branding?${logoError ? "logo=bad" : "saved=1"}`);
}

export async function adminSetCalendarAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  await store.setDoctorCalendar(id, str(f, "doctorId"), str(f, "calendarId").slice(0, 300), actor);
  revalidatePath("/admin", "layout");
  back(f, `/admin/clients/${id}`);
}

export async function adminAddDoctorAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  const name = str(f, "name").trim().slice(0, 120);
  if (name) await store.addDoctor(id, { name, specialty: str(f, "specialty").trim().slice(0, 120) }, actor);
  revalidatePath("/admin", "layout");
  redirect(`/admin/clients/${id}#doctors`);
}

export async function adminRemoveDoctorAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  await store.removeDoctor(id, str(f, "doctorId"), actor);
  revalidatePath("/admin", "layout");
  redirect(`/admin/clients/${id}#doctors`);
}

export async function adminTestCalendarAction(f: FormData) {
  await requireAdmin();
  const id = str(f, "tenantId");
  const doctorId = str(f, "doctorId");
  const calendarId = str(f, "calendarId").slice(0, 300);
  let cal = null;
  try { cal = googleCalendarFromEnv(); } catch { /* unreadable key shows as key_rejected below */ }
  const keyBroken = !cal && Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const result = keyBroken ? "key_rejected" : await checkCalendar(cal, calendarId);
  redirect(`/admin/clients/${id}?cal=${encodeURIComponent(doctorId)}:${result}#doctors`);
}

export async function adminRollbackAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  await store.rollbackAgent(id, str(f, "versionId"), actor);
  revalidatePath("/admin", "layout");
  back(f, `/admin/clients/${id}`);
}

export async function adminCreateTenantAction(f: FormData) {
  const { actor } = await requireAdmin();
  const name = str(f, "name").replace(/\s+/g, " ");
  if (!name) redirect("/admin/clients/new");
  const color = str(f, "color");
  const plan = (await planFromForm(f)) ?? undefined;
  if (!plan) redirect("/admin/clients/new?error=plan");
  let tenantId: string;
  try {
    tenantId = (await store.createTenant({
      name: name.slice(0, 120), nameAr: str(f, "nameAr").slice(0, 120), color: hex.test(color) ? color : "#0e7c86",
      domain: str(f, "domain").toLowerCase().slice(0, 200), planType: plan.type, plan, actor,
    })).id;
  } catch (e) {
    if (e instanceof DuplicateError) redirect(`/admin/clients/new?error=${e.field}`);
    throw e;
  }
  revalidatePath("/admin", "layout");
  redirect(`/admin/clients/${tenantId}/setup`);
}

/** Permanent. The admin must type the client's exact name; that is checked here, not only in the browser. */
export async function adminDeleteTenantAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  const tenant = await store.getTenant(id);
  if (!tenant) redirect("/admin");
  if (nameKey(str(f, "confirmName")) !== nameKey(tenant.name)) redirect(`/admin/clients/${id}?error=confirm`);
  await store.deleteTenant(id, actor);
  // If the admin was previewing this client, drop the preview so they land back on the admin side cleanly.
  const jar = await cookies();
  if (jar.get("cd_view")?.value === id) jar.delete("cd_view");
  revalidatePath("/admin", "layout");
  redirect("/admin?deleted=1");
}

export async function resolveAlertAction(f: FormData) {
  await requireAdmin();
  await store.resolveAlert(str(f, "id"));
  revalidatePath("/admin", "layout");
  back(f, "/admin/alerts", "saved=1");
}
