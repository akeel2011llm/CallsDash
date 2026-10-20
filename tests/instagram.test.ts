import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { chunkText, handleInbound, handleReply, isMetaMediaUrl, parseMetaPayload, verifyMetaSignature, type BridgeDeps } from "@/lib/instagram";
import type { ElevenLabsApi } from "@/lib/elevenlabs-api";
import { createPgData, type Db, type Q } from "@/lib/data/pg";
import { makeDb } from "./helpers/pgdb";

describe("Meta webhook parsing", () => {
  const payload = (messaging: unknown[]) => ({ object: "instagram", entry: [{ id: "IG1", time: 1, messaging }] });
  it("reads text, voice notes and unsupported attachments, and drops echoes and our own messages", () => {
    const r = parseMetaPayload(payload([
      { sender: { id: "U1" }, recipient: { id: "IG1" }, message: { mid: "m1", text: " Hello " } },
      { sender: { id: "U2" }, recipient: { id: "IG1" }, message: { mid: "m2", attachments: [{ type: "audio", payload: { url: "https://cdn.fbsbx.com/a.mp4" } }] } },
      { sender: { id: "U3" }, recipient: { id: "IG1" }, message: { mid: "m3", attachments: [{ type: "image", payload: { url: "https://x" } }] } },
      { sender: { id: "IG1" }, recipient: { id: "U1" }, message: { mid: "m4", text: "our reply", is_echo: true } },
      { sender: { id: "IG1" }, recipient: { id: "U1" }, message: { mid: "m5", text: "from us" } },
      { sender: { id: "U4" }, recipient: { id: "IG1" }, read: { mid: "m1" } },
    ]));
    expect(r).toEqual([
      { accountId: "IG1", senderId: "U1", mid: "m1", text: "Hello", audioUrl: undefined, unsupported: false },
      { accountId: "IG1", senderId: "U2", mid: "m2", text: undefined, audioUrl: "https://cdn.fbsbx.com/a.mp4", unsupported: false },
      { accountId: "IG1", senderId: "U3", mid: "m3", text: undefined, audioUrl: undefined, unsupported: true },
    ]);
  });
  it("ignores other products and junk", () => {
    expect(parseMetaPayload({ object: "page", entry: [] })).toEqual([]);
    expect(parseMetaPayload(null as never)).toEqual([]);
    expect(parseMetaPayload({ object: "instagram", entry: [{ id: "x", messaging: "nope" }] })).toEqual([]);
  });
  it("verifies Meta's signature", () => {
    const raw = '{"a":1}', sig = "sha256=" + createHmac("sha256", "app-secret").update(raw).digest("hex");
    expect(verifyMetaSignature(raw, sig, "app-secret")).toBe(true);
    expect(verifyMetaSignature(raw, sig, "other")).toBe(false);
    expect(verifyMetaSignature(raw + " ", sig, "app-secret")).toBe(false);
    expect(verifyMetaSignature(raw, null, "app-secret")).toBe(false);
    expect(verifyMetaSignature(raw, "sha256=zz", "app-secret")).toBe(false);
  });
});

describe("helpers", () => {
  it("splits long answers under Instagram's limit without losing words", () => {
    const text = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const parts = chunkText(text);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 950)).toBe(true);
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(text);
    expect(chunkText("short")).toEqual(["short"]);
    expect(chunkText("x".repeat(2000)).every((p) => p.length <= 950)).toBe(true);
  });
  it("only fetches voice notes from Meta's media hosts", () => {
    expect(isMetaMediaUrl("https://lookaside.fbsbx.com/x")).toBe(true);
    expect(isMetaMediaUrl("https://scontent.cdninstagram.com/x")).toBe(true);
    for (const u of ["http://cdn.fbsbx.com/x", "https://evil.com/x", "https://fbsbx.com.evil.com/x", "https://169.254.169.254/", "file:///etc/passwd", "nope"]) expect(isMetaMediaUrl(u), u).toBe(false);
  });
});

async function setup(over: { instagram?: "connected" | "off"; balance?: boolean } = {}) {
  const pg = await makeDb();
  const q: Q = async (sql, params) => (await pg.query(sql, params as unknown[])).rows as never;
  const db: Db = { q, tx: (fn) => pg.transaction((tx) => fn(async (sql, params) => (await tx.query(sql, params as unknown[])).rows as never)) };
  const data = createPgData(db);
  const t = await data.createTenant({ name: "Gram Clinic", nameAr: "", color: "#112233", domain: "gram.example.bh", planType: "package", actor: "admin" });
  await data.setIntegrations(t.id, { instagram: { accountId: "IG1", username: "gram", inboundUrl: "https://api.elevenlabs.io/v1/convai/api-integrations/custom_channel/triggers/trig_1/async_message" } }, "admin");
  await data.setChannelStatus(t.id, "instagram", over.instagram ?? "connected", "admin");
  await data.setSecrets(t.id, { instagramToken: "ig-token", instagramInboundSecret: "inbound", instagramReplySecret: "reply-secret" });
  if (over.balance === false) await pg.query(`update credit_batches set remaining = 0 where tenant_id = $1`, [t.id]);
  const calls: { url: string; init: RequestInit }[] = [];
  let convN = 0;
  const handlers: ((url: string, init: RequestInit) => Response | undefined)[] = [];
  const fakeFetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    for (const h of handlers) { const r = h(url, init); if (r) return r; }
    if (url.includes("async_message")) return new Response(JSON.stringify({ conversation_id: `conv_${++convN}`, status: "queued" }), { status: 202 });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  const transcribed: string[] = [];
  const api = { transcribe: async () => { transcribed.push("x"); return { text: "I need an appointment" }; } } as unknown as ElevenLabsApi;
  let clock = Date.parse("2026-10-20T10:00:00Z");
  const deps: BridgeDeps = { data, api, fetch: fakeFetch, graphBase: "https://graph.test/v1", now: () => new Date(clock) };
  return { data, t, deps, calls, handlers, transcribed, advance: (h: number) => { clock += h * 3_600_000; }, pg };
}
const body = (c: { init: RequestInit }) => JSON.parse(c.init.body as string);
const dm = { accountId: "IG1", senderId: "U1", mid: "m1", text: "Hi, I want to book" };
const sign = (raw: string, secret = "reply-secret", t = Math.floor(Date.now() / 1000)) => `t=${t},v0=${createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}`;

describe("Instagram inbound", () => {
  it("passes a message to the agent with the secret, a dedupe id and today's facts, and remembers the conversation", async () => {
    const { deps, calls, data, t } = await setup();
    expect(await handleInbound(deps, dm)).toBe("forwarded");
    const c = calls[0];
    expect(c.url).toContain("/triggers/trig_1/async_message");
    expect((c.init.headers as Record<string, string>)["X-Webhook-Secret"]).toBe("inbound");
    expect(body(c)).toMatchObject({ data: { type: "user_message", text: "Hi, I want to book", user_identifier: "U1" }, user_message_id: "m1", dynamic_variables: { channel: "instagram", open_now: expect.any(String) } });
    expect(body(c).conversation_id).toBeUndefined();
    expect((await data.getChatSession(t.id, "instagram", "U1"))?.conversationId).toBe("conv_1");
  });
  it("continues the same conversation within 12 hours and starts a new one after", async () => {
    const { deps, calls, advance } = await setup();
    await handleInbound(deps, dm);
    advance(2);
    await handleInbound(deps, { ...dm, mid: "m2", text: "Tuesday please" });
    expect(body(calls[1]).conversation_id).toBe("conv_1");
    advance(13);
    await handleInbound(deps, { ...dm, mid: "m3", text: "Hello again" });
    expect(body(calls[2]).conversation_id).toBeUndefined();
  });
  it("transcribes a voice note and sends the text", async () => {
    const { deps, calls, handlers, transcribed } = await setup();
    handlers.push((url) => (url.startsWith("https://cdn.fbsbx.com") ? new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/mp4" } }) : undefined));
    expect(await handleInbound(deps, { accountId: "IG1", senderId: "U1", mid: "m9", audioUrl: "https://cdn.fbsbx.com/a.mp4" })).toBe("forwarded");
    expect(transcribed).toHaveLength(1);
    expect(body(calls.find((c) => c.url.includes("async_message"))!).data.text).toBe("I need an appointment");
  });
  it("does not fetch a voice note from a host that is not Meta's", async () => {
    const { deps, calls } = await setup();
    expect(await handleInbound(deps, { accountId: "IG1", senderId: "U1", mid: "m9", audioUrl: "https://evil.example/a.mp4" })).toBe("answered_directly");
    expect(calls.some((c) => c.url.startsWith("https://evil"))).toBe(false);
    expect(calls.some((c) => c.url.includes("async_message"))).toBe(false);
  });
  it("answers images and stickers politely without bothering the agent", async () => {
    const { deps, calls } = await setup();
    expect(await handleInbound(deps, { accountId: "IG1", senderId: "U1", mid: "m1", unsupported: true })).toBe("answered_directly");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://graph.test/v1/IG1/messages");
    expect(body(calls[0]).message.text).toContain("text and voice notes");
  });
  it("tells people the assistant is paused when the client has no credits", async () => {
    const { deps, calls } = await setup({ balance: false });
    expect(await handleInbound(deps, dm)).toBe("answered_directly");
    expect(calls.some((c) => c.url.includes("async_message"))).toBe(false);
    expect(body(calls[0]).message.text).toContain("not available");
  });
  it("ignores accounts that are unknown or whose channel is off", async () => {
    const { deps, calls } = await setup({ instagram: "off" });
    expect(await handleInbound(deps, dm)).toBe("ignored");
    expect(await handleInbound(deps, { ...dm, accountId: "OTHER" })).toBe("ignored");
    expect(calls).toHaveLength(0);
  });
  it("apologises, logs and raises an alert when ElevenLabs refuses", async () => {
    const { deps, calls, handlers, data, t } = await setup();
    handlers.push((url) => (url.includes("async_message") ? new Response("bad secret", { status: 401 }) : undefined));
    expect(await handleInbound(deps, dm)).toBe("ignored");
    expect(body(calls[calls.length - 1]).message.text).toContain("something went wrong");
    expect((await data.getAlerts(t.id)).some((a) => a.message.includes("Instagram"))).toBe(true);
  });
});

describe("Instagram replies", () => {
  const reply = (conv: string, agentText: string, extra: unknown[] = [], status = "completed") =>
    JSON.stringify({ version: "1", conversation_id: conv, user_message_ids: ["m1"], status, data: [{ type: "agent_response", event: { agent_response: agentText } }, ...extra], error: null });

  it("sends the agent's answer to the right person", async () => {
    const { deps, calls, t } = await setup();
    await handleInbound(deps, dm);
    calls.length = 0;
    const raw = reply("conv_1", "We have Wednesday at 10:30.");
    const r = await handleReply(deps, "gram-clinic", raw, sign(raw));
    expect(r.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://graph.test/v1/IG1/messages");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer ig-token");
    expect(body(calls[0])).toEqual({ recipient: { id: "U1" }, message: { text: "We have Wednesday at 10:30." } });
    expect(t.slug).toBe("gram-clinic");
  });
  it("joins several utterances and splits very long ones", async () => {
    const { deps, calls } = await setup();
    await handleInbound(deps, dm);
    calls.length = 0;
    const raw = reply("conv_1", "First part.", [{ type: "agent_response", event: { agent_response: "Second part. " + "word ".repeat(300) } }]);
    await handleReply(deps, "gram-clinic", raw, sign(raw));
    expect(calls.length).toBeGreaterThan(1);
    expect(body(calls[0]).message.text.startsWith("First part.\n\nSecond part.")).toBe(true);
  });
  it("starts a fresh conversation after the agent ends the call", async () => {
    const { deps, data, t } = await setup();
    await handleInbound(deps, dm);
    const raw = reply("conv_1", "Goodbye!", [{ type: "agent_tool_response", event: { tool_name: "end_call", status: "success" } }]);
    await handleReply(deps, "gram-clinic", raw, sign(raw));
    expect(await data.getChatSession(t.id, "instagram", "U1")).toBeUndefined();
  });
  it("rejects a wrong or missing signature, and another client's slug", async () => {
    const { deps, calls } = await setup();
    await handleInbound(deps, dm);
    calls.length = 0;
    const raw = reply("conv_1", "hi");
    expect((await handleReply(deps, "gram-clinic", raw, sign(raw, "wrong"))).status).toBe(401);
    expect((await handleReply(deps, "gram-clinic", raw, null)).status).toBe(401);
    expect((await handleReply(deps, "nobody", raw, sign(raw))).status).toBe(404);
    expect(calls).toHaveLength(0);
  });
  it("ignores a reply for a conversation it does not know", async () => {
    const { deps, calls } = await setup();
    const raw = reply("conv_x", "hi");
    expect(await handleReply(deps, "gram-clinic", raw, sign(raw))).toEqual({ status: 200, body: { ok: true, ignored: true } });
    expect(calls).toHaveLength(0);
  });
  it("tells the person and logs when ElevenLabs reports a failed turn", async () => {
    const { deps, calls, data, t } = await setup();
    await handleInbound(deps, dm);
    calls.length = 0;
    const raw = JSON.stringify({ version: "1", conversation_id: "conv_1", status: "failed", data: [], error: "llm timeout" });
    await handleReply(deps, "gram-clinic", raw, sign(raw));
    expect(body(calls[0]).message.text).toContain("something went wrong");
    expect((await data.getAudit(t.id)).some((a) => a.action.includes("failed Instagram turn"))).toBe(true);
  });
  it("raises an alert when Instagram refuses the message (for example an expired token)", async () => {
    const { deps, handlers, data, t } = await setup();
    await handleInbound(deps, dm);
    handlers.push((url) => (url.startsWith("https://graph.test") ? new Response("token expired", { status: 400 }) : undefined));
    const raw = reply("conv_1", "hello");
    expect((await handleReply(deps, "gram-clinic", raw, sign(raw))).status).toBe(200); // still acknowledged, so ElevenLabs does not retry and double-send
    expect((await data.getAlerts(t.id)).some((a) => a.message.includes("token"))).toBe(true);
  });
});
