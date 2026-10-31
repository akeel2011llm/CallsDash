"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "./auth";
import * as store from "./data";
import { plainDetail } from "./elevenlabs-api";
import { STEP_LIMITS, buildWorkflow, newStepId, stepFromForm, workflowFailKey, workflowFromEnv, type LiveWorkflow, type Step } from "./workflow";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const page = (id: string, q: string, hash = "") => `/admin/clients/${id}/assistant/workflow?${q}&at=${Date.now().toString(36)}${hash}`;
const isRedirect = (e: unknown) => !!e && typeof e === "object" && "digest" in e;

async function setup(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  if (!(await store.getTenant(id))) redirect("/admin");
  const api = workflowFromEnv();
  if (!api) redirect(page(id, "err=no_key"));
  const agentId = (await store.getAgent(id)).elevenLabsAgentId;
  if (!agentId) redirect(page(id, "err=no_agent"));
  return { id, actor, api, agentId };
}

async function failed(id: string, e: unknown, hash = ""): Promise<never> {
  await store.setSetting(workflowFailKey(id), { detail: plainDetail(e instanceof Error ? e.message : "refused").slice(0, 400), at: new Date().toISOString() }).catch(() => undefined);
  redirect(page(id, "err=refused", hash));
}

/** Reads the live workflow, applies `change` to its steps, and writes it back. Refuses a hand-made workflow. */
async function change(f: FormData, fn: (steps: Step[], live: LiveWorkflow) => Step[] | string, done: string, note: string, hash = "") {
  const { id, actor, api, agentId } = await setup(f);
  let next: Step[] | string = [];
  try {
    const live = await api.read(agentId);
    if (live.kind === "custom") redirect(page(id, "err=custom"));
    next = fn(live.kind === "simple" ? live.steps : [], live);
    if (typeof next === "string") redirect(page(id, `err=${next}`, hash));
    await api.write(agentId, buildWorkflow(next, live.kind === "simple" ? live.mainLabel : undefined));
  } catch (e) {
    if (isRedirect(e)) throw e;
    await failed(id, e, hash);
  }
  await store.audit(actor, note, id).catch(() => undefined);
  revalidatePath(`/admin/clients/${id}/assistant/workflow`);
  redirect(page(id, `done=${done}`, hash));
}

/** Adds a step, or saves the changes to one (`stepId`). */
export async function saveStepAction(f: FormData) {
  await requireAdmin();
  const agentId = (await store.getAgent(str(f, "tenantId")).catch(() => ({ elevenLabsAgentId: "" }))).elevenLabsAgentId;
  const sid = str(f, "stepId");
  const parsed = stepFromForm((k) => String(f.get(k) ?? ""), agentId);
  const hash = sid ? `#s-${sid}` : "#new";
  if (!parsed.ok) {
    redirect(page(str(f, "tenantId"), `err=${parsed.error}${sid ? "" : `&kind=${encodeURIComponent(str(f, "kind"))}`}`, hash));
  }
  const step = parsed.value;
  await change(f, (steps) => {
    if (sid) {
      if (!steps.some((s) => s.id === sid)) return "gone";
      return steps.map((s) => (s.id === sid ? { ...step, id: sid } : s));
    }
    if (steps.length >= STEP_LIMITS.count) return "full";
    return [...steps, { ...step, id: newStepId(steps.map((s) => s.id)) }];
  }, sid ? "saved" : "added", `${sid ? "Edited" : "Added"} the workflow step "${step.label}"`, hash);
}

/** Deletes a step (tick box). Deleting the last one removes the workflow. */
export async function deleteStepAction(f: FormData) {
  const sid = str(f, "stepId");
  if (f.get("confirm") !== "on") { await requireAdmin(); redirect(page(str(f, "tenantId"), "err=confirm", `#s-${sid}`)); }
  await change(f, (steps) => (steps.some((s) => s.id === sid) ? steps.filter((s) => s.id !== sid) : "gone"), "deleted", `Deleted the workflow step "${str(f, "label").slice(0, 60)}"`);
}

/** Moves a step one place up or down (the order the main assistant considers them in). */
export async function moveStepAction(f: FormData) {
  const sid = str(f, "stepId");
  const up = str(f, "dir") === "up";
  await change(f, (steps) => {
    const i = steps.findIndex((s) => s.id === sid);
    if (i < 0) return "gone";
    const j = up ? i - 1 : i + 1;
    if (j < 0 || j >= steps.length) return steps;
    const out = [...steps];
    [out[i], out[j]] = [out[j], out[i]];
    return out;
  }, "moved", "Reordered the workflow steps", `#s-${sid}`);
}

/** Removes the whole workflow, whatever its shape (tick box): the assistant handles the whole call again. */
export async function removeWorkflowAction(f: FormData) {
  const { id, actor, api, agentId } = await setup(f);
  if (f.get("confirm") !== "on") redirect(page(id, "err=confirm", "#remove"));
  try { await api.write(agentId, null); } catch (e) { if (isRedirect(e)) throw e; await failed(id, e, "#remove"); }
  await store.audit(actor, "Removed the assistant's workflow", id).catch(() => undefined);
  revalidatePath(`/admin/clients/${id}/assistant/workflow`);
  redirect(page(id, "done=removed"));
}
