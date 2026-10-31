import { describe, expect, it } from "vitest";
import { liveRows, liveSummary, liveTexts } from "@/lib/studio-live";
import { mapLiveAgent } from "@/lib/elevenlabs-catalog";
import { applySection, parseSection, STUDIO_DEFAULTS } from "@/lib/agent-studio";
import type { AgentSettings } from "@/lib/types";

const settings = (over: Partial<AgentSettings> = {}): AgentSettings => ({
  elevenLabsAgentId: "agent_1", prompt: {} as never, temperature: 0.3, replyLength: "normal", formality: "polite", arabicWrittenStyle: "gulf",
  voiceEn: "EXAVITQu4vr4xnSDxMaL", voiceAr: "pNInz6obpgDQGcFmaJgB", ...over,
});
const tenant = { retentionDays: 90 };
const byId = (rows: ReturnType<typeof liveRows>) => Object.fromEntries(rows.map((r) => [r.id, r]));

/** What ElevenLabs reports for an agent CallsDash has just synced with the defaults. */
const liveDefault = () => mapLiveAgent({
  conversation_config: {
    agent: { language: "en", prompt: { llm: "gemini-2.5-flash", temperature: 0.3, max_tokens: -1, built_in_tools: {} } },
    tts: { voice_id: "EXAVITQu4vr4xnSDxMaL", model_id: "eleven_flash_v2", stability: 0.5, similarity_boost: 0.8, speed: 1 },
    language_presets: { ar: { overrides: { tts: { voice_id: "pNInz6obpgDQGcFmaJgB", model_id: "eleven_flash_v2_5" } } } },
    turn: { turn_timeout: 7, silence_end_call_timeout: 30 },
    conversation: { max_duration_seconds: 900 },
    asr: { provider: "scribe_realtime" },
  },
  platform_settings: {
    call_limits: { daily_limit: 500 }, privacy: { record_voice: true, retention_days: 90 },
    guardrails: { focus: { is_enabled: true }, prompt_injection: { is_enabled: true } },
    widget: { disable_banner: true },
  },
});

describe("live read-back", () => {
  it("shows an untouched client as matching where CallsDash sets a value and unset where it leaves it to ElevenLabs", () => {
    const rows = byId(liveRows({ settings: settings(), tenant, live: liveDefault(), fallbackLlm: "gemini-2.5-flash" }));
    expect(rows.llm.state).toBe("same");
    expect(rows.temperature.state).toBe("same");
    expect(rows.voiceEn.state).toBe("same");
    expect(rows.ttsModelAr.state).toBe("same");
    expect(rows.silenceEndSeconds.state).toBe("same");
    expect(rows.maxDurationSeconds.state).toBe("same");
    expect(rows.dailyLimit.state).toBe("same");
    // never saved sections: CallsDash does not send these, ElevenLabs keeps its own
    expect(rows.stability.state).toBe("unset");
    expect(rows.stability.here).toBeNull();
    expect(rows.stability.there).toBe(0.5);
    expect(rows.maxTokens.state).toBe("unset");
    expect(rows.turnTimeout.state).toBe("unset");
    expect(rows.asrProvider.state).toBe("unset");
  });

  it("flags a saved option ElevenLabs does not show", () => {
    const s = applySection(settings(), "model", parseSection("model", (() => {
      const f = new FormData();
      f.set("llm", "gpt-6-luna"); f.set("temperature", "0.5"); f.set("maxTokens", "300"); f.set("reasoningEffort", ""); f.set("parallelTools", "on");
      f.set("backupMode", "default"); f.set("cascadeSeconds", "4");
      return f;
    })(), settings()));
    const rows = byId(liveRows({ settings: s, tenant, live: liveDefault() }));
    expect(rows.llm.state).toBe("differs");
    expect(rows.llm.here).toBe("gpt-6-luna");
    expect(rows.llm.there).toBe("gemini-2.5-flash");
    expect(rows.temperature.state).toBe("differs");
    expect(rows.maxTokens.state).toBe("differs");
    expect(rows.maxTokens.here).toBe(300);
    expect(rows.maxTokens.there).toBeNull(); // -1 means no limit
    expect(rows.tags).toMatchObject({ here: "CallsDash, clinic", there: null, state: "differs" }); // the labels are sent at every sync
    expect(liveSummary(Object.values(rows)).differs).toBe(4);
  });

  it("compares the hidden \"Powered by\" line: matching once ElevenLabs hides it, a difference while the agent still shows it", () => {
    const hidden = byId(liveRows({ settings: settings(), tenant, live: liveDefault() }));
    expect(hidden.hideBanner).toMatchObject({ section: "widget", here: true, there: true, state: "same" });
    // an agent made before the option existed: ElevenLabs holds no value, which means the line is shown
    const old = byId(liveRows({ settings: settings(), tenant, live: mapLiveAgent({ platform_settings: { widget: {} } }) }));
    expect(old.hideBanner).toMatchObject({ here: true, there: false, state: "differs" });
    expect(byId(liveRows({ settings: settings(), tenant, live: mapLiveAgent({}) })).hideBanner.state).toBe("differs");
    // an admin who turned the option off expects the line to be shown
    const shown = byId(liveRows({ settings: settings({ studio: { ...STUDIO_DEFAULTS, widget: { ...STUDIO_DEFAULTS.widget, hideBanner: false } } }), tenant, live: mapLiveAgent({ platform_settings: { widget: { disable_banner: false } } }) }));
    expect(shown.hideBanner).toMatchObject({ here: false, there: false, state: "same" });
  });

  it("treats a model that ignores the temperature as matching when ElevenLabs holds none", () => {
    const s = settings({ studio: { ...STUDIO_DEFAULTS, llm: "claude-sonnet-5-5" } });
    const live = mapLiveAgent({ conversation_config: { agent: { prompt: { llm: "claude-sonnet-5-5" } } } });
    const rows = byId(liveRows({ settings: s, tenant, live }));
    expect(rows.temperature.here).toBeNull();
    expect(rows.temperature.state).toBe("same");
  });

  it("calls a temperature ElevenLabs shows for a model that never reads it 'not used', not a difference", () => {
    const s = settings({ studio: { ...STUDIO_DEFAULTS, llm: "claude-sonnet-5-5" } });
    const live = mapLiveAgent({ conversation_config: { agent: { prompt: { llm: "claude-sonnet-5-5", temperature: 0 } } } });
    const rows = byId(liveRows({ settings: s, tenant, live }));
    expect(rows.temperature.here).toBeNull();
    expect(rows.temperature.there).toBe(0);
    expect(rows.temperature.state).toBe("unused");
    expect(rows.llm.state).toBe("same");
  });

  it("resolves CallsDash's own voice labels to the real voice before comparing", () => {
    const rows = byId(liveRows({ settings: settings({ voiceEn: "voice_en_f", voiceAr: "voice_ar_m" }), tenant, live: liveDefault(), voiceOverrides: JSON.stringify({ voice_en_f: "EXAVITQu4vr4xnSDxMaL" }) }));
    expect(rows.voiceEn.state).toBe("same");
    expect(rows.voiceAr.here).toBe("pNInz6obpgDQGcFmaJgB");
  });

  it("compares numbers with a little tolerance", () => {
    const s = applySection(settings(), "voice", parseSection("voice", (() => {
      const f = new FormData();
      for (const [k, v] of Object.entries({ voiceEn: "EXAVITQu4vr4xnSDxMaL", voiceAr: "pNInz6obpgDQGcFmaJgB", ttsModelEn: "eleven_flash_v2", ttsModelAr: "eleven_flash_v2_5", stability: "0.5", similarity: "0.8", speed: "1", textNormalisation: "system_prompt" })) f.set(k, v);
      return f;
    })(), settings()));
    const rows = byId(liveRows({ settings: s, tenant, live: liveDefault() }));
    expect(rows.stability.state).toBe("same");
    expect(rows.similarity.state).toBe("same");
    expect(rows.speed.state).toBe("same");
  });
});

describe("instructions and greetings read-back", () => {
  const full = settings({ prompt: { identity: "You are Sara.", languages: "English and Arabic.", mayDo: "Book.", neverDo: "Diagnose.", emergencies: "Say 999.", handoff: "Take a message." } as never });
  const t = { name: "MioC", branding: { displayName: "MioCclinic", displayNameAr: "" } } as never;
  const texts = (live: ReturnType<typeof liveDefault>) => Object.fromEntries(liveTexts({ settings: full, tenant: t, doctors: [], live }).map((x) => [x.id, x]));

  it("matches when ElevenLabs holds what a sync would send, ignoring whitespace", () => {
    const here = texts({ ...liveDefault(), prompt: "x" });
    const live = { ...liveDefault(), prompt: here.prompt.here.replace(/\n/g, "  \r\n"), firstMessage: here.greetingEn.here, arabicFirstMessage: here.greetingAr.here };
    const r = texts(live);
    expect([r.prompt.state, r.greetingEn.state, r.greetingAr.state]).toEqual(["same", "same", "same"]);
  });

  it("flags a hand-edited greeting and a missing Arabic one", () => {
    const live = { ...liveDefault(), prompt: "x", firstMessage: "Hello!!, you are speaking with the AI assistant." };
    const r = texts(live);
    expect(r.greetingEn.state).toBe("differs");
    expect(r.greetingEn.there).toBe("Hello!!, you are speaking with the AI assistant.");
    expect(r.greetingAr.there).toBeNull();
    expect(r.greetingAr.state).toBe("differs");
  });
});
