"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { demoMode, requireAdmin, requireClient } from "./auth";
import { safePath } from "./format";
import { supabaseConfigured, supabaseServer } from "./supabase";
import * as store from "./data";
import type { AgentSettings, BookingStatus, Locale, Permissions } from "./types";

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
  if ((await store.getTenant(id))?.plan.type === "package") await store.renewTenantPackage(id, actor);
  revalidatePath("/admin", "layout");
  back(f, `/admin/clients/${id}`);
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
  await store.updateTenant(id, {
    zeroBalancePolicy: str(f, "zeroBalancePolicy") === "overdraft" ? "overdraft" : "pause",
    allowedDomains: str(f, "allowedDomains").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    branding,
  }, actor);
  revalidatePath("/admin", "layout");
  back(f, `/admin/clients/${id}`);
}

export async function adminSetCalendarAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  await store.setDoctorCalendar(id, str(f, "doctorId"), str(f, "calendarId").slice(0, 300), actor);
  revalidatePath("/admin", "layout");
  back(f, `/admin/clients/${id}`);
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
  const name = str(f, "name");
  if (!name) redirect("/admin/clients/new");
  const color = str(f, "color");
  const t = await store.createTenant({
    name: name.slice(0, 120), nameAr: str(f, "nameAr").slice(0, 120), color: hex.test(color) ? color : "#0e7c86",
    domain: str(f, "domain").toLowerCase().slice(0, 200), planType: str(f, "planType") === "payg" ? "payg" : "package", actor,
  });
  revalidatePath("/admin", "layout");
  redirect(`/admin/clients/${t.id}?saved=1`);
}

export async function resolveAlertAction(f: FormData) {
  await requireAdmin();
  await store.resolveAlert(str(f, "id"));
  revalidatePath("/admin", "layout");
  back(f, "/admin/alerts", "saved=1");
}
