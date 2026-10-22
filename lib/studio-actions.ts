"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "./auth";
import * as store from "./data";
import { defaultLlm } from "./agent-catalog";
import { SECTIONS, studioOf, type SectionId } from "./agent-studio";
import { FEES_KEY } from "./pricing";
import { applyStudioChange, type StudioOutcome } from "./studio-apply";
import { clearStudioCache, modelBook, syncSetup } from "./studio-server";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const page = (id: string, q: string, hash = "") => `/admin/clients/${id}/assistant?${q}${hash}`;
const only = (id: string) => store.getTenant(id).then((t) => t ?? redirect("/admin"));
const sectionOf = (f: FormData): SectionId => SECTIONS.find((s) => s === str(f, "section")) ?? redirect("/admin");

function done(id: string, section: SectionId, o: StudioOutcome): never {
  revalidatePath(`/admin/clients/${id}`, "layout");
  revalidatePath("/app", "layout");
  const hash = `#${section}`;
  const q = new URLSearchParams({ section });
  if (o.kind === "invalid") q.set("bad", o.errors.map((e) => `${e.field}:${e.key}`).join(","));
  else if (o.kind === "refused") q.set("fail", o.detail.slice(0, 300));
  else if (o.kind === "saved") { q.set("done", "saved"); q.set("why", o.reason); }
  else { q.set("done", "applied"); if (o.warnings.length) q.set("warn", o.warnings.map((w) => w.group).join(",")); }
  redirect(page(id, q.toString(), hash));
}

async function run(f: FormData, reset: boolean) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  await only(id);
  const section = sectionOf(f);
  if (reset && f.get("confirm") !== "on") redirect(page(id, `section=${section}`, `#${section}`));
  const agent = await store.getAgent(id);
  const st = studioOf(agent);
  const book = await modelBook(id, { keep: [st.llm || defaultLlm(), ...st.backupModels] });
  const outcome = await applyStudioChange(
    { data: store, sync: await syncSetup(), models: book.rows, listed: book.source !== "builtin" },
    id, actor, reset ? { section, reset: true } : { section, form: f },
  );
  done(id, section, outcome);
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
  const id = str(f, "tenantId");
  await only(id);
  const n = (k: string) => Number(str(f, k).replace(",", "."));
  const minuteUsd = n("minuteUsd"), messageUsd = n("messageUsd");
  const ok = [minuteUsd, messageUsd].every((v) => Number.isFinite(v) && v >= 0 && v < 10);
  if (!ok) redirect(page(id, "feesBad=1", "#pricing"));
  await store.setSetting(FEES_KEY, { minuteUsd, messageUsd });
  await store.audit(actor, `Set the ElevenLabs fee used for costs: $${minuteUsd} per voice minute, $${messageUsd} per message`);
  revalidatePath(`/admin/clients/${id}`, "layout");
  redirect(page(id, "feesSaved=1", "#pricing"));
}
