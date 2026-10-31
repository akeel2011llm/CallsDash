import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { STARTER_TESTS, TEST_LIMITS, createAgentTestsApi, mapInvocation, readSuite, starterTests, testBody, testFromForm } from "@/lib/agent-tests";
import { dictionaries } from "@/lib/i18n";

type Call = { method: string; path: string; body: unknown };
function fakeFetch(reply: (c: Call) => { status?: number; json?: unknown }) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const c = { method: init.method ?? "GET", path: new URL(String(url)).pathname, body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    const r = reply(c);
    return new Response(r.json === undefined ? "" : JSON.stringify(r.json), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const get = (o: Record<string, string>) => (k: string) => o[k] ?? "";
const input = { name: "Hours", says: "When are you open?", success: "Gives the hours.", good: "", bad: "We are open 24/7." };

describe("agent tests: the form", () => {
  it("tidies the text and says what is missing or too long", () => {
    expect(testFromForm(get({ name: " Hours ", says: "When\r\nopen?", success: "Gives  the hours" }))).toEqual({ ok: true, value: { name: "Hours", says: "When\nopen?", success: "Gives the hours", good: "", bad: "" } });
    expect(testFromForm(get({ says: "x", success: "y" }))).toEqual({ ok: false, error: "name" });
    expect(testFromForm(get({ name: "x", success: "y" }))).toEqual({ ok: false, error: "says" });
    expect(testFromForm(get({ name: "x", says: "y" }))).toEqual({ ok: false, error: "success" });
    expect(testFromForm(get({ name: "x", says: "y", success: "z", bad: "b".repeat(TEST_LIMITS.example + 1) }))).toEqual({ ok: false, error: "long" });
  });

  it("builds ElevenLabs' reply test, with examples only when given", () => {
    expect(testBody(input)).toEqual({
      type: "llm", name: "Hours", chat_history: [{ role: "user", message: "When are you open?", time_in_call_secs: 0 }],
      success_condition: "Gives the hours.", success_examples: [], failure_examples: [{ response: "We are open 24/7.", type: "failure" }],
    });
  });
});

describe("agent tests: the stored list", () => {
  it("keeps only well-formed tests and a valid last run", () => {
    const s = readSuite({ tests: [{ id: "t1", name: "A", says: "x", success: "y", createdAt: "2026-10-31" }, { id: "../bad", name: "B" }, { id: "t2" }], lastRun: { id: "inv_1", at: "2026-10-31T10:00:00Z" } });
    expect(s.tests.map((t) => t.id)).toEqual(["t1"]);
    expect(s.lastRun?.id).toBe("inv_1");
    expect(readSuite(null)).toEqual({ tests: [] });
    expect(readSuite({ lastRun: { id: "a/b" } }).lastRun).toBeUndefined();
  });
});

describe("agent tests: ElevenLabs requests", () => {
  it("creates, edits, deletes, runs and reads results", async () => {
    const { f, calls } = fakeFetch((c) => {
      if (c.path.endsWith("/create")) return { json: { id: "test_1" } };
      if (c.path.endsWith("/run-tests")) return { json: { id: "inv_1", test_runs: [{ test_id: "test_1", status: "pending", test_invocation_id: "inv_1" }] } };
      if (c.path.startsWith("/v1/convai/test-invocations/")) return { json: { id: "inv_1", test_runs: [
        { test_id: "test_1", status: "failed", agent_responses: [{ role: "agent", message: "We are open 24/7." }], condition_result: { result: "failure", rationale: { summary: "It invented the hours." } } },
        { test_id: "test_2", test_name: "Arabic", status: "passed" },
      ] } };
      if (c.method === "DELETE") return { status: 404, json: { detail: "gone" } };
      return { json: {} };
    });
    const api = createAgentTestsApi("k", f);
    expect(await api.create(input)).toBe("test_1");
    await api.update("test_1", input);
    await api.remove("test_1"); // a test already gone counts as deleted
    expect(await api.run("agent_1", ["test_1", "test_2"])).toBe("inv_1");
    const r = await api.results("inv_1", { test_1: "Hours" });
    expect(r).toEqual({ id: "inv_1", done: true, runs: [
      { testId: "test_1", name: "Hours", status: "failed", why: "It invented the hours.", reply: "We are open 24/7." },
      { testId: "test_2", name: "Arabic", status: "passed", why: "", reply: "" },
    ] });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /v1/convai/agent-testing/create",
      "PUT /v1/convai/agent-testing/test_1",
      "DELETE /v1/convai/agent-testing/test_1",
      "POST /v1/convai/agents/agent_1/run-tests",
      "GET /v1/convai/test-invocations/inv_1",
    ]);
    expect(calls[3].body).toEqual({ tests: [{ test_id: "test_1" }, { test_id: "test_2" }] });
  });

  it("refuses odd ids and an empty run before calling anything", async () => {
    const { f, calls } = fakeFetch(() => ({ json: {} }));
    const api = createAgentTestsApi("k", f);
    await expect(api.run("agent_1", ["a/b"])).rejects.toThrow("bad id");
    await expect(api.run("agent_1", [])).rejects.toThrow("no tests");
    await expect(api.results("../x")).rejects.toThrow("bad id");
    expect(calls).toHaveLength(0);
  });

  it("a run with a test still pending is not done; a cancelled run is", () => {
    expect(mapInvocation({ id: "i", test_runs: [{ test_id: "a", status: "passed" }, { test_id: "b", status: "pending" }] }).done).toBe(false);
    expect(mapInvocation({ id: "i", cancelled: true, test_runs: [{ test_id: "b", status: "pending" }] }).done).toBe(true);
    expect(mapInvocation({ id: "i", test_runs: [{ test_id: "b", status: "weird" }] }).runs[0].status).toBe("pending");
  });
});

describe("agent tests: ready-made tests", () => {
  const salon = { customerOne: "client", staffOne: "stylist", staffMany: "stylists", place: "salon" };
  it("use the client's words, and only a clinic gets the medical advice test", () => {
    const tests = starterTests(salon, false, (k) => k);
    expect(tests.map((t) => t.name)).toEqual(STARTER_TESTS.filter((k) => k !== "medical"));
    for (const t of tests) {
      expect(`${t.says} ${t.success}`).not.toMatch(/patient|doctor|clinic/i);
      expect(testFromForm(get(t as unknown as Record<string, string>)).ok).toBe(true);
    }
    expect(tests.find((t) => t.name === "noInvent")?.success).toContain("stylists");
    expect(starterTests(salon, true, (k) => k).map((t) => t.name)).toContain("medical");
  });
  it("have a name in English and Arabic", () => {
    for (const k of STARTER_TESTS) for (const d of [dictionaries.en, dictionaries.ar] as Record<string, string>[]) expect(d[`tests.starter.${k}`]).toBeTruthy();
  });
});
