"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "./auth";
import * as store from "./data";
import { appUrl } from "./app-url";
import { safePath } from "./format";
import { syncAgent, SyncError } from "./agent-sync";
import { elevenLabsFromEnv } from "./elevenlabs-api";
import { sendBookingConfirmation } from "./whatsapp";
import type { Channel, Integrations } from "./types";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const page = (id: string, q: string) => `/admin/clients/${id}/channels?${q}`;
const done = (id: string) => { revalidatePath(`/admin/clients/${id}`, "layout"); revalidatePath("/admin"); };
const STATUSES = ["off", "pending", "connected"] as const;
const status = (f: FormData) => (STATUSES.find((s) => s === str(f, "status")) ?? "off");
const only = (id: string) => store.getTenant(id).then((t) => t ?? redirect("/admin"));

/** Creates the client's agent in ElevenLabs, or brings it up to date with CallsDash. */
export async function syncAgentAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  await only(id);
  const api = elevenLabsFromEnv();
  const url = await appUrl();
  let q = "saved=synced";
  try {
    if (!api) throw new SyncError("no_api_key");
    const tools = process.env.AGENT_TOOLS_SECRET;
    if (!tools) throw new SyncError("no_secret");
    if (!url.startsWith("https://")) throw new SyncError("no_app_url"); // ElevenLabs only calls https addresses
    const r = await syncAgent({ api, data: store, appUrl: url, toolsSecret: tools, initSecret: process.env.ELEVENLABS_INIT_SECRET || tools }, id, actor);
    if (r.created) q = "saved=created";
  } catch (e) {
    if (!(e instanceof SyncError)) throw e;
    q = `error=${e.code}`;
  }
  done(id);
  const back = safePath(f.get("returnTo"), "");
  redirect(back ? `${back}${back.includes("?") ? "&" : "?"}${q}` : page(id, q));
}

export async function saveWhatsappAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  const t = await only(id);
  const wa: NonNullable<Integrations["whatsapp"]> = {
    phoneNumberId: str(f, "phoneNumberId").replace(/\D/g, "").slice(0, 32) || undefined,
    displayNumber: str(f, "displayNumber").slice(0, 40) || undefined,
    confirmTemplate: str(f, "confirmTemplate").replace(/[^a-z0-9_]/gi, "").toLowerCase().slice(0, 80) || undefined,
    confirmTemplateLang: str(f, "confirmTemplateLang") === "ar" ? "ar" : "en",
  };
  await store.setIntegrations(id, { ...t.integrations, whatsapp: wa }, actor, "WhatsApp settings saved");
  await store.setChannelStatus(id, "whatsapp", status(f), actor);
  done(id);
  redirect(page(id, "saved=1"));
}

/** Sends the confirmation template to a number the admin types, to check that the template is approved and delivers. */
export async function testWhatsappAction(f: FormData) {
  await requireAdmin();
  const id = str(f, "tenantId");
  await only(id);
  const api = elevenLabsFromEnv();
  if (!api) redirect(page(id, "error=no_api_key"));
  const r = await sendBookingConfirmation({ api, data: store }, id, {
    patientName: "Test", patientPhone: str(f, "to"), doctorName: "Dr. Test", startsAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
  redirect(page(id, r.status === "sent" ? "saved=wa_test" : r.status === "skipped" ? `wa=${r.reason}` : "wa=failed"));
}

const metaHost = /(^|\.)elevenlabs\.io$/;

export async function saveInstagramAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  const t = await only(id);
  const inboundUrl = str(f, "inboundUrl");
  if (inboundUrl) {
    let ok = false;
    try { const u = new URL(inboundUrl); ok = u.protocol === "https:" && metaHost.test(u.hostname) && u.pathname.endsWith("/async_message"); } catch { /* not a URL */ }
    if (!ok) redirect(page(id, "error=badUrl"));
  }
  const ig: NonNullable<Integrations["instagram"]> = {
    accountId: str(f, "accountId").replace(/\D/g, "").slice(0, 32) || undefined,
    username: str(f, "username").replace(/^@/, "").slice(0, 60) || undefined,
    inboundUrl: inboundUrl || undefined,
  };
  await store.setIntegrations(id, { ...t.integrations, instagram: ig }, actor, "Instagram settings saved");
  // a blank secret keeps what is stored; "clear" removes it
  const secrets: Record<string, string> = {};
  for (const [field, key] of [["token", "instagramToken"], ["inboundSecret", "instagramInboundSecret"], ["replySecret", "instagramReplySecret"]] as const) {
    if (f.get(`clear_${field}`) === "on") secrets[key] = "";
    else if (str(f, field)) secrets[key] = str(f, field).slice(0, 600);
  }
  if (Object.keys(secrets).length) await store.setSecrets(id, secrets);
  await store.setChannelStatus(id, "instagram", status(f), actor);
  done(id);
  redirect(page(id, "saved=1"));
}

export async function savePhoneAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  const t = await only(id);
  const provider = (["twilio", "sip", "other"] as const).find((p) => p === str(f, "provider"));
  await store.setIntegrations(id, { ...t.integrations, phone: { number: str(f, "number").slice(0, 40) || undefined, provider } }, actor, "Phone settings saved");
  await store.setChannelStatus(id, "phone" satisfies Channel, status(f), actor);
  done(id);
  redirect(page(id, "saved=1"));
}
