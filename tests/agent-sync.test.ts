import { describe, expect, it } from "vitest";
import { syncAgent, SyncError, type SyncDeps } from "@/lib/agent-sync";
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
    expect(r).toEqual({ agentId: "agent_1", created: true });
    expect(names(calls).filter((f) => f === "createWebhookTool")).toHaveLength(7);
    expect(names(calls)).toContain("createKnowledgeText");
    expect(names(calls)).toContain("createAgent");
    expect((await data.getAgent(tenant.id)).elevenLabsAgentId).toBe("agent_1");
    const t = (await data.getTenant(tenant.id))!;
    expect(t.integrations.elevenlabs?.kbDocId).toMatch(/^kb_/);
    expect(t.integrations.elevenlabs?.syncedAt).toBeTruthy();
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
