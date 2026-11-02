"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "./auth";
import * as store from "./data";
import { ElevenLabsError, plainDetail } from "./elevenlabs-api";
import { cleanPhone, connectFromForm, phoneFailKey, phoneFromEnv } from "./phone";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const page = (id: string, q: string, hash = "") => `/admin/clients/${id}/channels/phone?${q}&at=${Date.now().toString(36)}${hash}`;
const isRedirect = (e: unknown) => !!e && typeof e === "object" && "digest" in e;
const refresh = (id: string) => { revalidatePath(`/admin/clients/${id}`, "layout"); revalidatePath("/admin"); };

async function setup(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  const tenant = await store.getTenant(id);
  if (!tenant) redirect("/admin");
  const api = phoneFromEnv();
  if (!api) redirect(page(id, "err=no_key"));
  const agentId = (await store.getAgent(id)).elevenLabsAgentId;
  return { id, actor, tenant, api, agentId };
}

async function failed(id: string, e: unknown, hash = ""): Promise<never> {
  await store.setSetting(phoneFailKey(id), { detail: plainDetail(e instanceof Error ? e.message : "refused").slice(0, 400), at: new Date().toISOString() }).catch(() => undefined);
  redirect(page(id, "err=refused", hash));
}

/** Connects the Twilio number to ElevenLabs. The SID and token go straight to ElevenLabs and are not kept. */
export async function connectPhoneAction(f: FormData) {
  const { id, actor, tenant, api, agentId } = await setup(f);
  if (!agentId) redirect(page(id, "err=no_agent", "#connect"));
  const old = tenant.integrations.phone?.elevenLabsId;
  if (old) {
    // a number that was deleted in ElevenLabs may be connected again
    const still = await api.read(old).catch((e) => (e instanceof ElevenLabsError && e.status === 404 ? null : "unknown" as const));
    if (still) redirect(page(id, "err=already", "#connect"));
  }
  const parsed = connectFromForm((k) => String(f.get(k) ?? ""));
  if (!parsed.ok) redirect(page(id, `err=${parsed.error}`, "#connect"));
  try {
    const lineId = await api.connect(parsed.value, agentId);
    const fresh = (await store.getTenant(id)) ?? tenant;
    await store.setIntegrations(id, { ...fresh.integrations, phone: { ...fresh.integrations.phone, number: parsed.value.number, provider: "twilio", elevenLabsId: lineId } }, actor, "Connected the phone line");
    await store.setChannelStatus(id, "phone", "connected", actor);
  } catch (e) {
    if (isRedirect(e)) throw e;
    await failed(id, e, "#connect");
  }
  refresh(id);
  redirect(page(id, "done=connected"));
}

/** Points the number at this client's assistant (after the assistant was replaced or the number was set up by hand). */
export async function assignPhoneAction(f: FormData) {
  const { id, actor, tenant, api, agentId } = await setup(f);
  const lineId = tenant.integrations.phone?.elevenLabsId;
  if (!lineId) redirect(page(id, "err=no_line"));
  if (!agentId) redirect(page(id, "err=no_agent"));
  try { await api.assign(lineId, agentId); } catch (e) { if (isRedirect(e)) throw e; await failed(id, e); }
  await store.audit(actor, "Pointed the phone line at the assistant", id).catch(() => undefined);
  revalidatePath(`/admin/clients/${id}/channels/phone`);
  redirect(page(id, "done=assigned"));
}

/** The assistant phones a number the admin types, to hear how it sounds on a real call. */
export async function testCallAction(f: FormData) {
  const { id, actor, tenant, api, agentId } = await setup(f);
  const lineId = tenant.integrations.phone?.elevenLabsId;
  if (!lineId) redirect(page(id, "err=no_line", "#test"));
  if (!agentId) redirect(page(id, "err=no_agent", "#test"));
  const to = cleanPhone(str(f, "to"));
  if (!to) redirect(page(id, "err=to", "#test"));
  if (f.get("agree") !== "on") redirect(page(id, "err=agree", "#test"));
  let started = false;
  try {
    const r = await api.call(agentId, lineId, to);
    if (!r.ok) throw new Error(r.message || "The call did not start");
    started = true;
  } catch (e) {
    if (isRedirect(e)) throw e;
    await failed(id, e, "#test");
  }
  if (started) await store.audit(actor, `Placed a test call to ${to.slice(0, 5)}…${to.slice(-2)}`, id).catch(() => undefined);
  redirect(page(id, "done=called", "#test"));
}

/** Takes the number out of ElevenLabs (tick box). The number stays in the Twilio account. */
export async function disconnectPhoneAction(f: FormData) {
  const { id, actor, tenant, api } = await setup(f);
  if (f.get("confirm") !== "on") redirect(page(id, "err=confirm", "#disconnect"));
  const lineId = tenant.integrations.phone?.elevenLabsId;
  if (!lineId) redirect(page(id, "err=no_line"));
  try { await api.remove(lineId); } catch (e) { if (isRedirect(e)) throw e; await failed(id, e, "#disconnect"); }
  const fresh = (await store.getTenant(id)) ?? tenant;
  await store.setIntegrations(id, { ...fresh.integrations, phone: { ...fresh.integrations.phone, elevenLabsId: undefined } }, actor, "Disconnected the phone line");
  await store.setChannelStatus(id, "phone", "off", actor);
  refresh(id);
  redirect(page(id, "done=disconnected"));
}
