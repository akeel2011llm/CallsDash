import { describe, expect, it } from "vitest";
import { applyExtras, syncAgent, SyncError, type SyncDeps } from "@/lib/agent-sync";
import { AGENT_VERSION } from "@/lib/agent-config";
import { buildExtras, deepMerge, readableOn } from "@/lib/agent-extras";
import { ElevenLabsError, createElevenLabsApi, type ElevenLabsApi } from "@/lib/elevenlabs-api";
import { createPgData, type Db, type Q } from "@/lib/data/pg";
import { makeDb } from "./helpers/pgdb";

function fakeApi() {
  const calls: { fn: string; args: unknown[] }[] = [];
  let n = 0;
  const log = <T,>(fn: string, ret: T) => (...args: unknown[]) => { calls.push({ fn, args }); return Promise.resolve(ret); };
  const api: ElevenLabsApi & { fail?: string } = {
    createAgent: (...a) => { if (api.fail === "createAgent") return Promise.reject(new ElevenLabsError(422, "bad voice")); return log("createAgent", { agent_id: "agent_1" })(...a); },
    updateAgent: (...a) => { if (api.fail === "updateAgent") return Promise.reject(new ElevenLabsError(500, "boom")); return log("updateAgent", undefined)(...a); },
    createKnowledgeText: (...a) => log("createKnowledgeText", { id: `kb_${++n}` })(...a),
    deleteKnowledge: log("deleteKnowledge", undefined),
    createWebhookTool: (...a) => log("createWebhookTool", { id: `tool_${++n}` })(...a),
    updateTool: log("updateTool", undefined),
    sendWhatsappTemplate: log("sendWhatsappTemplate", {}),
    transcribe: log("transcribe", { text: "" }),
  };
  return { api, calls };
}

async function setup() {
  const pg = await makeDb();
  const q: Q = async (sql, params) => (await pg.query(sql, params as unknown[])).rows as never;
  const db: Db = { q, tx: (fn) => pg.transaction((tx) => fn(async (sql, params) => (await tx.query(sql, params as unknown[])).rows as never)) };
  const data = createPgData(db);
  const tenant = await data.createTenant({ name: "Sync Clinic", nameAr: "", color: "#112233", domain: "sync.example.bh", planType: "package", actor: "admin" });
  const { api, calls } = fakeApi();
  const deps: SyncDeps = { api, data, appUrl: "https://app.example", toolsSecret: "tools", initSecret: "init" };
  return { data, tenant, api, calls, deps, pg };
}
const names = (calls: { fn: string }[]) => calls.map((c) => c.fn);

describe("agent sync", () => {
  it("creates the tools, the knowledge document and the agent the first time", async () => {
    const { deps, data, tenant, calls } = await setup();
    await data.addKnowledge(tenant.id, "Hours?", "8 to 9", "en", "admin");
    const r = await syncAgent(deps, tenant.id, "admin");
    expect(r).toEqual({ agentId: "agent_1", created: true, warnings: [] });
    expect(names(calls).filter((f) => f === "createWebhookTool")).toHaveLength(7);
    expect(names(calls)).toContain("createKnowledgeText");
    expect(names(calls)).toContain("createAgent");
    expect((await data.getAgent(tenant.id)).elevenLabsAgentId).toBe("agent_1");
    const t = (await data.getTenant(tenant.id))!;
    expect(t.integrations.elevenlabs?.kbDocId).toMatch(/^kb_/);
    expect(t.integrations.elevenlabs?.syncedAt).toBeTruthy();
    expect(t.integrations.elevenlabs?.widgetHosts).toContain("app.example"); // the client screens run the widget on the app itself
    expect(t.integrations.elevenlabs?.version).toBe(AGENT_VERSION); // the client screens stop asking for a Sync
    expect(t.channels.website).toBe("connected");
    const body = calls.find((c) => c.fn === "createAgent")!.args[0] as { conversation_config: { agent: { prompt: { tool_ids: string[] } } } };
    expect(body.conversation_config.agent.prompt.tool_ids).toHaveLength(7);
  });
  it("updates in place the second time, reusing the tools and swapping the knowledge document", async () => {
    const { deps, data, tenant, calls } = await setup();
    await data.addKnowledge(tenant.id, "Hours?", "8 to 9", "en", "admin");
    await syncAgent(deps, tenant.id, "admin");
    const firstDoc = (await data.getTenant(tenant.id))!.integrations.elevenlabs!.kbDocId!;
    calls.length = 0;
    await data.addKnowledge(tenant.id, "Parking?", "Yes", "en", "admin");
    const r = await syncAgent(deps, tenant.id, "admin");
    expect(r.created).toBe(false);
    expect(names(calls)).not.toContain("createAgent");
    expect(names(calls)).not.toContain("createWebhookTool");
    expect(names(calls)).not.toContain("updateTool");
    expect(calls.find((c) => c.fn === "updateAgent")!.args[0]).toBe("agent_1");
    expect(calls.find((c) => c.fn === "deleteKnowledge")!.args[0]).toBe(firstDoc);
    expect((await data.getTenant(tenant.id))!.integrations.elevenlabs!.kbDocId).not.toBe(firstDoc);
  });
  it("updates the shared tools when their address changes", async () => {
    const { deps, tenant, calls } = await setup();
    await syncAgent(deps, tenant.id, "admin");
    calls.length = 0;
    await syncAgent({ ...deps, appUrl: "https://new.example" }, tenant.id, "admin");
    expect(names(calls).filter((f) => f === "updateTool")).toHaveLength(7);
  });
  it("sends no knowledge document when there is no knowledge yet", async () => {
    const { deps, tenant, calls } = await setup();
    await syncAgent(deps, tenant.id, "admin");
    expect(names(calls)).not.toContain("createKnowledgeText");
  });
  it("records the error, cleans up the new document and keeps the old state when ElevenLabs refuses", async () => {
    const { deps, data, tenant, api, calls } = await setup();
    await data.addKnowledge(tenant.id, "Hours?", "8 to 9", "en", "admin");
    (api as { fail?: string }).fail = "createAgent";
    await expect(syncAgent(deps, tenant.id, "admin")).rejects.toMatchObject({ code: "failed" });
    expect(names(calls)).toContain("deleteKnowledge"); // the document created for this attempt is removed
    expect((await data.getAgent(tenant.id)).elevenLabsAgentId).toBe("");
    expect((await data.getTenant(tenant.id))!.integrations.elevenlabs?.error).toContain("422");
    (api as { fail?: string }).fail = undefined;
    await syncAgent(deps, tenant.id, "admin"); // retry works and clears the error
    expect((await data.getTenant(tenant.id))!.integrations.elevenlabs?.error).toBeUndefined();
  });
  it("refuses an unknown client", async () => {
    const { deps } = await setup();
    await expect(syncAgent(deps, "00000000-0000-0000-0000-000000000000", "admin")).rejects.toBeInstanceOf(SyncError);
  });
  it("keeps channel secrets apart from the tenant row", async () => {
    const { data, tenant, pg } = await setup();
    await data.setSecrets(tenant.id, { instagramToken: "tok", instagramInboundSecret: "in" });
    await data.setSecrets(tenant.id, { instagramToken: "", instagramReplySecret: "out" }); // empty removes
    expect(await data.getSecrets(tenant.id)).toEqual({ instagramInboundSecret: "in", instagramReplySecret: "out" });
    expect(JSON.stringify((await pg.query(`select * from tenants`)).rows)).not.toContain("tok");
  });
  it("remembers which conversation a chat belongs to", async () => {
    const { data, tenant } = await setup();
    const s = { tenantId: tenant.id, channel: "instagram" as const, externalId: "u1", conversationId: "conv_1", lastAt: new Date().toISOString() };
    await data.saveChatSession(s);
    expect((await data.getChatSession(tenant.id, "instagram", "u1"))?.conversationId).toBe("conv_1");
    expect((await data.findChatSession("conv_1"))?.externalId).toBe("u1");
    await data.saveChatSession({ ...s, conversationId: "conv_2" });
    expect((await data.getChatSession(tenant.id, "instagram", "u1"))?.conversationId).toBe("conv_2");
    await data.deleteChatSession("conv_2");
    expect(await data.getChatSession(tenant.id, "instagram", "u1")).toBeUndefined();
  });
});

describe("extra settings", () => {
  const body = (c: { fn: string; args: unknown[] }) => c.args[1] as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

  it("sends everything in one update when ElevenLabs accepts it", async () => {
    const { deps, tenant, calls } = await setup();
    const r = await syncAgent(deps, tenant.id, "admin");
    expect(r.warnings).toEqual([]);
    const updates = calls.filter((c) => c.fn === "updateAgent");
    expect(updates).toHaveLength(1);
    const b = body(updates[0]);
    expect(b.platform_settings.guardrails).toMatchObject({ version: "1", focus: { is_enabled: true }, prompt_injection: { is_enabled: true } });
    expect(b.platform_settings.privacy).toEqual({ record_voice: true, retention_days: 90 });
    expect(b.conversation_config.agent.prompt.built_in_tools.end_call).toMatchObject({ type: "system", params: { system_tool_type: "end_call" } });
    expect(b.conversation_config.agent.prompt.built_in_tools.language_detection).toBeTruthy(); // the core settings are still there
    expect(b.platform_settings.data_collection.outcome).toBeTruthy();
    expect(Object.keys(b.platform_settings.data_collection)).toEqual(["outcome", "intent", "urgent", "follow_up_needed", "caller_name", "caller_sentiment"]);
    expect(b.platform_settings.evaluation.criteria.map((c: { id: string }) => c.id)).toContain("no_medical_advice");
    expect(b.platform_settings.widget.btn_color).toBe("#112233");
    expect(b.conversation_config.asr.keywords).toContain("Sync Clinic");
  });

  it("applies the core agent and every group but the refused one, and says which was refused", async () => {
    const { deps, data, tenant, api, calls } = await setup();
    const real = api.updateAgent;
    api.updateAgent = (id, b) => (JSON.stringify(b).includes('"prompt_injection"') ? Promise.reject(new ElevenLabsError(422, "unknown guardrail")) : real(id, b));
    const r = await syncAgent(deps, tenant.id, "admin");
    expect(r.warnings).toEqual([{ group: "guardrails", detail: expect.stringContaining("unknown guardrail") }]);
    const last = body(calls.filter((c) => c.fn === "updateAgent").at(-1)!);
    expect(last.platform_settings.guardrails).toBeUndefined();
    expect(last.platform_settings.privacy.retention_days).toBe(90); // later groups survive
    expect(last.platform_settings.widget).toBeTruthy();
    expect(last.conversation_config.agent.prompt.prompt).toBeTruthy(); // the prompt is never lost
    expect((await data.getTenant(tenant.id))!.integrations.elevenlabs?.warnings?.[0].group).toBe("guardrails");
    api.updateAgent = real;
    await syncAgent(deps, tenant.id, "admin");
    expect((await data.getTenant(tenant.id))!.integrations.elevenlabs?.warnings).toBeUndefined(); // cleared when it works again
  });

  it("still fails the sync when even the core agent is refused", async () => {
    const { deps, tenant, api } = await setup();
    await syncAgent(deps, tenant.id, "admin");
    api.updateAgent = () => Promise.reject(new ElevenLabsError(401, "bad key"));
    await expect(syncAgent(deps, tenant.id, "admin")).rejects.toMatchObject({ code: "failed" });
  });

  it("applyExtras adds groups one at a time without losing earlier ones", async () => {
    const sent: Record<string, any>[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    const api = { updateAgent: async (_id: string, b: Record<string, any>) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      sent.push(b); if (sent.length === 1 || "limits_marker" in (b.platform_settings?.call_limits ?? {})) throw new Error("no"); } } as unknown as ElevenLabsApi;
    const groups = [{ name: "privacy" as const, body: { platform_settings: { privacy: { x: 1 } } } }, { name: "limits" as const, body: { platform_settings: { call_limits: { limits_marker: 1 } } } }, { name: "widget" as const, body: { platform_settings: { widget: { y: 2 } } } }];
    const w = await applyExtras(api, "a", { name: "core" }, groups);
    expect(w.map((x) => x.group)).toEqual(["limits"]);
    expect(sent.at(-1)).toEqual({ name: "core", platform_settings: { privacy: { x: 1 }, widget: { y: 2 } } });
  });

  it("builds the groups from the client's own data", () => {
    const groups = buildExtras({
      tenant: { name: "Al Noor", branding: { displayName: "Al Noor", displayNameAr: "النور", primaryColor: "#ffffff" }, retentionDays: 30, allowedDomains: [] },
      doctors: [{ name: "Dr. Hana" }, { name: "Dr. Hana" }],
    });
    const by = Object.fromEntries(groups.map((g) => [g.name, g.body])) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(by.privacy.platform_settings.privacy.retention_days).toBe(30);
    expect(by.keywords.conversation_config.asr.keywords).toEqual(["Al Noor", "النور", "Dr. Hana"]);
    expect(by.widget.platform_settings.widget.btn_text_color).toBe("#111111"); // dark text on a white button
    expect(JSON.stringify(groups)).not.toMatch(/secret|api[_-]?key|token|password/i);
  });

  it("merges plain objects deeply and picks readable button text", () => {
    expect(deepMerge({ a: { b: 1, c: [1] }, d: 1 }, { a: { c: [2], e: 3 } })).toEqual({ a: { b: 1, c: [2], e: 3 }, d: 1 });
    expect(readableOn("#000000")).toBe("#ffffff");
    expect(readableOn("#ffff00")).toBe("#111111");
  });
});

describe("ElevenLabs client requests", () => {
  const record = () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => { seen.push({ url, init }); return new Response(JSON.stringify({ agent_id: "a", id: "i", conversation_id: "c" }), { status: 200 }); }) as unknown as typeof fetch;
    return { seen, api: createElevenLabsApi("key", f) };
  };
  it("sends the API key and the right paths", async () => {
    const { seen, api } = record();
    await api.createAgent({ name: "x" });
    await api.updateAgent("a/1", { name: "y" });
    await api.createKnowledgeText({ name: "n", text: "t" });
    await api.deleteKnowledge("kb1");
    await api.createWebhookTool({ type: "webhook" });
    expect(seen.map((s) => `${s.init.method} ${s.url.replace("https://api.elevenlabs.io", "")}`)).toEqual([
      "POST /v1/convai/agents/create", "PATCH /v1/convai/agents/a%2F1", "POST /v1/convai/knowledge-base/text",
      "DELETE /v1/convai/knowledge-base/kb1?force=true", "POST /v1/convai/tools",
    ]);
    expect((seen[0].init.headers as Record<string, string>)["xi-api-key"]).toBe("key");
    expect(JSON.parse(seen[4].init.body as string)).toEqual({ tool_config: { type: "webhook" } });
  });
  it("sends a WhatsApp template in the shape ElevenLabs documents", async () => {
    const { seen, api } = record();
    await api.sendWhatsappTemplate({ phoneNumberId: "524", userId: "97336001122", templateName: "booking_confirmation", languageCode: "en",
      params: [{ type: "body", parameters: [{ type: "text", parameter_name: "name", text: "Sara" }] }], agentId: "agent_1", dynamicVariables: { channel: "whatsapp" } });
    expect(seen[0].url).toBe("https://api.elevenlabs.io/v1/convai/whatsapp/outbound-message");
    expect(JSON.parse(seen[0].init.body as string)).toEqual({
      whatsapp_phone_number_id: "524", whatsapp_user_id: "97336001122", template_name: "booking_confirmation", template_language_code: "en",
      template_params: [{ type: "body", parameters: [{ type: "text", parameter_name: "name", text: "Sara" }] }], agent_id: "agent_1",
      conversation_initiation_client_data: { dynamic_variables: { channel: "whatsapp" } },
    });
  });
  it("turns an error response into an ElevenLabsError", async () => {
    const api = createElevenLabsApi("k", (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch);
    await expect(api.createAgent({})).rejects.toMatchObject({ status: 401, detail: "nope" });
  });
});
