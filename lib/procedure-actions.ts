"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "./auth";
import * as store from "./data";
import { plainDetail } from "./elevenlabs-api";
import { procedureFailKey, procedureFromForm, proceduresFromEnv } from "./procedures";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const page = (id: string, q: string, hash = "") => `/admin/clients/${id}/assistant/procedures?${q}&at=${Date.now().toString(36)}${hash}`;

/** The client, its agent and the ElevenLabs access a procedure change needs, or a redirect saying what is missing. */
async function setup(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  const tenant = await store.getTenant(id);
  if (!tenant) redirect("/admin");
  const agentId = (await store.getAgent(id)).elevenLabsAgentId;
  const api = proceduresFromEnv();
  if (!api) redirect(page(id, "err=no_key"));
  if (!agentId) redirect(page(id, "err=no_agent"));
  return { id, actor, agentId, api };
}

/** ElevenLabs' reason is kept on the server for ten minutes, and the page shows it; the address only says there is one. */
async function failed(id: string, e: unknown, hash = ""): Promise<never> {
  await store.setSetting(procedureFailKey(id), { detail: plainDetail(e instanceof Error ? e.message : "refused").slice(0, 400), at: new Date().toISOString() }).catch(() => undefined);
  redirect(page(id, "err=refused", hash));
}

/** Adds a procedure, or saves the changes to one (`procedureId`), and publishes it. */
export async function saveProcedureAction(f: FormData) {
  const { id, actor, agentId, api } = await setup(f);
  const pid = str(f, "procedureId");
  const hash = pid ? `#p-${pid}` : "#new";
  const parsed = procedureFromForm((k) => String(f.get(k) ?? ""));
  if (!parsed.ok) redirect(page(id, `err=${parsed.error}${pid ? `&p=${encodeURIComponent(pid)}` : ""}`, hash));
  try {
    const branch = await api.mainBranch(agentId);
    if (pid) await api.update(agentId, branch, pid, parsed.value);
    else await api.create(agentId, branch, parsed.value);
    await api.publish(agentId, `CallsDash: ${pid ? "edited" : "added"} procedure "${parsed.value.name}"`);
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e; // a redirect
    await failed(id, e, hash);
  }
  await store.audit(actor, `${pid ? "Edited" : "Added"} the assistant procedure "${parsed.value.name}"`, id).catch(() => undefined);
  revalidatePath(`/admin/clients/${id}/assistant/procedures`);
  redirect(page(id, pid ? "done=saved" : "done=added", hash));
}

/** Deletes a procedure in ElevenLabs (with a tick box) and publishes the agent without it. */
export async function deleteProcedureAction(f: FormData) {
  const { id, actor, agentId, api } = await setup(f);
  const pid = str(f, "procedureId");
  const name = str(f, "name").slice(0, 80);
  if (f.get("confirm") !== "on") redirect(page(id, "err=confirm", `#p-${pid}`));
  try {
    const branch = await api.mainBranch(agentId);
    await api.remove(agentId, branch, pid);
    await api.publish(agentId, `CallsDash: deleted procedure "${name}"`);
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e;
    await failed(id, e);
  }
  await store.audit(actor, `Deleted the assistant procedure "${name}"`, id).catch(() => undefined);
  revalidatePath(`/admin/clients/${id}/assistant/procedures`);
  redirect(page(id, "done=deleted"));
}
