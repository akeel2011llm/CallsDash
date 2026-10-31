import { describe, expect, it } from "vitest";
import { buildExtras } from "@/lib/agent-extras";
import { STUDIO_DEFAULTS, applySection, parseSection, resetSection, studioOf } from "@/lib/agent-studio";
import { mapLiveAgent } from "@/lib/elevenlabs-catalog";
import {
  PROCEDURE_LIMITS, PROCEDURE_TEMPLATES, createProceduresApi, failureToShow, mapProcedure, procedureFromForm, procedureTemplate,
} from "@/lib/procedures";
import { readLiveValues } from "@/lib/studio-import";
import { BUILTIN_VALUES, recommendedFor } from "@/lib/studio-profiles";
import { agent } from "@/lib/seed";
import type { AgentSettings } from "@/lib/types";

type Call = { method: string; url: string; body: unknown };
function fakeFetch(reply: (c: Call) => { status?: number; json?: unknown }) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const c = { method: init.method ?? "GET", url: String(url), body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    const r = reply(c);
    return new Response(r.json === undefined ? "" : JSON.stringify(r.json), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("procedures: reading the form", () => {
  const get = (o: Record<string, string>) => (k: string) => o[k] ?? "";
  it("tidies the text and keeps the kind", () => {
    const r = procedureFromForm(get({ name: "  Handle   a complaint ", trigger: "When\nupset", type: "deterministic", content: "1. Listen\r\n2. Help\n" }));
    expect(r).toEqual({ ok: true, value: { name: "Handle a complaint", trigger: "When upset", type: "deterministic", content: "1. Listen\n2. Help" } });
  });
  it("defaults an unknown kind to free form", () => {
    const r = procedureFromForm(get({ name: "x", content: "y", type: "folder" }));
    expect(r.ok && r.value.type).toBe("free_form");
  });
  it("says what is missing or too long", () => {
    expect(procedureFromForm(get({ content: "y" }))).toEqual({ ok: false, error: "name" });
    expect(procedureFromForm(get({ name: "x" }))).toEqual({ ok: false, error: "content" });
    expect(procedureFromForm(get({ name: "x", content: "y".repeat(PROCEDURE_LIMITS.content + 1) }))).toEqual({ ok: false, error: "long" });
    expect(procedureFromForm(get({ name: "x".repeat(81), content: "y" }))).toEqual({ ok: false, error: "long" });
  });
});

describe("procedures: ElevenLabs requests", () => {
  it("finds the main branch, lists, reads the draft first, creates, edits, deletes and publishes", async () => {
    const { f, calls } = fakeFetch((c) => {
      if (c.method === "GET" && c.url.endsWith("/agents/agent_1")) return { json: { agent_id: "agent_1", main_branch_id: "br_main" } };
      if (c.method === "GET" && c.url.endsWith("/procedures")) return { json: { procedures: [{ procedure_id: "p1", name: "Complaint", trigger: "upset", type: "free_form", has_draft: true }, { name: "no id" }, { procedure_id: "f1", type: "folder" }] } };
      if (c.url.endsWith("/p1/draft") && c.method === "GET") return { json: { name: "Complaint", content: "1. Listen", type: "deterministic" } };
      if (c.method === "POST") return { json: { procedure_id: "p2" } };
      return { json: {} };
    });
    const api = createProceduresApi("k", f);
    expect(await api.mainBranch("agent_1")).toBe("br_main");
    const list = await api.list("agent_1", "br_main");
    expect(list).toEqual([
      { id: "p1", name: "Complaint", trigger: "upset", type: "free_form", draft: true },
      { id: "f1", name: "f1", trigger: "", type: "folder", draft: false },
    ]);
    expect(await api.get("agent_1", "br_main", "p1")).toMatchObject({ id: "p1", content: "1. Listen", type: "deterministic" });
    const input = { name: "Call back", trigger: "wants a person", type: "deterministic" as const, content: "1. Ask name" };
    expect(await api.create("agent_1", "br_main", input)).toBe("p2");
    await api.update("agent_1", "br_main", "p1", input);
    await api.remove("agent_1", "br_main", "p1");
    await api.publish("agent_1", "CallsDash: test");
    const path = (c: Call) => `${c.method} ${new URL(c.url).pathname}`;
    expect(calls.map(path)).toEqual([
      "GET /v1/convai/agents/agent_1",
      "GET /v1/convai/agents/agent_1/branches/br_main/procedures",
      "GET /v1/convai/agents/agent_1/branches/br_main/procedures/p1/draft",
      "POST /v1/convai/agents/agent_1/branches/br_main/procedures",
      "PATCH /v1/convai/agents/agent_1/branches/br_main/procedures/p1/draft",
      "DELETE /v1/convai/agents/agent_1/branches/br_main/procedures/p1",
      "PATCH /v1/convai/agents/agent_1",
    ]);
    expect(calls[3].body).toEqual({ name: "Call back", content: "1. Ask name", type: "deterministic", trigger: "wants a person" });
    // publishing never sends procedures, so the drafts go live as they are
    expect(calls[6].body).toEqual({ version_description: "CallsDash: test" });
  });

  it("falls back to the published version when there is no draft", async () => {
    const { f } = fakeFetch((c) => (c.url.endsWith("/draft") ? { status: 404, json: { detail: "no draft" } } : { json: { procedure_id: "p1", name: "Prices", content: "1. Quote" } }));
    expect(await createProceduresApi("k", f).get("a", "b", "p1")).toMatchObject({ name: "Prices", content: "1. Quote", draft: false });
  });

  it("refuses odd ids before calling anything, and says when there is no branch", async () => {
    const { f, calls } = fakeFetch(() => ({ json: {} }));
    const api = createProceduresApi("k", f);
    await expect(api.list("../x", "b")).rejects.toThrow("bad id");
    await expect(api.remove("a", "b", "p/1")).rejects.toThrow("bad id");
    expect(calls).toHaveLength(0);
    await expect(api.mainBranch("a")).rejects.toThrow(/branch/);
  });

  it("maps only entries with an id", () => {
    expect(mapProcedure({ name: "x" })).toBeNull();
    expect(mapProcedure("nope")).toBeNull();
  });
});

describe("procedures: templates and refusals", () => {
  it("every template uses the client's own words and fits the limits", () => {
    for (const id of PROCEDURE_TEMPLATES) {
      const p = procedureTemplate(id, { customer: "guest", staff: "stylist", place: "salon" });
      expect(p.name.length).toBeLessThanOrEqual(PROCEDURE_LIMITS.name);
      expect(p.content.length).toBeLessThanOrEqual(PROCEDURE_LIMITS.content);
      expect(`${p.trigger} ${p.content}`).not.toMatch(/patient|doctor|clinic/i);
    }
    expect(procedureTemplate("complaint", { customer: "guest", staff: "stylist", place: "salon" }).content).toContain("stylist");
  });
  it("shows ElevenLabs' reason for ten minutes only", () => {
    const at = new Date("2026-10-31T10:00:00Z").toISOString();
    expect(failureToShow({ detail: "Bad", at }, Date.parse(at) + 60_000)).toBe("Bad");
    expect(failureToShow({ detail: "Bad", at }, Date.parse(at) + 11 * 60_000)).toBeNull();
    expect(failureToShow(null)).toBeNull();
  });
});

describe("knowledge base search (RAG)", () => {
  const base = (): AgentSettings => agent("", "Al Noor");
  const form = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) f.append(k, v);
    return f;
  };
  const tenant = { name: "Al Noor", branding: { displayName: "Al Noor", displayNameAr: "", primaryColor: "#123456" }, retentionDays: 90, allowedDomains: [] };

  it("is off by default and is only sent once the section is saved", () => {
    expect(STUDIO_DEFAULTS.ragEnabled).toBe(false);
    expect(buildExtras({ tenant, doctors: [], settings: base() }).find((g) => g.name === "rag")).toBeUndefined();
  });

  it("reads the section form, keeps values in range and sends them", () => {
    const r = parseSection("knowledge", form({ ragEnabled: "on", ragEmbedding: "e5_mistral_7b_instruct", ragMaxLength: "50000", ragMaxChunks: "7" }), base());
    expect(r.errors).toEqual([]);
    expect(r.studio).toMatchObject({ ragEnabled: true, ragEmbedding: "e5_mistral_7b_instruct", ragMaxLength: 50000, ragMaxChunks: 7 });
    const settings = applySection(base(), "knowledge", r);
    const body = buildExtras({ tenant, doctors: [], settings }).find((g) => g.name === "rag")?.body as Record<string, any>;
    expect(body.conversation_config.agent.prompt.rag).toEqual({ enabled: true, embedding_model: "e5_mistral_7b_instruct", max_documents_length: 50000, max_retrieved_rag_chunks_count: 7 });
    expect(parseSection("knowledge", form({ ragEmbedding: "multilingual_e5_large_instruct", ragMaxLength: "999999", ragMaxChunks: "7" }), base()).errors.map((e) => e.field)).toEqual(["ragMaxLength"]);
  });

  it("refuses an unknown model and keeps the saved one, and reset puts the defaults back", () => {
    const r = parseSection("knowledge", form({ ragEnabled: "on", ragEmbedding: "nope", ragMaxLength: "50000", ragMaxChunks: "20" }), base());
    expect(r.errors.map((e) => e.field)).toEqual(["ragEmbedding"]);
    expect(r.studio.ragEmbedding).toBe("multilingual_e5_large_instruct");
    const back = studioOf(resetSection(applySection(base(), "knowledge", r), "knowledge"));
    expect(back.ragEnabled).toBe(STUDIO_DEFAULTS.ragEnabled);
    expect(back.ragMaxChunks).toBe(STUDIO_DEFAULTS.ragMaxChunks);
  });

  it("has recommended values and is read back and imported from ElevenLabs", () => {
    expect(recommendedFor("knowledge")).toMatchObject({ ragEmbedding: "multilingual_e5_large_instruct" });
    expect(BUILTIN_VALUES.recommended).toHaveProperty("ragEnabled");
    const live = mapLiveAgent({ conversation_config: { agent: { prompt: { rag: { enabled: true, embedding_model: "e5_mistral_7b_instruct", max_documents_length: 30000, max_retrieved_rag_chunks_count: 5 } } } } });
    expect(live).toMatchObject({ ragEnabled: true, ragEmbedding: "e5_mistral_7b_instruct", ragMaxLength: 30000, ragMaxChunks: 5 });
    const values = readLiveValues({ settings: base(), tenant, doctors: [], live });
    expect(values).toMatchObject({ ragEnabled: true, ragMaxChunks: 5 });
  });
});
