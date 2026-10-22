import { describe, expect, it } from "vitest";
import { applyStudioChange, checkChoices, type ApplyDeps } from "@/lib/studio-apply";
import { modelRows } from "@/lib/agent-catalog";
import { studioOf } from "@/lib/agent-studio";
import { syncAgent, type SyncDeps } from "@/lib/agent-sync";
import { ElevenLabsError, type ElevenLabsApi } from "@/lib/elevenlabs-api";
import { createPgData, type Db, type Q } from "@/lib/data/pg";
import { makeDb } from "./helpers/pgdb";

type Call = { fn: string; args: unknown[] };
function fakeApi() {
  const calls: Call[] = [];
  let n = 0;
  const log = <T,>(fn: string, ret: T) => (...args: unknown[]) => { calls.push({ fn, args }); return Promise.resolve(ret); };
  const api: ElevenLabsApi & { refuse?: (body: Record<string, unknown>) => string | undefined } = {
    createAgent: log("createAgent", { agent_id: "agent_1" }),
    updateAgent: (...a: unknown[]) => {
      const why = api.refuse?.(a[1] as Record<string, unknown>);
      if (why) { calls.push({ fn: "updateAgent!", args: a }); return Promise.reject(new ElevenLabsError(422, why)); }
      return log("updateAgent", undefined)(...a);
    },
    createKnowledgeText: (...a: unknown[]) => log("createKnowledgeText", { id: `kb_${++n}` })(...a),
    deleteKnowledge: log("deleteKnowledge", undefined),
    createWebhookTool: (...a: unknown[]) => log("createWebhookTool", { id: `tool_${++n}` })(...a),
    updateTool: log("updateTool", undefined),
    sendWhatsappTemplate: log("sendWhatsappTemplate", {}),
    transcribe: log("transcribe", { text: "" }),
  } as never;
  return { api, calls };
}

const rows = (extra: Parameters<typeof modelRows>[0]["live"] = []) => modelRows({
  live: [
    { id: "gpt-6-luna", reasoningEfforts: ["low", "medium", "high"], maxOutputTokens: 8000, contextTokens: 400000 },
    { id: "gemini-2.5-flash", reasoningEfforts: [], maxOutputTokens: 65000, contextTokens: 1000000 },
    { id: "claude-sonnet-5-5", reasoningEfforts: [], maxOutputTokens: 64000, contextTokens: 200000 },
    { id: "tiny-model", reasoningEfforts: [], maxOutputTokens: 1000, contextTokens: 32000 },
    ...extra,
  ],
  prices: [], promptChars: 6000, unknown: { perMinute: 0.02, perMessage: 0.001 }, today: "2026-10-21",
});

async function setup(opts: { agent?: boolean } = { agent: true }) {
  const pg = await makeDb();
  const q: Q = async (sql, params) => (await pg.query(sql, params as unknown[])).rows as never;
  const db: Db = { q, tx: (fn) => pg.transaction((tx) => fn(async (sql, params) => (await tx.query(sql, params as unknown[])).rows as never)) };
  const data = createPgData(db);
  const tenant = await data.createTenant({ name: "Studio Clinic", nameAr: "", color: "#112233", domain: "studio.example.bh", planType: "package", actor: "admin" });
  const { api, calls } = fakeApi();
  const sync: SyncDeps = { api, data, appUrl: "https://app.example", toolsSecret: "tools", initSecret: "init" };
  await data.addKnowledge(tenant.id, "Hours?", "8 to 9", "en", "admin");
  if (opts.agent) await syncAgent(sync, tenant.id, "admin"); // the agent exists in ElevenLabs
  calls.length = 0;
  const deps: ApplyDeps = { data, sync, models: rows(), listed: true };
  return { data, tenant, api, calls, deps };
}

const form = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};
const modelForm = (over: Record<string, string | string[]> = {}) => form({ llm: "gpt-6-luna", temperature: "0.2", maxTokens: "0", reasoningEffort: "", parallelTools: "on", backupMode: "default", cascadeSeconds: "4", ...over });
const voiceForm = (over: Record<string, string | string[]> = {}) => form({
  voiceEn: "voice_en_f", voiceAr: "voice_ar_f", ttsModelEn: "eleven_flash_v2", ttsModelAr: "eleven_flash_v2_5",
  stability: "0.5", similarity: "0.8", speed: "1", textNormalisation: "system_prompt", ...over,
});
const names = (calls: Call[]) => calls.map((c) => c.fn);

describe("saving a section of the Assistant studio", () => {
  it("sends the change to ElevenLabs and stores it once ElevenLabs accepted it", async () => {
    const { deps, data, tenant, calls } = await setup();
    const out = await applyStudioChange(deps, tenant.id, "admin", { section: "model", form: modelForm({ temperature: "0.15" }) });
    expect(out).toEqual({ kind: "applied", warnings: [] });
    const body = calls.find((c) => c.fn === "updateAgent")!.args[1] as { conversation_config: { agent: { prompt: { llm: string; temperature: number; max_tokens: number } } } };
    expect(body.conversation_config.agent.prompt).toMatchObject({ llm: "gpt-6-luna", temperature: 0.15, max_tokens: -1 });
    const saved = await data.getAgent(tenant.id);
    expect(saved.temperature).toBe(0.15);
    expect(studioOf(saved)).toMatchObject({ llm: "gpt-6-luna", touched: ["model"] });
    const versions = await data.getAgentVersions(tenant.id);
    expect(versions[0].summary).toContain("model default → gpt-6-luna");
  });

  it("does not upload the knowledge base again for a change that does not touch it", async () => {
    const { deps, tenant, calls } = await setup();
    await applyStudioChange(deps, tenant.id, "admin", { section: "model", form: modelForm() });
    expect(names(calls)).not.toContain("createKnowledgeText");
    expect(names(calls)).not.toContain("deleteKnowledge");
  });

  it("changes nothing and sends nothing when the form is not allowed", async () => {
    const { deps, data, tenant, calls } = await setup();
    const before = await data.getAgent(tenant.id);
    const out = await applyStudioChange(deps, tenant.id, "admin", { section: "model", form: modelForm({ temperature: "7", llm: "not-offered" }) });
    expect(out.kind).toBe("invalid");
    if (out.kind === "invalid") expect(out.errors).toEqual([{ field: "llm", key: "studio.err.model" }, { field: "temperature", key: "studio.err.range" }]);
    expect(calls).toEqual([]);
    expect(await data.getAgent(tenant.id)).toEqual(before);
  });

  it("stores nothing when ElevenLabs refuses the change, and says why", async () => {
    const { deps, data, api, tenant } = await setup();
    const before = await data.getAgent(tenant.id);
    (api as { refuse?: (b: Record<string, unknown>) => string | undefined }).refuse = () => "llm: this model is not available in your region";
    const out = await applyStudioChange(deps, tenant.id, "admin", { section: "model", form: modelForm() });
    expect(out).toMatchObject({ kind: "refused" });
    if (out.kind === "refused") expect(out.detail).toContain("not available in your region");
    expect(await data.getAgent(tenant.id)).toEqual(before);
    expect((await data.getTenant(tenant.id))!.integrations.elevenlabs?.error).toBeUndefined(); // the failure is shown where the change was made
  });

  it("saves, with a warning, when only an optional group is refused", async () => {
    const { deps, data, api, tenant } = await setup();
    (api as { refuse?: (b: Record<string, unknown>) => string | undefined }).refuse = (body) => (JSON.stringify(body).includes("reasoning_effort") ? "reasoning_effort: not supported" : undefined);
    const out = await applyStudioChange(deps, tenant.id, "admin", { section: "model", form: modelForm({ reasoningEffort: "low" }) });
    expect(out.kind).toBe("applied");
    if (out.kind === "applied") expect(out.warnings.map((w) => w.group)).toEqual(["model"]);
    expect(studioOf(await data.getAgent(tenant.id)).reasoningEffort).toBe("low");
  });

  it("only saves, in CallsDash, when the assistant does not exist in ElevenLabs yet", async () => {
    const { deps, data, tenant, calls } = await setup({ agent: false });
    const out = await applyStudioChange(deps, tenant.id, "admin", { section: "model", form: modelForm() });
    expect(out).toEqual({ kind: "saved", reason: "no_agent" });
    expect(calls).toEqual([]);
    expect(studioOf(await data.getAgent(tenant.id)).llm).toBe("gpt-6-luna");
  });

  it("only saves when ElevenLabs cannot be reached yet (no key, no secret)", async () => {
    const { deps, data, tenant, calls } = await setup();
    const out = await applyStudioChange({ ...deps, sync: "no_api_key" }, tenant.id, "admin", { section: "voice", form: voiceForm({ stability: "0.3" }) });
    expect(out).toEqual({ kind: "saved", reason: "no_api_key" });
    expect(calls).toEqual([]);
    expect(studioOf(await data.getAgent(tenant.id)).stability).toBe(0.3);
  });

  it("refuses a reasoning level the chosen model does not offer, and more reply length than it can write", async () => {
    const { deps, tenant } = await setup();
    const a = await applyStudioChange(deps, tenant.id, "admin", { section: "model", form: modelForm({ reasoningEffort: "xhigh" }) });
    expect(a).toEqual({ kind: "invalid", errors: [{ field: "reasoningEffort", key: "studio.err.effort" }] });
    const b = await applyStudioChange(deps, tenant.id, "admin", { section: "model", form: modelForm({ llm: "tiny-model", maxTokens: "1500" }) });
    expect(b).toEqual({ kind: "invalid", errors: [{ field: "maxTokens", key: "studio.err.tokensModel" }] });
    const ok = await applyStudioChange(deps, tenant.id, "admin", { section: "model", form: modelForm({ reasoningEffort: "high", maxTokens: "800" }) });
    expect(ok.kind).toBe("applied");
  });

  it("does not take a main model as its own backup", async () => {
    const { deps, tenant, calls } = await setup();
    await applyStudioChange(deps, tenant.id, "admin", { section: "model", form: modelForm({ backupMode: "custom", backupModels: ["gpt-6-luna", "gemini-2.5-flash"] }) });
    const body = calls.find((c) => c.fn === "updateAgent")!.args[1] as { conversation_config: { agent: { prompt: { backup_llm_config: unknown } } } };
    expect(body.conversation_config.agent.prompt.backup_llm_config).toEqual({ preference: "override", order: ["gemini-2.5-flash"] });
  });

  it("leaves the temperature out for a model that rejects it", async () => {
    const { deps, tenant, calls } = await setup();
    await applyStudioChange(deps, tenant.id, "admin", { section: "model", form: modelForm({ llm: "claude-sonnet-5-5", temperature: "0.3" }) });
    const body = calls.find((c) => c.fn === "updateAgent")!.args[1] as { conversation_config: { agent: { prompt: { temperature: unknown } } } };
    expect(body.conversation_config.agent.prompt.temperature).toBeNull();
  });

  it("never puts an English-only voice model on the Arabic side", async () => {
    const { deps, tenant, calls } = await setup();
    const out = await applyStudioChange(deps, tenant.id, "admin", { section: "voice", form: voiceForm({ ttsModelAr: "eleven_flash_v2" }) });
    expect(out).toEqual({ kind: "invalid", errors: [{ field: "ttsModelAr", key: "studio.err.ttsLang" }] });
    expect(calls).toEqual([]);
  });

  it("changes the voice for both languages and remembers the names", async () => {
    const { deps, data, tenant, calls } = await setup();
    const out = await applyStudioChange(deps, tenant.id, "admin", {
      section: "voice",
      form: voiceForm({ voiceEn: "EnVoice123456", voiceEnName: "Eddie", voiceAr: "ArVoice123456", voiceArName: "Haytham", ttsModelEn: "eleven_v4_turbo", ttsModelAr: "eleven_v4_turbo", expressive: "on" }),
    });
    expect(out.kind).toBe("applied");
    const body = calls.find((c) => c.fn === "updateAgent")!.args[1] as { conversation_config: { tts: Record<string, unknown>; language_presets: { ar: { overrides: { tts: Record<string, unknown> } } } } };
    expect(body.conversation_config.tts).toMatchObject({ voice_id: "EnVoice123456", model_id: "eleven_v4_turbo", expressive_mode: true });
    expect(body.conversation_config.language_presets.ar.overrides.tts).toMatchObject({ voice_id: "ArVoice123456", model_id: "eleven_v4_turbo" });
    const saved = await data.getAgent(tenant.id);
    expect([saved.voiceEn, saved.voiceAr]).toEqual(["EnVoice123456", "ArVoice123456"]);
    expect(studioOf(saved).voiceNotes).toMatchObject({ EnVoice123456: { name: "Eddie" }, ArVoice123456: { name: "Haytham" } });
  });

  it("puts a section back to the defaults and sends them explicitly", async () => {
    const { deps, data, tenant, calls } = await setup();
    await applyStudioChange(deps, tenant.id, "admin", { section: "voice", form: voiceForm({ stability: "0.2", speed: "1.15" }) });
    calls.length = 0;
    const out = await applyStudioChange(deps, tenant.id, "admin", { section: "voice", reset: true });
    expect(out.kind).toBe("applied");
    const body = calls.find((c) => c.fn === "updateAgent")!.args[1] as { conversation_config: { tts: Record<string, unknown> } };
    expect(body.conversation_config.tts).toMatchObject({ stability: 0.5, speed: 1, similarity_boost: 0.8 });
    expect(studioOf(await data.getAgent(tenant.id))).toMatchObject({ stability: 0.5, speed: 1 });
  });

  it("applies the model checks only when the list came from ElevenLabs", () => {
    const cur = {} as never;
    const tiny = { studio: { llm: "tiny-model", reasoningEffort: "xhigh", maxTokens: 1500, backupModels: [] }, top: {}, errors: [] };
    expect(checkChoices("model", tiny, cur, { models: rows(), listed: false })).toEqual([]);
    expect(checkChoices("model", tiny, cur, { models: rows(), listed: true }).map((e) => e.field)).toEqual(["maxTokens"]); // a model that lists no levels is not second-guessed
    const luna = { studio: { llm: "gpt-6-luna", reasoningEffort: "xhigh", maxTokens: 100, backupModels: [] }, top: {}, errors: [] };
    expect(checkChoices("model", luna, cur, { models: rows(), listed: true }).map((e) => e.field)).toEqual(["reasoningEffort"]);
  });
});
