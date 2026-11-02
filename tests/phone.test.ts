import { describe, expect, it } from "vitest";
import { cleanPhone, connectFromForm, createPhoneApi, mapLine } from "@/lib/phone";

const get = (o: Record<string, string>) => (k: string) => o[k] ?? "";
const SID = "AC" + "a1".repeat(16);

describe("phone numbers", () => {
  it("cleans to international form", () => {
    expect(cleanPhone("+1 (276) 900-1901")).toBe("+12769001901");
    expect(cleanPhone("00973 3337 4646")).toBe("+97333374646");
    expect(cleanPhone("33374646")).toBeNull();
    expect(cleanPhone("+0123456789")).toBeNull();
    expect(cleanPhone("+1234")).toBeNull();
  });
  it("reads a number back from ElevenLabs", () => {
    expect(mapLine({ phone_number_id: "ph_1", phone_number: "+12769001901", label: "Main", supports_inbound: true, supports_outbound: false, assigned_agent: { agent_id: "agent_1", agent_name: "Al Noor" } }))
      .toEqual({ id: "ph_1", number: "+12769001901", label: "Main", inbound: true, outbound: false, agentId: "agent_1", agentName: "Al Noor" });
    expect(mapLine({ phone_number: "x" })).toBeNull();
  });
});

describe("phone: the connect form", () => {
  const ok = { number: "+1 276 900 1901", sid: SID, token: "t".repeat(32), label: " Main  line " };
  it("accepts a good form and tidies it", () => {
    expect(connectFromForm(get(ok))).toEqual({ ok: true, value: { number: "+12769001901", label: "Main line", sid: SID, token: "t".repeat(32) } });
    expect(connectFromForm(get({ ...ok, label: "" }))).toMatchObject({ ok: true, value: { label: "+12769001901" } });
    expect(connectFromForm(get({ ...ok, sid: "SK" + "0".repeat(32) })).ok).toBe(true);
  });
  it("names the wrong field", () => {
    expect(connectFromForm(get({ ...ok, number: "12" }))).toEqual({ ok: false, error: "number" });
    expect(connectFromForm(get({ ...ok, sid: "AC123" }))).toEqual({ ok: false, error: "sid" });
    expect(connectFromForm(get({ ...ok, token: "short" }))).toEqual({ ok: false, error: "token" });
    expect(connectFromForm(get({ ...ok, token: "has space in the token here xx" }))).toEqual({ ok: false, error: "token" });
  });
});

describe("phone: requests", () => {
  const calls: { method: string; path: string; body: any }[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    calls.push({ method: init.method ?? "GET", path, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (path.endsWith("/phone-numbers") && init.method === "POST") return new Response(JSON.stringify({ phone_number_id: "ph_9" }), { status: 200 });
    if (path.endsWith("/outbound-call")) return new Response(JSON.stringify({ success: true, message: "Success", conversation_id: "conv_1" }), { status: 200 });
    if (path.endsWith("/phone-numbers")) return new Response(JSON.stringify([{ phone_number_id: "ph_9", phone_number: "+12769001901" }, { nope: 1 }]), { status: 200 });
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  const api = createPhoneApi("k", f);

  it("connects, lists, assigns, calls and removes", async () => {
    expect(await api.connect({ number: "+12769001901", label: "Main", sid: SID, token: "t".repeat(32) }, "agent_1")).toBe("ph_9");
    expect(calls[0]).toMatchObject({ method: "POST", path: "/v1/convai/phone-numbers", body: { provider: "twilio", phone_number: "+12769001901", sid: SID, agent_id: "agent_1", supports_inbound: true, supports_outbound: true } });
    expect((await api.list()).map((l) => l.id)).toEqual(["ph_9"]);
    await api.assign("ph_9", "agent_2");
    expect(calls.at(-1)).toMatchObject({ method: "PATCH", path: "/v1/convai/phone-numbers/ph_9", body: { agent_id: "agent_2" } });
    expect(await api.call("agent_2", "ph_9", "+97333000000")).toEqual({ ok: true, message: "Success", conversationId: "conv_1" });
    expect(calls.at(-1)).toMatchObject({ method: "POST", path: "/v1/convai/twilio/outbound-call", body: { agent_id: "agent_2", agent_phone_number_id: "ph_9", to_number: "+97333000000" } });
    await api.remove("ph_9");
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", path: "/v1/convai/phone-numbers/ph_9" });
  });
  it("refuses unsafe ids", async () => {
    await expect(api.read("../x")).rejects.toThrow("bad id");
    await expect(api.call("agent_1", "a/b", "+97333000000")).rejects.toThrow("bad id");
  });
});
