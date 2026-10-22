import { describe, expect, it } from "vitest";
import { loadModelBook, newCache, type StudioDeps } from "@/lib/studio-data";
import { MODELS_KEY, pricesKey } from "@/lib/pricing";
import { agent } from "@/lib/seed";
import type { CatalogApi, LlmInfo, LlmPrice } from "@/lib/elevenlabs-catalog";

const llm = (id: string): LlmInfo => ({ id, reasoningEfforts: [] });
const LLMS = [llm("gemini-2.5-flash"), llm("gpt-6-luna")];
const price = (perMinute: number): LlmPrice[] => [{ llm: "gemini-2.5-flash", perMinute, perMessage: perMinute / 10 }, { llm: "gpt-6-luna", perMinute: perMinute * 2, perMessage: perMinute / 5 }];

/** An in-memory data layer holding the saved settings, with a knowledge base of the given size per client. */
function setup(sizes: Record<string, number> = { a: 100, b: 100 }) {
  const settings = new Map<string, unknown>();
  const data: StudioDeps["data"] = {
    getAgent: async (id) => agent(`agent_${id}`, `Clinic ${id}`),
    getDoctors: async () => [],
    getKnowledge: async (id) => [{ id: "k", tenantId: id, question: "q".repeat(sizes[id] ?? 100), answer: "a", language: "en" }],
    getSetting: async (k) => settings.get(k),
    setSetting: async (k, v) => { settings.set(k, v); },
  };
  return { settings, data };
}

function catalog(over: Partial<CatalogApi> & { priceCalls?: number[] } = {}): CatalogApi {
  const noop = async () => { throw new Error("not used"); };
  return {
    searchVoices: noop, searchLibrary: noop, getVoices: noop, addLibraryVoice: noop, getAgent: noop,
    listLlms: async () => LLMS,
    llmPrices: async (i) => { over.priceCalls?.push(i.promptLength); return price(0.1); },
    ...over,
  } as CatalogApi;
}

describe("the model list and prices the studio keeps", () => {
  it("saves the model list once for everyone and the prices for the client being viewed", async () => {
    const { settings, data } = setup();
    const book = await loadModelBook({ data, catalog: catalog(), cache: newCache() }, "a");
    expect(book.source).toBe("live");
    expect(book.rows.find((r) => r.id === "gemini-2.5-flash")?.price).toMatchObject({ perMinute: 0.1, source: "elevenlabs" });
    expect((settings.get(MODELS_KEY) as { llms: unknown[] }).llms).toHaveLength(2);
    expect(settings.get(MODELS_KEY)).not.toHaveProperty("prices");
    const mine = settings.get(pricesKey("a")) as { promptChars: number; prices: LlmPrice[] };
    expect(mine.prices).toHaveLength(2);
    expect(mine.promptChars).toBeGreaterThan(0);
  });

  it("keeps a client's prices apart from another client's, even when ElevenLabs cannot be asked", async () => {
    const { data } = setup({ a: 100, b: 30_000 });
    // client A is priced while ElevenLabs works
    await loadModelBook({ data, catalog: catalog({ llmPrices: async () => price(0.5) }), cache: newCache() }, "a");
    // client B is looked at when the price call fails: it must not borrow A's prices
    const down = catalog({ llmPrices: async () => { throw new Error("price service down"); } });
    const b = await loadModelBook({ data, catalog: down, cache: newCache() }, "b");
    expect(b.source).toBe("live");
    expect(b.priceProblem).toBeTruthy();
    expect(b.rows.find((r) => r.id === "gemini-2.5-flash")?.price.source).toBe("estimate");
    // and A still gets its own last known prices
    const a = await loadModelBook({ data, catalog: down, cache: newCache() }, "a");
    expect(a.rows.find((r) => r.id === "gemini-2.5-flash")?.price).toMatchObject({ perMinute: 0.5, source: "elevenlabs" });
  });

  it("falls back to the saved copy when ElevenLabs cannot be reached at all", async () => {
    const { data } = setup();
    await loadModelBook({ data, catalog: catalog(), cache: newCache() }, "a");
    const dead = catalog({ listLlms: async () => { throw new Error("offline"); }, llmPrices: async () => { throw new Error("offline"); } });
    const book = await loadModelBook({ data, catalog: dead, cache: newCache() }, "a");
    expect(book.source).toBe("saved");
    expect(book.problem).toBeTruthy();
    expect(book.rows.find((r) => r.id === "gpt-6-luna")?.price).toMatchObject({ perMinute: 0.2, source: "elevenlabs" });
  });

  it("uses the saved copy without a key, and the built-in list before anything was saved", async () => {
    const { data } = setup();
    const fresh = await loadModelBook({ data, catalog: null, cache: newCache() }, "a");
    expect(fresh).toMatchObject({ source: "builtin", noKey: true });
    await loadModelBook({ data, catalog: catalog(), cache: newCache() }, "a");
    const again = await loadModelBook({ data, catalog: null, cache: newCache() }, "a");
    expect(again).toMatchObject({ source: "saved", noKey: true });
  });

  it("gives a client that was never looked at only the built-in estimate, not someone else's prices", async () => {
    const { data } = setup();
    await loadModelBook({ data, catalog: catalog(), cache: newCache() }, "a");
    const book = await loadModelBook({ data, catalog: null, cache: newCache() }, "b");
    expect(book.rows.find((r) => r.id === "gemini-2.5-flash")?.price.source).toBe("estimate");
  });

  it("saves the prices again once the client's instructions are a different size", async () => {
    const sizes = { a: 100 };
    const { settings, data } = setup(sizes);
    const cache = newCache();
    await loadModelBook({ data, catalog: catalog(), cache }, "a");
    const first = settings.get(pricesKey("a")) as { promptChars: number };
    sizes.a = 40_000;
    await loadModelBook({ data, catalog: catalog(), cache }, "a");
    expect((settings.get(pricesKey("a")) as { promptChars: number }).promptChars).toBeGreaterThan(first.promptChars + 30_000);
  });

  it("reads a second client from the memory cache but still keeps that client's own copy", async () => {
    const { settings, data } = setup();
    const calls: number[] = [];
    const cache = newCache();
    await loadModelBook({ data, catalog: catalog({ priceCalls: calls }), cache }, "a");
    await loadModelBook({ data, catalog: catalog({ priceCalls: calls }), cache }, "b"); // same prompt size: answered from memory
    expect(calls).toHaveLength(1);
    expect(settings.has(pricesKey("b"))).toBe(true);
  });
});
