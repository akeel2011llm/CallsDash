"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "./auth";
import * as store from "./data";
import { defaultLlm, type ModelRow } from "./agent-catalog";
import { SECTIONS, studioOf, type SectionId } from "./agent-studio";
import { FEES_KEY } from "./pricing";
import { applyStudioChange, checkCandidate, commitCandidate, type StudioOutcome } from "./studio-apply";
import { deleteHoldAudio } from "./hold-audio";
import { diffValues, recommendedFor } from "./studio-profiles";
import { failKey, failRecord } from "./studio-fail";
import { clearStudioCache, modelBook, syncSetup } from "./studio-server";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const page = (id: string, q: string, hash = "") => `/admin/clients/${id}/assistant?${q}${hash}`;
const only = (id: string) => store.getTenant(id).then((t) => t ?? redirect("/admin"));
const sectionOf = (f: FormData): SectionId => SECTIONS.find((s) => s === str(f, "section")) ?? redirect("/admin");

async function done(id: string, section: SectionId, o: StudioOutcome): Promise<never> {
  revalidatePath(`/admin/clients/${id}`, "layout");
  revalidatePath("/app", "layout");
  const hash = `#${section}`;
  // a fresh address each time: a redirect to the address already open is not reloaded, and the forms would keep showing the old values
  const q = new URLSearchParams({ section, at: Date.now().toString(36) });
  if (o.kind === "invalid") q.set("bad", o.errors.map((e) => `${e.field}:${e.key}`).join(","));
  else if (o.kind === "refused") {
    // ElevenLabs' own words are kept on the server and shown by the page; the address only says there is a reason to show
    await store.setSetting(failKey(id), failRecord(section, o.detail)).catch(() => undefined);
    q.set("fail", "1");
  } else if (o.kind === "saved") { q.set("done", "saved"); q.set("why", o.reason); }
  else { q.set("done", "applied"); if (o.warnings.length) q.set("warn", o.warnings.map((w) => w.group).join(",")); }
  redirect(page(id, q.toString(), hash));
}

async function run(f: FormData, reset: boolean) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  await only(id);
  const section = sectionOf(f);
  if (reset && f.get("confirm") !== "on") redirect(page(id, `section=${section}`, `#${section}`));
  // only a change to the AI model is checked against ElevenLabs' list, so the other sections do not wait for it
  let models: ModelRow[] = [];
  let listed = false;
  if (section === "model" && !reset) {
    const st = studioOf(await store.getAgent(id));
    const book = await modelBook(id, { keep: [st.llm || defaultLlm(), ...st.backupModels] });
    models = book.rows;
    listed = book.source !== "builtin";
  }
  const outcome = await applyStudioChange(
    { data: store, sync: await syncSetup(), models, listed },
    id, actor, reset ? { section, reset: true } : { section, form: f },
  );
  await done(id, section, outcome);
}

/** Saves one section of a client's Assistant studio: checks it, sends it to ElevenLabs, and stores it once ElevenLabs accepted it. */
export async function saveStudioSectionAction(f: FormData) { await run(f, false); }

/** Puts one section back to its defaults. */
export async function resetStudioSectionAction(f: FormData) { await run(f, true); }

/** Forgets the model list and prices held in memory, so the next look asks ElevenLabs again. */
export async function refreshModelsAction(f: FormData) {
  await requireAdmin();
  const id = str(f, "tenantId");
  await only(id);
  clearStudioCache();
  await modelBook(id, { force: true });
  redirect(page(id, "refreshed=1", "#model"));
}

/** What our ElevenLabs plan charges per voice minute and per chat message, which every cost on the screen starts from. */
export async function saveFeesAction(f: FormData) {
  const { actor } = await requireAdmin();
  // the fees are the same for every client: the form lives in Platform settings (no client); a client page may still send one
  const id = str(f, "tenantId");
  if (id) await only(id);
  const to = (q: string) => (id ? page(id, q, "#pricing") : `/admin/settings?${q}#fees`);
  const n = (k: string) => Number(str(f, k).replace(",", "."));
  const minuteUsd = n("minuteUsd"), messageUsd = n("messageUsd");
  const ok = [minuteUsd, messageUsd].every((v) => Number.isFinite(v) && v >= 0 && v < 10);
  if (!ok) redirect(to("feesBad=1"));
  await store.setSetting(FEES_KEY, { minuteUsd, messageUsd });
  await store.audit(actor, `Set the ElevenLabs fee used for costs: $${minuteUsd} per voice minute, $${messageUsd} per message`);
  revalidatePath("/admin", "layout");
  redirect(to("feesSaved=1"));
}

/**
 * "Use recommended": puts every setting of one section that has a recommended value on it (the values of the built-in
 * Recommended profile), sends the section to ElevenLabs and stores it once accepted. The client's own voices, greetings, words and
 * texts are left as they are.
 */
export async function applyRecommendedAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  await only(id);
  const section = sectionOf(f);
  if (f.get("confirm") !== "on") redirect(page(id, `section=${section}`, `#${section}`));
  const values = recommendedFor(section);
  const current = await store.getAgent(id);
  const { candidate, changes } = diffValues(current, values);
  let models: ModelRow[] = [];
  let listed = false;
  if ("llm" in values) {
    const book = await modelBook(id, { keep: [studioOf(current).llm || defaultLlm(), ...studioOf(candidate).backupModels] });
    models = book.rows;
    listed = book.source !== "builtin";
  }
  const errors = checkCandidate(candidate, current, { models, listed });
  if (errors.length) await done(id, section, { kind: "invalid", errors });
  const summary = `Used the recommended ${section} settings (${changes.length} change${changes.length === 1 ? "" : "s"}${changes.length ? `: ${changes.map((c) => c.key).join(", ")}` : ""})`.slice(0, 480);
  await done(id, section, await commitCandidate({ data: store, sync: await syncSetup(), models, listed }, id, actor, current, candidate, summary));
}

/** Removes the client's hold audio at ElevenLabs, so waiting callers hear the default tone again. */
export async function deleteHoldAudioAction(f: FormData) {
  await requireAdmin();
  const id = str(f, "tenantId");
  await only(id);
  const back = (q: string) => redirect(page(id, `section=safety&hold=${q}`, "#safety"));
  if (f.get("confirm") !== "on") back("confirm");
  const agentId = (await store.getAgent(id)).elevenLabsAgentId;
  const key = process.env.ELEVENLABS_API_KEY;
  if (!agentId) back("no_agent");
  if (!key) back("no_key");
  try { await deleteHoldAudio(key!, agentId!); } catch { back("refused"); }
  await store.audit("admin", "Removed the hold audio from the assistant", id).catch(() => undefined);
  clearStudioCache();
  back("removed");
}
