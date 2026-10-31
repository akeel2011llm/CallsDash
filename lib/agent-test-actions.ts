"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "./auth";
import * as store from "./data";
import { dictionaries, getT } from "./i18n";
import { plainDetail } from "./elevenlabs-api";
import { businessOf, vocabOf } from "./business-types";
import { TEST_LIMITS, agentTestsFromEnv, readSuite, starterTests, testFromForm, testsFailKey, testsKey, type TestSuite } from "./agent-tests";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const page = (id: string, q: string, hash = "") => `/admin/clients/${id}/assistant/tests?${q}&at=${Date.now().toString(36)}${hash}`;
const isRedirect = (e: unknown) => !!e && typeof e === "object" && "digest" in e;

async function setup(f: FormData, needAgent = false) {
  const { actor } = await requireAdmin();
  const id = str(f, "tenantId");
  const tenant = await store.getTenant(id);
  if (!tenant) redirect("/admin");
  const api = agentTestsFromEnv();
  if (!api) redirect(page(id, "err=no_key"));
  const agentId = (await store.getAgent(id)).elevenLabsAgentId;
  if (needAgent && !agentId) redirect(page(id, "err=no_agent"));
  const suite = readSuite(await store.getSetting(testsKey(id)).catch(() => undefined));
  return { id, tenant, actor, api, agentId, suite };
}

const save = (id: string, s: TestSuite) => store.setSetting(testsKey(id), s);

/** ElevenLabs' reason is kept on the server for ten minutes, and the page shows it; the address only says there is one. */
async function failed(id: string, e: unknown, hash = ""): Promise<never> {
  await store.setSetting(testsFailKey(id), { detail: plainDetail(e instanceof Error ? e.message : "refused").slice(0, 400), at: new Date().toISOString() }).catch(() => undefined);
  redirect(page(id, "err=refused", hash));
}

/** Adds a test (in ElevenLabs and in the client's list), or saves the changes to one (`testId`). */
export async function saveTestAction(f: FormData) {
  const { id, actor, api, suite } = await setup(f);
  const tid = str(f, "testId");
  const hash = tid ? `#t-${tid}` : "#new";
  const parsed = testFromForm((k) => String(f.get(k) ?? ""));
  if (!parsed.ok) redirect(page(id, `err=${parsed.error}`, hash));
  const known = suite.tests.find((t) => t.id === tid);
  if (tid && !known) redirect(page(id, "err=gone"));
  if (!tid && suite.tests.length >= TEST_LIMITS.count) redirect(page(id, "err=full", hash));
  let newId = "";
  try {
    if (tid) await api.update(tid, parsed.value);
    else newId = await api.create(parsed.value);
  } catch (e) {
    if (isRedirect(e)) throw e;
    await failed(id, e, hash);
  }
  const tests = tid
    ? suite.tests.map((t) => (t.id === tid ? { ...t, ...parsed.value } : t))
    : [...suite.tests, { id: newId, ...parsed.value, createdAt: new Date().toISOString() }];
  await save(id, { ...suite, tests });
  await store.audit(actor, `${tid ? "Edited" : "Added"} the assistant test "${parsed.value.name}"`, id).catch(() => undefined);
  revalidatePath(`/admin/clients/${id}/assistant/tests`);
  redirect(page(id, tid ? "done=saved" : "done=added", tid ? hash : `#t-${newId}`));
}

/** Adds the ready-made tests this client does not have yet (matched by name). */
export async function addStarterTestsAction(f: FormData) {
  const { id, tenant, actor, api, suite } = await setup(f);
  const { locale } = await getT(tenant);
  const dict = dictionaries[locale] as Record<string, string>;
  const clinic = businessOf(tenant).type === "clinic";
  const have = new Set(suite.tests.map((t) => t.name.toLowerCase()));
  const todo = starterTests(vocabOf(tenant, "en"), clinic, (k) => dict[`tests.starter.${k}`] ?? k)
    .filter((t) => !have.has(t.name.toLowerCase()))
    .slice(0, Math.max(0, TEST_LIMITS.count - suite.tests.length));
  const tests = [...suite.tests];
  try {
    for (const t of todo) tests.push({ id: await api.create(t), ...t, createdAt: new Date().toISOString() });
  } catch (e) {
    if (isRedirect(e)) throw e;
    await save(id, { ...suite, tests }); // keep the ones that were made
    await failed(id, e);
  }
  await save(id, { ...suite, tests });
  await store.audit(actor, `Added ${todo.length} ready-made assistant tests`, id).catch(() => undefined);
  revalidatePath(`/admin/clients/${id}/assistant/tests`);
  redirect(page(id, `done=starters&n=${todo.length}`));
}

/** Deletes a test (tick box) in ElevenLabs and from the client's list. */
export async function deleteTestAction(f: FormData) {
  const { id, actor, api, suite } = await setup(f);
  const tid = str(f, "testId");
  const t = suite.tests.find((x) => x.id === tid);
  if (!t) redirect(page(id, "err=gone"));
  if (f.get("confirm") !== "on") redirect(page(id, "err=confirm", `#t-${tid}`));
  try { await api.remove(tid); } catch (e) { if (isRedirect(e)) throw e; await failed(id, e, `#t-${tid}`); }
  await save(id, { ...suite, tests: suite.tests.filter((x) => x.id !== tid) });
  await store.audit(actor, `Deleted the assistant test "${t.name}"`, id).catch(() => undefined);
  revalidatePath(`/admin/clients/${id}/assistant/tests`);
  redirect(page(id, "done=deleted"));
}

/** Runs every test, or one (`testId`), on the client's assistant as it is live now. */
export async function runTestsAction(f: FormData) {
  const { id, actor, api, agentId, suite } = await setup(f, true);
  const tid = str(f, "testId");
  const ids = tid ? suite.tests.filter((t) => t.id === tid).map((t) => t.id) : suite.tests.map((t) => t.id);
  if (!ids.length) redirect(page(id, "err=none"));
  let runId = "";
  try { runId = await api.run(agentId, ids); } catch (e) { if (isRedirect(e)) throw e; await failed(id, e); }
  await save(id, { ...suite, lastRun: { id: runId, at: new Date().toISOString() } });
  await store.audit(actor, `Ran ${ids.length} assistant test(s)`, id).catch(() => undefined);
  revalidatePath(`/admin/clients/${id}/assistant/tests`);
  redirect(page(id, "done=started", "#results"));
}
