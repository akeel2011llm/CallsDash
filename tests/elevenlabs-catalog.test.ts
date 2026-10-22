import { afterEach, describe, expect, it, vi } from "vitest";
import { createCatalogApi, explainCatalogError, mapAccountVoice, mapLibraryVoice, mapLiveAgent, mapLlm, mapPrices } from "@/lib/elevenlabs-catalog";
import { ElevenLabsError, elevenLabsBase } from "@/lib/elevenlabs-api";

type Call = { url: URL; method: string; body?: unknown; key?: string };

function fakeFetch(answer: (c: Call) => unknown, status = 200) {
  const calls: Call[] = [];
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: new URL(String(input)), method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      key: (init?.headers as Record<string, string> | undefined)?.["xi-api-key"],
    };
    calls.push(call);
    const out = answer(call);
    return new Response(typeof out === "string" ? out : JSON.stringify(out), { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const accountVoice = {
  voice_id: "v_rachel", name: "Rachel", category: "premade", description: "Calm", preview_url: "https://storage.googleapis.com/eleven/rachel.mp3",
  labels: { accent: "american", gender: "female", age: "young", use_case: "conversational", descriptive: "calm", language: "en" },
  verified_languages: [{ language: "en", model_id: "eleven_multilingual_v2", accent: "american" }, { language: "ar", model_id: "eleven_multilingual_v2" }],
};

afterEach(() => { delete process.env.ELEVENLABS_API_BASE; });

describe("reading voices", () => {
  it("maps an account voice with its labels, languages and preview", () => {
    expect(mapAccountVoice(accountVoice)).toEqual({
      id: "v_rachel", name: "Rachel", source: "account", category: "premade", gender: "female", age: "young", accent: "american", language: "en",
      languages: [{ language: "en", accent: "american", modelId: "eleven_multilingual_v2" }, { language: "ar", accent: undefined, modelId: "eleven_multilingual_v2" }],
      useCase: "conversational", descriptive: "calm", description: "Calm", previewUrl: "https://storage.googleapis.com/eleven/rachel.mp3",
    });
  });
  it("skips a voice without an id and keeps only https previews", () => {
    expect(mapAccountVoice({ name: "No id" })).toBeNull();
    expect(mapAccountVoice({ voice_id: "x", preview_url: "http://insecure.example/a.mp3" })?.previewUrl).toBeUndefined();
    expect(mapAccountVoice({ voice_id: "x", preview_url: "javascript:alert(1)" })?.previewUrl).toBeUndefined();
    expect(mapAccountVoice({ voice_id: "x", name: "N" })?.languages).toEqual([]);
  });
  it("maps a library voice and remembers who owns it, which adding it needs", () => {
    const v = mapLibraryVoice({
      public_owner_id: "owner9", voice_id: "lib1", name: "Khalid", accent: "gulf", gender: "male", age: "middle_aged", descriptive: "warm", use_case: "customer_service",
      category: "professional", language: "ar", rate: 1.5, preview_url: "https://cdn.example/k.mp3", verified_languages: [{ language: "ar", model_id: "eleven_multilingual_v2", accent: "gulf" }],
    });
    expect(v).toMatchObject({ id: "lib1", source: "library", publicOwnerId: "owner9", language: "ar", accent: "gulf", useCase: "customer_service", rate: 1.5 });
  });
  it("asks the account's voices with the filters spelled the way ElevenLabs expects, and reports more pages", async () => {
    const { f, calls } = fakeFetch(() => ({ voices: [accountVoice, { name: "broken" }], has_more: true, next_page_token: "tok2" }));
    const api = createCatalogApi("key-1", f);
    const page = await api.searchVoices({ search: "rach el", language: "ar", gender: "female", accent: "gulf", useCase: "conversational", pageSize: 500, next: "tok1" });
    const c = calls[0];
    expect(c.method).toBe("GET");
    expect(c.url.origin + c.url.pathname).toBe("https://api.elevenlabs.io/v2/voices");
    expect(Object.fromEntries(c.url.searchParams)).toEqual({
      search: "rach el", language: "ar", gender: "female", accent: "gulf", use_cases: "conversational", page_size: "100", next_page_token: "tok1", include_total_count: "false",
    });
    expect(c.key).toBe("key-1");
    expect(page.voices.map((v) => v.id)).toEqual(["v_rachel"]);
    expect(page.hasMore).toBe(true);
    expect(page.next).toBe("tok2");
  });
  it("searches the public library by page number", async () => {
    const { f, calls } = fakeFetch(() => ({ voices: [{ voice_id: "lib1", public_owner_id: "o1", name: "A" }], has_more: true }));
    const page = await createCatalogApi("k", f).searchLibrary({ search: "arabic", language: "ar", next: "2" });
    expect(calls[0].url.pathname).toBe("/v1/shared-voices");
    expect(calls[0].url.searchParams.get("page")).toBe("2");
    expect(calls[0].url.searchParams.get("sort")).toBe("trending");
    // voices under live moderation cannot speak in an agent, and old custom-rate voices cost extra
    expect(calls[0].url.searchParams.get("include_live_moderated")).toBe("false");
    expect(calls[0].url.searchParams.get("include_custom_rates")).toBe("false");
    expect(page.next).toBe("3");
    expect(page.voices[0].source).toBe("library");
    const last = await createCatalogApi("k", fakeFetch(() => ({ voices: [], has_more: false })).f).searchLibrary({});
    expect(last.next).toBeUndefined();
  });
  it("looks voices up by id, one repeated parameter each, and does nothing for an empty list", async () => {
    const { f, calls } = fakeFetch(() => ({ voices: [accountVoice] }));
    const api = createCatalogApi("k", f);
    expect(await api.getVoices([])).toEqual([]);
    expect(calls).toHaveLength(0);
    const found = await api.getVoices(["v_rachel", "v_rachel", "", "v_other"]);
    expect(calls[0].url.searchParams.getAll("voice_ids")).toEqual(["v_rachel", "v_other"]);
    expect(found).toHaveLength(1);
  });
  it("adds a library voice to the account", async () => {
    const { f, calls } = fakeFetch(() => ({ voice_id: "lib1" }));
    const r = await createCatalogApi("k", f).addLibraryVoice({ publicOwnerId: "owner/9", voiceId: "lib1", name: "Khalid (clinic)" });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url.pathname).toBe("/v1/voices/add/owner%2F9/lib1");
    expect(calls[0].body).toEqual({ new_name: "Khalid (clinic)" });
    expect(r).toEqual({ voiceId: "lib1" });
  });
});

describe("reading models and prices", () => {
  it("maps the model list with limits, reasoning levels and deprecation notices", () => {
    const m = mapLlm({
      llm: "gpt-4o", max_tokens_limit: 16384, max_context_limit: 128000, supports_parallel_tool_calls: true, supports_image_input: true,
      available_reasoning_efforts: ["low", "high", 7],
      deprecation_info: { llm: "gpt-4o", is_deprecated: false, is_in_warning_period: true, replacement_model: "gpt-5.4", provider_deprecation_date: "2026-12-01T00:00:00Z" },
    });
    expect(m).toMatchObject({
      id: "gpt-4o", maxOutputTokens: 16384, contextTokens: 128000, supportsParallelTools: true, reasoningEfforts: ["low", "high"],
      deprecated: { isDeprecated: false, inWarning: true, replacement: "gpt-5.4", date: "2026-12-01T00:00:00Z" },
    });
    expect(mapLlm({ max_tokens_limit: 1 })).toBeNull();
    expect(mapLlm({ llm: "x" })?.deprecated).toBeUndefined();
  });
  it("lists the models", async () => {
    const { f, calls } = fakeFetch(() => ({ llms: [{ llm: "a" }, { nope: 1 }, { llm: "b" }] }));
    expect((await createCatalogApi("k", f).listLlms()).map((m) => m.id)).toEqual(["a", "b"]);
    expect(calls[0].url.pathname).toBe("/v1/convai/llm/list");
  });
  it("asks what each model costs for this prompt size and keeps only complete rows", async () => {
    const { f, calls } = fakeFetch(() => ({ llm_prices: [{ llm: "gpt-4o", price_per_minute: 0.0123, price_per_message: 0.002 }, { llm: "bad", price_per_minute: "x" }] }));
    const prices = await createCatalogApi("k", f).llmPrices({ promptLength: 4200.4, numberOfPages: 3.2, ragEnabled: true });
    expect(calls[0].method).toBe("POST");
    expect(calls[0].url.pathname).toBe("/v1/convai/llm-usage/calculate");
    expect(calls[0].body).toEqual({ prompt_length: 4200, number_of_pages: 3, rag_enabled: true });
    expect(prices).toEqual([{ llm: "gpt-4o", perMinute: 0.0123, perMessage: 0.002 }]);
    expect(mapPrices(null)).toEqual([]);
  });
});

describe("reading the live agent", () => {
  it("picks out the settings the studio compares", () => {
    const live = mapLiveAgent({
      name: "CallsDash: Clinic",
      conversation_config: {
        agent: { language: "en", prompt: { llm: "gemini-2.5-flash", temperature: 0.3, max_tokens: -1, tool_ids: ["t1", "t2"], built_in_tools: { end_call: { name: "end_call" }, skip_turn: { name: "skip_turn" } } } },
        tts: { voice_id: "v1", model_id: "eleven_flash_v2", stability: 0.5, similarity_boost: 0.8, speed: 1 },
        language_presets: { ar: { overrides: { tts: { voice_id: "v2", model_id: "eleven_flash_v2_5" } } } },
        turn: { turn_eagerness: "normal", turn_timeout: 7, silence_end_call_timeout: 30 },
        asr: { provider: "scribe_realtime" },
        conversation: { max_duration_seconds: 900 },
      },
      platform_settings: { call_limits: { daily_limit: 500 }, privacy: { record_voice: true, retention_days: 90 }, guardrails: { focus: { is_enabled: true }, prompt_injection: { is_enabled: false } } },
    });
    expect(live).toMatchObject({
      name: "CallsDash: Clinic", llm: "gemini-2.5-flash", temperature: 0.3, maxTokens: -1, language: "en", voiceId: "v1", ttsModel: "eleven_flash_v2", arabicVoiceId: "v2", arabicTtsModel: "eleven_flash_v2_5",
      stability: 0.5, similarityBoost: 0.8, speed: 1, turnEagerness: "normal", turnTimeout: 7, silenceEndCallTimeout: 30, maxDurationSeconds: 900, asrProvider: "scribe_realtime",
      dailyLimit: 500, recordVoice: true, retentionDays: 90, toolCount: 4, guardrailsFocus: true, guardrailsPromptInjection: false,
    });
    expect(mapLiveAgent(undefined)).toMatchObject({ toolCount: 0 });
  });
  it("fetches the agent by id", async () => {
    const { f, calls } = fakeFetch(() => ({ name: "A", conversation_config: {} }));
    expect((await createCatalogApi("k", f).getAgent("agent/1")).name).toBe("A");
    expect(calls[0].url.pathname).toBe("/v1/convai/agents/agent%2F1");
  });
});

describe("talking to ElevenLabs", () => {
  it("sends every call to the address in ELEVENLABS_API_BASE when it is set (used by tests only)", async () => {
    process.env.ELEVENLABS_API_BASE = "http://127.0.0.1:4545/";
    expect(elevenLabsBase()).toBe("http://127.0.0.1:4545");
    const { f, calls } = fakeFetch(() => ({ llms: [] }));
    await createCatalogApi("k", f).listLlms();
    expect(calls[0].url.origin).toBe("http://127.0.0.1:4545");
  });
  it("turns the usual refusals into a sentence an admin can act on", () => {
    expect(explainCatalogError(new ElevenLabsError(401, "invalid_api_key"))).toMatch(/did not accept the API key/);
    expect(explainCatalogError(new ElevenLabsError(401, '{"detail":{"status":"missing_permissions"}}'))).toMatch(/did not accept/); // 401 is checked first
    expect(explainCatalogError(new ElevenLabsError(403, "x"))).toMatch(/not allowed/);
    expect(explainCatalogError(new ElevenLabsError(400, '{"detail":{"status":"missing_permissions","message":"voices_read"}}'))).toMatch(/not allowed/);
    expect(explainCatalogError(new ElevenLabsError(429, "x"))).toMatch(/slow down/);
    expect(explainCatalogError(new ElevenLabsError(503, "x"))).toMatch(/problem/);
    expect(explainCatalogError(new ElevenLabsError(422, "bad llm"))).toBe("ElevenLabs 422: bad llm");
    const timeout = Object.assign(new Error("t"), { name: "TimeoutError" });
    expect(explainCatalogError(timeout)).toMatch(/too long/);
    expect(explainCatalogError("weird")).toMatch(/Something went wrong/);
  });
  it("passes ElevenLabs' own error through when a call fails", async () => {
    const { f } = fakeFetch(() => '{"detail":"nope"}', 422);
    await expect(createCatalogApi("k", f).listLlms()).rejects.toMatchObject({ status: 422 });
  });
});
