"use server";

import { safePath } from "./format";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "./auth";
import * as store from "./data";
import { DuplicateError } from "./errors";
import { setupChecklist } from "./checklist";
import { scanSite, ScanError } from "./site-scan";
import { wizardFor } from "./setup-facts";
import { missingForLive } from "./wizard";
import type { Branding } from "./types";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const setupUrl = (id: string, extra = "") => `/admin/clients/${id}/setup${extra ? `?${extra}` : ""}`;
const refresh = (id: string) => { revalidatePath(`/admin/clients/${id}`, "layout"); revalidatePath("/app", "layout"); };

/** Step 1: the business contact details the agent and the portal show. */
export async function setupDetailsAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  const t = await store.getTenant(id);
  if (!t) redirect("/admin");
  const domain = str(f, "domain").toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").slice(0, 200);
  const branding: Partial<Branding> = {
    domain, supportPhone: str(f, "supportPhone").slice(0, 40), supportEmail: str(f, "supportEmail").slice(0, 120), supportWhatsapp: str(f, "supportWhatsapp").slice(0, 40),
  };
  const oldDomain = t.branding.domain;
  // the widget may load on the client's own website
  const allowed = [...new Set([...t.allowedDomains.filter((d) => d !== oldDomain), ...(domain ? [domain] : [])])];
  // back to where the form was (Business tab or the setup wizard), with the answer added
  const to = (extra: string) => { const p = safePath(f.get("returnTo"), setupUrl(id)); return `${p}${p.includes("?") ? "&" : "?"}${extra}#contact`; };
  try { await store.updateTenant(id, { branding, allowedDomains: allowed }, actor); }
  catch (e) { if (e instanceof DuplicateError) redirect(to(`error=${e.field}`)); throw e; }
  refresh(id);
  redirect(to("saved=details"));
}

/** Step 2: read the client's website. Nothing is applied until the admin accepts it. */
export async function scanWebsiteAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  const t = await store.getTenant(id);
  if (!t) redirect("/admin");
  const url = str(f, "url") || t.branding.domain || "";
  try {
    const scan = await scanSite(url);
    await store.setOnboarding(id, { ...t.onboarding, scan }, actor, `Scanned website ${scan.url}`);
  } catch (e) {
    if (e instanceof ScanError) redirect(setupUrl(id, `step=business&scan=${e.code}#website`));
    throw e;
  }
  refresh(id);
  redirect(setupUrl(id, "step=business&saved=scan#website"));
}

const chunks = (text: string, size = 900): string[] => {
  const out: string[] = [];
  let cur = "";
  for (const s of text.split(/(?<=[.!?؟])\s+/)) {
    if (cur && cur.length + s.length > size) { out.push(cur.trim()); cur = ""; }
    cur += `${s} `;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.slice(0, 6);
};

/** Turns the accepted parts of the last scan into knowledge items and contact details. */
export async function applyScanAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  const t = await store.getTenant(id);
  const scan = t?.onboarding.scan;
  if (!t || !scan) redirect(setupUrl(id));
  if (f.get("text") === "on" && scan.text) {
    const lang = scan.languages.includes("ar") && !scan.languages.includes("en") ? "ar" : "en";
    const title = (scan.title || t.name).slice(0, 80);
    const parts = chunks(scan.text);
    for (const [i, part] of parts.entries())
      await store.addKnowledge(id, `${title}: website information${parts.length > 1 ? ` (${i + 1}/${parts.length})` : ""}`, part, lang, actor);
  }
  if (f.get("description") === "on" && scan.description)
    await store.addKnowledge(id, `What is ${scan.title || t.name}?`, scan.description.slice(0, 2000), scan.languages.includes("ar") && !scan.languages.includes("en") ? "ar" : "en", actor);
  const patch: Partial<Branding> = {};
  if (f.get("phone") === "on" && scan.phones[0] && !t.branding.supportPhone) patch.supportPhone = scan.phones[0];
  if (f.get("email") === "on" && scan.emails[0] && !t.branding.supportEmail) patch.supportEmail = scan.emails[0];
  if (Object.keys(patch).length) await store.updateTenant(id, { branding: patch }, actor);
  refresh(id);
  revalidatePath("/app/knowledge");
  redirect(setupUrl(id, "step=business&saved=applied#website"));
}

/** Ticks or unticks a checklist item that cannot be worked out from data (only those; ticking anything else does nothing). */
export async function toggleChecklistAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId"), item = str(f, "item");
  const t = await store.getTenant(id);
  if (!t) redirect("/admin");
  const manual = setupChecklist(t, { knowledgeCount: 0, doctorCount: 0, userCount: 0, conversationCount: 0, agentId: "", balance: 0 }).find((i) => i.id === item && i.manual);
  if (manual) {
    const done = new Set(t.onboarding.done);
    if (done.has(item)) done.delete(item); else done.add(item);
    await store.setOnboarding(id, { ...t.onboarding, done: [...done] }, actor, `Setup item "${item}" ${done.has(item) ? "confirmed" : "reopened"}`);
  }
  refresh(id);
  const back = safePath(f.get("returnTo"), setupUrl(id));
  redirect(back);
}

/**
 * The wizard's last button. Checks every required step again on the server (the page may be old) and records the day the
 * client went live; if a step is still open it goes back to that step and names it.
 */
export async function goLiveAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  const t = await store.getTenant(id);
  if (!t) redirect("/admin");
  const missing = missingForLive((await wizardFor(t)).phases);
  if (missing.length) redirect(setupUrl(id, `step=${missing[0].phase}&missing=${missing.map((m) => m.item).join(",")}`));
  if (!t.onboarding.liveAt) await store.setOnboarding(id, { ...t.onboarding, liveAt: new Date().toISOString() }, actor, "Went live (setup finished)");
  refresh(id);
  revalidatePath("/admin");
  redirect(setupUrl(id, "step=channels&saved=live"));
}

/** Takes the "live" mark off again (for example to redo the setup). Changes nothing else: channels keep working. */
export async function undoLiveAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  const t = await store.getTenant(id);
  if (!t) redirect("/admin");
  if (t.onboarding.liveAt) {
    const { liveAt: _, ...rest } = t.onboarding;
    await store.setOnboarding(id, rest, actor, "Setup reopened (live mark removed)");
  }
  refresh(id);
  revalidatePath("/admin");
  redirect(setupUrl(id, "step=channels&saved=reopened"));
}
