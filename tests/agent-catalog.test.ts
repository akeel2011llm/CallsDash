import { describe, expect, it } from "vitest";
import {
  LLM_CATALOG, RETIRES, acceptsTemperature, daysToRetirement, defaultLlm, estimateUsd, isCheckpoint, llmMeta, modelRows, prettyModel, providerOf,
  ttsAllowed, ttsFor, ttsMeta, USAGE, type RowsInput,
} from "@/lib/agent-catalog";
import type { LlmInfo } from "@/lib/elevenlabs-catalog";

const unknown = { perMinute: 0.02, perMessage: 0.001 };
const input = (over: Partial<RowsInput> = {}): RowsInput => ({ live: [], prices: [], promptChars: 6000, unknown, today: "2026-10-21", ...over });
const info = (id: string, more: Partial<LlmInfo> = {}): LlmInfo => ({ id, reasoningEfforts: [], ...more });

describe("model names", () => {
  it("knows who makes a model", () => {
    expect(providerOf("gpt-6-luna")).toBe("openai");
    expect(providerOf("gemini-3.5-flash-lite")).toBe("google");
    expect(providerOf("claude-sonnet-5-5")).toBe("anthropic");
    expect(providerOf("glm-52")).toBe("elevenlabs");
    expect(providerOf("deepseek-v41-flash")).toBe("elevenlabs");
    expect(providerOf("custom-llm")).toBe("custom");
    expect(providerOf("mystery")).toBe("open");
  });
  it("makes a readable name for a model it has not heard of", () => {
    expect(prettyModel("claude-sonnet-5-5")).toBe("Claude Sonnet 5.5");
    expect(prettyModel("gpt-7-ultra")).toBe("GPT-7 Ultra");
    expect(llmMeta("gpt-6-luna").label).toBe("GPT-6 Luna");
    expect(llmMeta("brand-new-model").label).toBe("Brand New Model");
  });
  it("tells a pinned copy from a model", () => {
    for (const id of ["gpt-4o-2024-11-20", "gemini-2.0-flash-001", "gemini-2.5-flash-preview-09-2025", "claude-3-5-sonnet@20241022"]) expect(isCheckpoint(id)).toBe(true);
    for (const id of ["gpt-6-luna", "gemini-3.5-flash-lite", "claude-sonnet-5-5", "glm-52", "gpt-5.2-chat-latest"]) expect(isCheckpoint(id)).toBe(false);
  });
  it("lists every model once", () => {
    const ids = LLM_CATALOG.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("uses the server's model as the default", () => {
    const keep = process.env.ELEVENLABS_LLM;
    delete process.env.ELEVENLABS_LLM;
    expect(defaultLlm()).toBe("gemini-2.5-flash");
    process.env.ELEVENLABS_LLM = "gpt-6-luna";
    expect(defaultLlm()).toBe("gpt-6-luna");
    if (keep === undefined) delete process.env.ELEVENLABS_LLM; else process.env.ELEVENLABS_LLM = keep;
  });
});

describe("temperature", () => {
  it("is left out for the models that reject it", () => {
    for (const id of ["claude-sonnet-5-5", "claude-sonnet-5", "claude-opus-5", "claude-opus-5-5", "claude-opus-4-7", "claude-opus-4-8", "claude-haiku-5-5"]) expect(acceptsTemperature(id), id).toBe(false);
    for (const id of ["claude-sonnet-4-6", "claude-sonnet-4-5", "claude-haiku-4-5", "claude-opus-4-6", "gpt-6-luna", "gemini-2.5-flash", "glm-52"]) expect(acceptsTemperature(id), id).toBe(true);
  });
});

describe("retirement", () => {
  it("counts the days to a provider's announced shutdown", () => {
    expect(daysToRetirement("gpt-4.1-nano", "2026-10-21")).toBe(2);
    expect(daysToRetirement("gpt-4o", "2026-10-21")).toBe(85);
    expect(daysToRetirement("gpt-6-luna", "2026-10-21")).toBeNull();
    expect(daysToRetirement("gpt-4.1-nano", "2026-10-25")).toBe(-2);
  });
  it("only names models that exist in the catalogue or are known old ones", () => {
    for (const id of Object.keys(RETIRES)) expect(Date.parse(RETIRES[id]), id).toBeGreaterThan(0);
  });
});

describe("the built-in price estimate", () => {
  it("grows with the model's price and with the size of the instructions", () => {
    const cheap = estimateUsd([0.1, 0.5, 0.01], 6000);
    const dear = estimateUsd([10, 50, 1], 6000);
    expect(dear.perMinute).toBeGreaterThan(cheap.perMinute * 50);
    expect(estimateUsd([0.1, 0.5, 0.01], 24000).perMinute).toBeGreaterThan(cheap.perMinute);
  });
  it("works out a voice minute as six turns of the conversation", () => {
    // 6000 characters = 1500 tokens + 600 for the tools = 2100 tokens; 80% read from the cache
    const turn = (2100 * (0.2 * 2 + 0.8 * 0.2) + 300 * 2 + 60 * 10) / 1_000_000;
    expect(estimateUsd([2, 10, 0.2], 6000).perMinute).toBeCloseTo(USAGE.turnsPerMinute * turn, 10);
  });
  it("costs a chat message less than a voice minute", () => {
    const e = estimateUsd([2.2, 11, 0.11], 6000);
    expect(e.perMessage).toBeLessThan(e.perMinute);
    expect(e.perMessage).toBeGreaterThan(0);
  });
  it("makes the cheapest recommended model cost a fraction of a cent per minute", () => {
    expect(estimateUsd([0.1, 0.5, 0.01], 6000).perMinute).toBeLessThan(0.002);
  });
});

describe("modelRows", () => {
  it("falls back to the built-in catalogue, with estimated prices, when ElevenLabs' list is out of reach", () => {
    const rows = modelRows(input());
    expect(rows.length).toBe(LLM_CATALOG.length - Object.keys(RETIRES).filter((id) => LLM_CATALOG.some((m) => m.id === id) && (daysToRetirement(id, "2026-10-21") ?? 1) < 0).length);
    expect(rows.every((r) => r.price.source === "estimate")).toBe(true);
    expect(rows[0].advice).toBeTruthy(); // ElevenLabs' recommendations come first
  });
  it("lists ElevenLabs' models and prices them with its own calculator where it can", () => {
    const rows = modelRows(input({
      live: [info("gpt-6-luna", { maxOutputTokens: 16000, reasoningEfforts: ["low", "high"] }), info("mystery-model"), info("custom-llm")],
      prices: [{ llm: "gpt-6-luna", perMinute: 0.004, perMessage: 0.0002 }],
    }));
    expect(rows.map((r) => r.id).sort()).toEqual(["gpt-6-luna", "mystery-model"]);
    const luna = rows.find((r) => r.id === "gpt-6-luna")!;
    expect(luna).toMatchObject({ maxOutputTokens: 16000, reasoningEfforts: ["low", "high"], price: { perMinute: 0.004, perMessage: 0.0002, source: "elevenlabs" } });
    expect(rows.find((r) => r.id === "mystery-model")!.price).toEqual({ ...unknown, source: "unknown" });
  });
  it("hides retired models and pinned copies, but keeps one a client still uses", () => {
    const live = [info("gpt-6-luna"), info("gpt-4o-2024-11-20"), info("old-one", { deprecated: { isDeprecated: true, inWarning: false } }), info("gpt-4.1-nano")];
    expect(modelRows(input({ live, today: "2026-10-25" })).map((r) => r.id)).toEqual(["gpt-6-luna"]);
    expect(modelRows(input({ live, today: "2026-10-21" })).map((r) => r.id)).toEqual(["gpt-6-luna", "gpt-4.1-nano"]); // still working for two more days
    const kept = modelRows(input({ live, today: "2026-10-25", keep: ["old-one", "gpt-4o-2024-11-20", "gpt-4.1-nano"] })).map((r) => r.id);
    expect(kept).toEqual(expect.arrayContaining(["gpt-6-luna", "old-one", "gpt-4o-2024-11-20", "gpt-4.1-nano"]));
  });
  it("lists the model a client uses even if ElevenLabs no longer offers it", () => {
    expect(modelRows(input({ live: [info("gpt-6-luna")], keep: ["vanished-model"] })).map((r) => r.id)).toContain("vanished-model");
  });
  it("keeps ElevenLabs' notice that a model is going away and the provider's date", () => {
    const rows = modelRows(input({ live: [info("gpt-4o", { deprecated: { isDeprecated: false, inWarning: true, replacement: "gpt-6-luna", date: "2027-01-14" } })] }));
    expect(rows[0]).toMatchObject({ retires: "2027-01-14", deprecated: { inWarning: true, replacement: "gpt-6-luna" } });
  });
  it("marks the models that cannot take a temperature", () => {
    const rows = modelRows(input({ live: [info("claude-sonnet-5-5"), info("gpt-6-luna")] }));
    expect(rows.find((r) => r.id === "claude-sonnet-5-5")!.temperature).toBe(false);
    expect(rows.find((r) => r.id === "gpt-6-luna")!.temperature).toBe(true);
  });
  it("puts ElevenLabs' picks first, then the cheapest", () => {
    const rows = modelRows(input({ live: [info("claude-opus-5"), info("gemini-2.5-flash-lite"), info("gpt-6-luna"), info("claude-sonnet-5-5")] }));
    expect(rows.map((r) => r.id).slice(0, 2)).toEqual(["gpt-6-luna", "claude-sonnet-5-5"]);
    expect(rows.map((r) => r.id).slice(2)).toEqual(["gemini-2.5-flash-lite", "claude-opus-5"]);
  });
});

describe("voice models", () => {
  it("never offers an English-only model for Arabic", () => {
    expect(ttsFor("ar").map((m) => m.id)).not.toContain("eleven_flash_v2");
    expect(ttsAllowed("ar", "eleven_flash_v2")).toBe(false);
    expect(ttsAllowed("ar", "eleven_flash_v2_5")).toBe(true);
    expect(ttsAllowed("en", "eleven_flash_v2")).toBe(true);
  });
  it("offers Flash v2.5, Multilingual v2 and the v3 and v4 models for Arabic", () => {
    expect(ttsFor("ar").map((m) => m.id)).toEqual(["eleven_flash_v2_5", "eleven_multilingual_v2", "eleven_v3_conversational", "eleven_v4_turbo", "eleven_v4"]);
  });
  it("hides retired models unless a client still has one", () => {
    expect(ttsFor("en").map((m) => m.id)).not.toContain("eleven_turbo_v2");
    expect(ttsFor("en", "eleven_turbo_v2").map((m) => m.id)).toContain("eleven_turbo_v2");
    expect(ttsFor("ar").map((m) => m.id)).not.toContain("eleven_turbo_v2_5");
    expect(ttsFor("ar", "eleven_turbo_v2_5").map((m) => m.id)).toContain("eleven_turbo_v2_5");
  });
  it("keeps an unknown model on the English side only, and only if it is the one already in use", () => {
    expect(ttsAllowed("en", "eleven_future", "eleven_future")).toBe(true);
    expect(ttsAllowed("en", "eleven_future", "eleven_flash_v2")).toBe(false);
    expect(ttsAllowed("ar", "eleven_future", "eleven_future")).toBe(false);
  });
  it("marks the models that take part in expressive mode", () => {
    expect(ttsMeta("eleven_v4_turbo")?.expressive).toBe(true);
    expect(ttsMeta("eleven_flash_v2_5")?.expressive).toBeUndefined();
  });
});
