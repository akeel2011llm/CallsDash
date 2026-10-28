"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "./auth";
import * as store from "./data";
import { appUrl } from "./app-url";
import { safePath } from "./format";
import { syncAgent, SyncError } from "./agent-sync";
import { elevenLabsFromEnv } from "./elevenlabs-api";
import { catalogFromEnv } from "./elevenlabs-catalog";
import { switchAgent, SwitchError } from "./agent-switch";
import { TEMPLATES, mainLanguage, sendBookingConfirmation, testFailKey, wordingOf, type Wording } from "./whatsapp";
import { bookingRef } from "./booking-ref";
import { badHeaderSetting } from "./header-safe";
import { sendItemPhoto } from "./whatsapp-photo";
import type { Channel, Integrations, Locale } from "./types";

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
    if (badHeaderSetting()) throw new SyncError("bad_secret", badHeaderSetting());
    if (!url.startsWith("https://")) throw new SyncError("no_app_url"); // ElevenLabs only calls https addresses
    const r = await syncAgent({ api, data: store, appUrl: url, toolsSecret: tools, initSecret: process.env.ELEVENLABS_INIT_SECRET || tools }, id, actor, { takeOver: f.get("takeOver") === "on" });
    if (r.created) q = "saved=created";
  } catch (e) {
    if (!(e instanceof SyncError)) throw e;
    q = `error=${e.code}`;
  }
  done(id);
  const back = safePath(f.get("returnTo"), "");
  redirect(back ? `${back}${back.includes("?") ? "&" : "?"}${q}` : page(id, q));
}

/** Points the client at another ElevenLabs agent the admin already has (or back at one used before). Changes nothing inside ElevenLabs. */
export async function useAgentAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  await only(id);
  let q = "saved=agent_switched";
  try {
    await switchAgent({ catalog: catalogFromEnv(), data: store }, id, str(f, "agentId"), actor);
  } catch (e) {
    if (!(e instanceof SwitchError)) throw e;
    q = `error=agent_${e.code}`;
  }
  done(id);
  redirect(page(id, q));
}

const httpsUrl = (s: string) => { try { return new URL(s).protocol === "https:"; } catch { return false; } };

export async function saveWhatsappAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  const t = await only(id);
  const wording: Wording = str(f, "wording") === "short" ? "short" : "full";
  const confirmTemplate = str(f, "confirmTemplate").replace(/[^a-z0-9_]/gi, "").toLowerCase().slice(0, 80) || undefined;
  const mapUrl = str(f, "mapUrl").slice(0, 300);
  if (mapUrl && !httpsUrl(mapUrl)) redirect(page(id, "error=badMapUrl"));
  // the short template has four variables: sending the full set to it would be refused (Meta error 132000)
  if (wording === "full" && confirmTemplate === TEMPLATES.short.name) redirect(page(id, "error=sameTemplate"));
  const main: Locale = str(f, "confirmTemplateLang") === "ar" ? "ar" : "en";
  const wa: NonNullable<Integrations["whatsapp"]> = {
    phoneNumberId: str(f, "phoneNumberId").replace(/\D/g, "").slice(0, 32) || undefined,
    displayNumber: str(f, "displayNumber").slice(0, 40) || undefined,
    confirmTemplate,
    confirmTemplateLang: main,
    confirmWording: wording,
    templateLangs: (["en", "ar"] as const).filter((l) => l === main || f.get(`lang_${l}`) === "on"),
    ...(f.get("confirmations") === "on" ? {} : { confirmations: false }),
    address: str(f, "address").slice(0, 250) || undefined,
    addressAr: str(f, "addressAr").slice(0, 250) || undefined,
    mapUrl: mapUrl || undefined,
    phone: str(f, "phone").slice(0, 40) || undefined,
  };
  await store.setIntegrations(id, { ...t.integrations, whatsapp: wa }, actor, "WhatsApp settings saved");
  await store.setChannelStatus(id, "whatsapp", status(f), actor);
  done(id);
  redirect(page(id, "saved=1"));
}

/**
 * Sends the confirmation to a number the admin types, as a patient would get it (the clinic's real name, address and phone, a
 * sample patient and booking), to check that the template is approved and arrives. The reason for a failure is kept on the
 * server for the page to show.
 */
export async function testWhatsappAction(f: FormData) {
  await requireAdmin();
  const id = str(f, "tenantId");
  const t = await only(id);
  const api = elevenLabsFromEnv();
  if (!api) redirect(page(id, "error=no_api_key"));
  const language: Locale = str(f, "language") === "ar" ? "ar" : str(f, "language") === "en" ? "en" : mainLanguage(t.integrations.whatsapp);
  const sample = TEMPLATES[wordingOf(t.integrations.whatsapp)].samples[language];
  const r = await sendBookingConfirmation({ api, data: store }, id, {
    patientName: sample.name, patientPhone: str(f, "to"), doctorName: sample.doctor, startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    service: sample.service, reference: bookingRef("test0000"), language,
  });
  if (r.status === "failed") await store.setSetting(testFailKey(id), { detail: r.error, at: new Date().toISOString() });
  redirect(page(id, r.status === "sent" ? "saved=wa_test" : r.status === "skipped" ? `wa=${r.reason}` : "wa=failed"));
}

/** Saves, replaces or removes the access token that lets the assistant send catalogue photos in a WhatsApp chat. A blank box keeps the saved one. */
export async function saveWhatsappPhotoAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  await only(id);
  const token = str(f, "token").slice(0, 600);
  if (f.get("clear_token") === "on") await store.setSecrets(id, { whatsappToken: "" });
  else if (token) {
    if (/\s/.test(token) || token.length < 20) redirect(page(id, "wa=photo_bad_token"));
    await store.setSecrets(id, { whatsappToken: token });
  }
  await store.audit(actor, "WhatsApp photo token saved", id);
  done(id);
  redirect(page(id, "saved=wa_photo_token"));
}

/** Sends one catalogue photo to a number the admin types, the way the assistant would, to check the token. */
export async function testWhatsappPhotoAction(f: FormData) {
  await requireAdmin();
  const id = str(f, "tenantId");
  const t = await only(id);
  const itemId = str(f, "itemId");
  if (!itemId) redirect(page(id, "wa=photo_no_item"));
  const r = await sendItemPhoto(store, id, { itemId, to: str(f, "to"), language: mainLanguage(t.integrations.whatsapp) }, await appUrl());
  if (r.status === "failed") await store.setSetting(`wa.photo.fail.${id}`, { detail: r.error, at: new Date().toISOString() });
  redirect(page(id, r.status === "sent" ? "saved=wa_photo_test" : r.status === "skipped" ? `wa=photo_${r.reason}` : "wa=photo_failed"));
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
