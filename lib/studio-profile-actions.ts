"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "./auth";
import * as store from "./data";
import { defaultLlm, type ModelRow } from "./agent-catalog";
import { studioOf } from "./agent-studio";
import { catalogFromEnv } from "./elevenlabs-catalog";
import { checkCandidate, commitCandidate } from "./studio-apply";
import { failRecord, profileFailKey } from "./studio-fail";
import { importLive } from "./studio-import";
import { BUILTIN_IDS, BUILTIN_VALUES, addProfile, diffValues, loadProfiles, removeProfile, renameProfile, snapshot, type BuiltinId, type ProfileError } from "./studio-profiles";
import { modelBook, syncSetup } from "./studio-server";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const page = (id: string, q: string, hash = "") => `/admin/clients/${id}/assistant/profiles${q ? `?${q}` : ""}${hash}`;
const only = (id: string) => store.getTenant(id).then((t) => t ?? redirect("/admin"));
const isBuiltin = (v: string): v is BuiltinId => (BUILTIN_IDS as readonly string[]).includes(v);

/** The values of a profile by id: one of CallsDash's own or one an admin saved. */
async function valuesOf(profile: string): Promise<{ name: string; values: Record<string, unknown> } | null> {
  if (isBuiltin(profile)) return { name: profile, values: BUILTIN_VALUES[profile] };
  const saved = (await loadProfiles(store)).find((p) => p.id === profile);
  return saved ? { name: saved.name, values: saved.values } : null;
}

const refresh = (id: string) => { revalidatePath(`/admin/clients/${id}`, "layout"); revalidatePath("/app", "layout"); };

/** Puts a profile on the client's assistant: checks it, sends it to ElevenLabs, and stores it once ElevenLabs accepted it. */
export async function applyProfileAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  await only(id);
  const profile = str(f, "profile");
  const back = (q: string) => page(id, q ? `profile=${encodeURIComponent(profile)}&${q}` : `profile=${encodeURIComponent(profile)}`, "#preview");
  if (f.get("confirm") !== "on") redirect(back("need=1"));
  const found = await valuesOf(profile);
  if (!found) redirect(page(id, "err=missing"));

  const current = await store.getAgent(id);
  const { candidate, changes } = diffValues(current, found.values);
  // the model list is only needed when the profile changes the AI model; ElevenLabs' own list says what is allowed
  let models: ModelRow[] = [];
  let listed = false;
  if ("llm" in found.values) {
    const st = studioOf(current);
    const book = await modelBook(id, { keep: [st.llm || defaultLlm(), ...studioOf(candidate).backupModels] });
    models = book.rows;
    listed = book.source !== "builtin";
  }
  const errors = checkCandidate(candidate, current, { models, listed });
  if (errors.length) redirect(back(`bad=${errors.map((e) => `${e.field}:${e.key}`).join(",")}`));

  const label = isBuiltin(profile) ? `built-in profile ${profile}` : `profile "${found.name}"`;
  const summary = `Applied ${label} (${changes.length} change${changes.length === 1 ? "" : "s"}: ${changes.map((c) => c.key).join(", ")})`.slice(0, 480);
  const outcome = await commitCandidate({ data: store, sync: await syncSetup(), models, listed }, id, actor, current, candidate, summary);
  refresh(id);
  if (outcome.kind === "applied") redirect(back(`done=applied${outcome.warnings.length ? `&warn=${outcome.warnings.map((w) => w.group).join(",")}` : ""}`));
  if (outcome.kind === "saved") redirect(back(`done=saved&why=${outcome.reason}`));
  if (outcome.kind === "refused") {
    await store.setSetting(profileFailKey(id), failRecord("model", outcome.detail)).catch(() => undefined);
    redirect(back("fail=1"));
  }
  redirect(back("done=applied"));
}

const errorCode = (e: ProfileError) => `err=${e}`;

/** Keeps the settings this client has now as a profile that any client can use. */
export async function saveProfileAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  await only(id);
  const r = await addProfile(store, { name: str(f, "name"), note: str(f, "note"), values: snapshot(await store.getAgent(id)), by: actor });
  if (!r.ok) redirect(page(id, errorCode(r.error), "#save"));
  await store.audit(actor, `Saved the assistant studio profile "${r.profile.name}"`);
  redirect(page(id, "done=profileSaved", "#profiles"));
}

export async function renameProfileAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  await only(id);
  const r = await renameProfile(store, str(f, "profile"), { name: str(f, "name"), note: str(f, "note") });
  if (!r.ok) redirect(page(id, errorCode(r.error), "#profiles"));
  await store.audit(actor, `Renamed the assistant studio profile "${str(f, "name")}"`);
  redirect(page(id, "done=renamed", "#profiles"));
}

export async function deleteProfileAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  await only(id);
  if (f.get("confirm") !== "on") redirect(page(id, "", "#profiles"));
  const saved = (await loadProfiles(store)).find((p) => p.id === str(f, "profile"));
  if (saved && (await removeProfile(store, saved.id))) await store.audit(actor, `Deleted the assistant studio profile "${saved.name}"`);
  redirect(page(id, "done=deleted", "#profiles"));
}

/** Puts what the agent holds in ElevenLabs into CallsDash. Nothing is written to ElevenLabs. */
export async function importLiveAction(f: FormData) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  await only(id);
  const take = f.getAll("take").map(String);
  const out = await importLive({ data: store, catalog: catalogFromEnv() }, id, actor, take);
  refresh(id);
  if (out.kind === "failed") {
    await store.setSetting(profileFailKey(id), failRecord("model", out.detail)).catch(() => undefined);
    redirect(page(id, "fail=1&read=1", "#read"));
  }
  if (out.kind === "no_key" || out.kind === "no_agent") redirect(page(id, `readErr=${out.kind}`, "#read"));
  if (out.kind === "nothing") redirect(page(id, "done=nothing", "#read"));
  if (out.kind !== "imported") redirect(page(id, "", "#read"));
  const name = str(f, "saveAs");
  let extra = "";
  if (name) {
    const r = await addProfile(store, { name, note: "", values: snapshot(await store.getAgent(id)), by: actor });
    extra = r.ok ? "&savedAs=1" : `&${errorCode(r.error)}`;
  }
  redirect(page(id, `done=imported&n=${out.count}${extra}`, "#read"));
}
