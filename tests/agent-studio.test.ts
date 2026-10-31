import { describe, expect, it } from "vitest";
import { buildAgentConfig, greeting } from "@/lib/agent-config";
import { DATA_COLLECTION, EVALUATION_CRITERIA, buildExtras, readableOn, withExtras } from "@/lib/agent-extras";
import { LIMITS, STUDIO_DEFAULTS, applySection, describeStudioChange, isTouched, parseSection, parseWordList, resetSection, resolveStudio, studioOf, type SectionId } from "@/lib/agent-studio";
import { DEFAULT_OPENING_HOURS } from "@/lib/availability";
import { DEFAULT_RULES } from "@/lib/flags";
import { OUTCOME_ITEM } from "@/lib/agent-config";
import { agent } from "@/lib/seed";
import type { AgentSettings, Tenant } from "@/lib/types";

const tenant = (o: Partial<Tenant> = {}): Tenant => ({
  id: "t", slug: "al-noor", name: "Al Noor Medical Center", status: "live",
  branding: { displayName: "Al Noor", displayNameAr: "مركز النور", primaryColor: "#0e7c86" },
  plans: [], alertRules: structuredClone(DEFAULT_RULES), permissions: { editPrompt: true, editVoice: true, editBehaviour: true, editKnowledge: true },
  allowedDomains: ["alnoor.example.bh"], zeroBalancePolicy: "pause", lowBalanceThreshold: 0.15, retentionDays: 90, calendarConnected: false,
  openingHours: DEFAULT_OPENING_HOURS, channels: { website: "pending", whatsapp: "off", instagram: "off", phone: "off" }, onboarding: { done: [] }, integrations: {}, createdAt: "2026-01-01T00:00:00Z", ...o,
});

const form = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};

const base = (): AgentSettings => agent("", "Al Noor Medical Center");

describe("reading the stored studio", () => {
  it("gives a client that never saved the studio exactly the defaults", () => {
    expect(resolveStudio(undefined)).toEqual(STUDIO_DEFAULTS);
    expect(resolveStudio(null)).toEqual(STUDIO_DEFAULTS);
    expect(resolveStudio("junk")).toEqual(STUDIO_DEFAULTS);
    expect(studioOf(base())).toEqual(STUDIO_DEFAULTS);
  });
  it("keeps the values the agent had before the studio existed", () => {
    expect(STUDIO_DEFAULTS).toMatchObject({ ttsModelEn: "eleven_flash_v2", ttsModelAr: "eleven_flash_v2_5", maxDurationSeconds: 900, silenceEndSeconds: 30, dailyLimit: 500, protectGreeting: true, guardFocus: true, guardInjection: true, recordVoice: true });
  });
  it("forces every stored value into its allowed range and drops what is not allowed", () => {
    const s = resolveStudio({
      llm: "gpt 5; drop table", maxTokens: 99999, reasoningEffort: "extreme", cascadeSeconds: 99, stability: 4, similarity: -1, speed: 3, turnTimeout: 500,
      silenceEndSeconds: 2, maxDurationSeconds: 5, softTimeoutSeconds: 40, dailyLimit: 0, concurrencyLimit: 99999, turnEagerness: "wild", backupMode: "x",
      asrProvider: "other", summaryLanguage: "fr", touched: ["model", "nonsense", "model"], extraKeywords: ["  Dr  Ali ", "", 5, "x".repeat(80)],
      offeredVoices: [{ id: "abcdef123456", name: " Noura ", language: "ar", previewUrl: "http://insecure/x.mp3" }, { id: "no", name: "bad id" }, { id: "abcdef123456", name: "dup" }],
      voiceNotes: { abcdef123456: { name: "Noura" }, "!": { name: "x" } },
      widget: { variant: "huge", btnColor: "red", borderRadius: 900 },
    });
    expect(s.llm).toBe("");
    expect(s.maxTokens).toBe(4096);
    expect(s.reasoningEffort).toBe("");
    expect(s.cascadeSeconds).toBe(15);
    expect([s.stability, s.similarity, s.speed]).toEqual([1, 0, 1.2]);
    expect(s.turnTimeout).toBe(30);
    expect(s.silenceEndSeconds).toBe(5);
    expect(s.maxDurationSeconds).toBe(60);
    expect(s.softTimeoutSeconds).toBe(8);
    expect(s.dailyLimit).toBe(1);
    expect(s.concurrencyLimit).toBe(1000);
    expect(s.turnEagerness).toBe("normal");
    expect(s.backupMode).toBe("default");
    expect(s.asrProvider).toBe("scribe_realtime");
    expect(s.summaryLanguage).toBe("");
    expect(s.touched).toEqual(["model"]);
    expect(s.extraKeywords).toEqual(["Dr Ali", "x".repeat(50)]);
    expect(s.offeredVoices).toEqual([{ id: "abcdef123456", name: "Noura", language: "ar", gender: undefined, accent: undefined, previewUrl: undefined }]);
    expect(Object.keys(s.voiceNotes)).toEqual(["abcdef123456"]);
    expect(s.widget.variant).toBe("full");
    expect(s.widget.btnColor).toBe("#0f766e");
    expect(s.widget.borderRadius).toBe(40);
  });
  it("reads 0 as 'off' for the options that have an off position", () => {
    const s = resolveStudio({ maxTokens: 0, silenceEndSeconds: 0, softTimeoutSeconds: 0, concurrencyLimit: 0 });
    expect([s.maxTokens, s.silenceEndSeconds, s.softTimeoutSeconds, s.concurrencyLimit]).toEqual([0, 0, 0, 0]);
  });
  it("raises a saved longest reply that is too low to hold a booking request, and leaves 0 (no limit) alone", () => {
    expect(LIMITS.maxTokens[0]).toBeGreaterThanOrEqual(300);
    for (const stored of [1, 50, 120, 299]) expect(resolveStudio({ maxTokens: stored }).maxTokens).toBe(LIMITS.maxTokens[0]);
    expect(resolveStudio({ maxTokens: LIMITS.maxTokens[0] }).maxTokens).toBe(LIMITS.maxTokens[0]);
    expect(resolveStudio({ maxTokens: 800 }).maxTokens).toBe(800);
    expect(resolveStudio({ maxTokens: 0 }).maxTokens).toBe(0);
    expect(resolveStudio({ maxTokens: -5 }).maxTokens).toBe(0);
  });
  it("splits a typed list of words on lines, commas and Arabic commas, without repeats or long entries", () => {
    expect(parseWordList("Al Noor, Dr Ali\nDr Ali؛ ، Zainab\n" + "y".repeat(60), 20, 50)).toEqual(["Al Noor", "Dr Ali", "Zainab"]);
    expect(parseWordList("a,b,c,d", 2, 50)).toEqual(["a", "b"]);
  });
});

describe("saving a section", () => {
  it("reads the model section and takes the temperature along", () => {
    const r = parseSection("model", form({ llm: "gpt-5.4-mini", temperature: "0.2", maxTokens: "300", reasoningEffort: "low", parallelTools: "on", backupMode: "custom", backupModels: ["gemini-2.5-flash", "gpt-4.1"], cascadeSeconds: "6" }), base());
    expect(r.errors).toEqual([]);
    expect(r.top.temperature).toBe(0.2);
    expect(r.studio).toMatchObject({ llm: "gpt-5.4-mini", maxTokens: 300, reasoningEffort: "low", parallelTools: true, backupMode: "custom", backupModels: ["gemini-2.5-flash", "gpt-4.1"], cascadeSeconds: 6 });
  });
  it("turns a missing checkbox into false (that is how a browser sends an unticked box)", () => {
    const r = parseSection("model", form({ llm: "", temperature: "0.3", maxTokens: "0", reasoningEffort: "", backupMode: "default", cascadeSeconds: "4" }), { ...base(), studio: { parallelTools: true } });
    expect(r.studio.parallelTools).toBe(false);
  });
  it("refuses numbers outside the allowed range and says which field", () => {
    const r = parseSection("model", form({ llm: "", temperature: "1.5", maxTokens: "9999", reasoningEffort: "", backupMode: "default", cascadeSeconds: "1" }), base());
    expect(r.errors.map((e) => e.field).sort()).toEqual(["cascadeSeconds", "maxTokens", "temperature"]);
    expect(r.errors.every((e) => e.key === "studio.err.range")).toBe(true);
    expect(r.top.temperature).toBe(0.3); // the saved value stays
  });
  it("refuses a longest reply too short for a booking request with a message that says why, and keeps the saved value", () => {
    const fields = { llm: "", temperature: "0.3", reasoningEffort: "", backupMode: "default", cascadeSeconds: "4" };
    const saved = { ...base(), studio: { maxTokens: 500 } };
    for (const v of ["1", "50", "299"]) {
      const r = parseSection("model", form({ ...fields, maxTokens: v }), saved);
      expect(r.errors).toEqual([{ field: "maxTokens", key: "studio.err.tokensLow" }]);
      expect(r.studio.maxTokens).toBe(500);
    }
    expect(parseSection("model", form({ ...fields, maxTokens: "50" }), base()).studio.maxTokens).toBe(0);
    for (const v of ["0", "300", "4096"]) expect(parseSection("model", form({ ...fields, maxTokens: v }), saved).errors).toEqual([]);
    expect(parseSection("model", form({ ...fields, maxTokens: "-1" }), saved).errors).toEqual([{ field: "maxTokens", key: "studio.err.range" }]);
  });
  it("refuses a model the page never offered", () => {
    const r = parseSection("model", form({ llm: "gpt-evil", temperature: "0.3", maxTokens: "0", reasoningEffort: "", backupMode: "default", cascadeSeconds: "4" }), base(), { llms: ["gpt-5.4-mini"] });
    expect(r.errors).toEqual([{ field: "llm", key: "studio.err.model" }]);
  });
  it("needs at least one model when the backup is a custom list", () => {
    const r = parseSection("model", form({ llm: "", temperature: "0.3", maxTokens: "0", reasoningEffort: "", backupMode: "custom", cascadeSeconds: "4" }), base());
    expect(r.errors).toEqual([{ field: "backupModels", key: "studio.err.backup" }]);
  });
  it("reads the voice section: chosen voices, their names for later, tuning and the voices offered to the client", () => {
    const offered = JSON.stringify([{ id: "abcdef123456", name: "Noura", language: "ar", previewUrl: "https://cdn.example/n.mp3" }, { id: "javascript", name: "x", previewUrl: "javascript:alert(1)" }]);
    const r = parseSection("voice", form({
      voiceEn: "ENvoice12345", voiceEnName: "James", voiceEnPreview: "https://cdn.example/j.mp3", voiceEnGender: "male", voiceAr: "voice_ar_f", ttsModelEn: "eleven_flash_v2", ttsModelAr: "eleven_multilingual_v2",
      stability: "0.4", similarity: "0.75", speed: "1.1", textNormalisation: "elevenlabs", expressive: "on", offered,
    }), base());
    expect(r.errors).toEqual([]);
    expect(r.top).toEqual({ voiceEn: "ENvoice12345", voiceAr: "voice_ar_f" });
    expect(r.studio).toMatchObject({ ttsModelAr: "eleven_multilingual_v2", stability: 0.4, similarity: 0.75, speed: 1.1, textNormalisation: "elevenlabs", expressive: true });
    expect(r.studio.voiceNotes?.ENvoice12345).toMatchObject({ name: "James", gender: "male", previewUrl: "https://cdn.example/j.mp3" });
    expect(r.studio.offeredVoices?.map((v) => v.id)).toEqual(["abcdef123456", "javascript"]);
    expect(r.studio.offeredVoices?.[1].previewUrl).toBeUndefined();
  });
  it("refuses a voice id with odd characters and a broken offered list", () => {
    const r = parseSection("voice", form({ voiceEn: "a b;c", voiceAr: "voice_ar_f", ttsModelEn: "eleven_flash_v2", ttsModelAr: "eleven_flash_v2_5", stability: "0.5", similarity: "0.8", speed: "1", textNormalisation: "system_prompt", offered: "{not json" }), base());
    expect(r.errors.map((e) => e.field).sort()).toEqual(["offered", "voiceEn"]);
    expect(r.top.voiceEn).toBe("voice_en_f");
  });
  it("reads the conversation section, where 0 switches the silence hang-up and the filler off", () => {
    const r = parseSection("conversation", form({
      turnEagerness: "eager", turnTimeout: "10", silenceEndSeconds: "0", spellingPatience: "off", maxDurationSeconds: "1200", maxDurationMessage: "We have to end now.",
      protectGreeting: "on", softTimeoutSeconds: "3", softTimeoutMessageEn: "Just a moment.", softTimeoutMessageAr: "لحظة.", greetingEn: "Hello from {name}", greetingAr: "",
    }), base());
    expect(r.errors).toEqual([]);
    expect(r.studio).toMatchObject({ turnEagerness: "eager", turnTimeout: 10, silenceEndSeconds: 0, spellingPatience: "off", speculativeTurn: false, maxDurationSeconds: 1200, protectGreeting: true, softTimeoutSeconds: 3, greetingEn: "Hello from {name}", greetingAr: "" });
  });
  it("refuses a hang-up time under five seconds, which would cut people off mid-thought", () => {
    const r = parseSection("conversation", form({ turnEagerness: "normal", turnTimeout: "7", silenceEndSeconds: "2", spellingPatience: "auto", maxDurationSeconds: "900", softTimeoutSeconds: "0" }), base());
    expect(r.errors.map((e) => e.field)).toEqual(["silenceEndSeconds"]);
  });
  it("reads the hearing, safety and analysis sections", () => {
    expect(parseSection("hearing", form({ asrProvider: "scribe_realtime", extraKeywords: "Zainab, Hamad\nPanadol" }), base()).studio).toEqual({ asrProvider: "scribe_realtime", extraKeywords: ["Zainab", "Hamad", "Panadol"] });
    const safety = parseSection("safety", form({ guardFocus: "on", dailyLimit: "300", concurrencyLimit: "0", bursting: "on" }), base());
    expect(safety.errors).toEqual([]);
    expect(safety.studio).toEqual({ guardFocus: true, guardInjection: false, recordVoice: false, dailyLimit: 300, concurrencyLimit: 0, bursting: true });
    expect(parseSection("analysis", form({ summaryLanguage: "ar", criteriaOff: ["no_medical_advice", "../x"] }), base()).studio).toEqual({ summaryLanguage: "ar", criteriaOff: ["no_medical_advice"] });
  });
  it("reads the widget section with colours, texts and switches, and refuses a bad colour", () => {
    const ok = parseSection("widget", form({
      "w.colors": "custom", "w.bgColor": "#FFFFFF", "w.textColor": "#111111", "w.borderColor": "#e1e1e1", "w.btnColor": "#aa0000", "w.btnTextColor": "#ffffff", "w.variant": "compact", "w.placement": "bottom-left",
      "w.expandable": "mobile", "w.borderRadius": "8", "w.btnRadius": "20", "w.actionText": "Talk to us", "w.transcript": "on", "w.feedback": "none",
    }), base());
    expect(ok.errors).toEqual([]);
    expect(ok.studio.widget).toMatchObject({ colors: "custom", bgColor: "#ffffff", btnColor: "#aa0000", variant: "compact", placement: "bottom-left", expandable: "mobile", borderRadius: 8, actionText: "Talk to us", transcript: true, textInput: false, feedback: "none", hideBanner: false });
    const hidden = parseSection("widget", form({
      "w.colors": "brand", "w.bgColor": "#ffffff", "w.textColor": "#111111", "w.borderColor": "#e1e1e1", "w.btnColor": "#aa0000", "w.btnTextColor": "#ffffff", "w.variant": "full", "w.placement": "bottom-right",
      "w.expandable": "never", "w.borderRadius": "16", "w.btnRadius": "10", "w.feedback": "end", "w.hideBanner": "on",
    }), base());
    expect(hidden.errors).toEqual([]);
    expect(hidden.studio.widget?.hideBanner).toBe(true);
    const bad = parseSection("widget", form({ "w.colors": "custom", "w.bgColor": "white", "w.textColor": "#111111", "w.borderColor": "#e1e1e1", "w.btnColor": "#aa0000", "w.btnTextColor": "#ffffff", "w.variant": "full", "w.placement": "bottom-right", "w.expandable": "never", "w.borderRadius": "8", "w.btnRadius": "8", "w.feedback": "end" }), base());
    expect(bad.errors).toEqual([{ field: "w.bgColor", key: "studio.err.color" }]);
  });
  it("marks the section as saved and keeps the other sections untouched", () => {
    const parsed = parseSection("hearing", form({ asrProvider: "scribe_realtime", extraKeywords: "" }), base());
    const next = applySection(base(), "hearing", parsed);
    expect(isTouched(next, "hearing")).toBe(true);
    expect(isTouched(next, "model")).toBe(false);
    expect(isTouched(base(), "hearing")).toBe(false);
    const again = applySection(next, "model", parseSection("model", form({ llm: "", temperature: "0.5", maxTokens: "0", reasoningEffort: "", backupMode: "default", cascadeSeconds: "4" }), next));
    expect(studioOf(again).touched).toEqual(["hearing", "model"]);
    expect(again.temperature).toBe(0.5);
  });
  it("puts a section back to its defaults but keeps it saved, so the defaults are sent; chosen voices stay", () => {
    let s = applySection(base(), "voice", parseSection("voice", form({ voiceEn: "ENvoice12345", voiceAr: "ARvoice12345", ttsModelEn: "eleven_flash_v2", ttsModelAr: "eleven_flash_v2_5", stability: "0.1", similarity: "0.1", speed: "0.8", textNormalisation: "elevenlabs" }), base()));
    s = resetSection(s, "voice");
    expect(studioOf(s)).toMatchObject({ stability: 0.5, similarity: 0.8, speed: 1, textNormalisation: "system_prompt" });
    expect(isTouched(s, "voice")).toBe(true);
    expect([s.voiceEn, s.voiceAr]).toEqual(["ENvoice12345", "ARvoice12345"]);
    const m = resetSection({ ...base(), temperature: 0.9, studio: { llm: "gpt-5.4" } }, "model");
    expect(m.temperature).toBe(0.3);
    expect(studioOf(m).llm).toBe("");
  });
  it("describes what changed for the version history", () => {
    const before = base();
    const after = applySection(before, "model", parseSection("model", form({ llm: "gpt-5.4-mini", temperature: "0.2", maxTokens: "0", reasoningEffort: "", parallelTools: "on", backupMode: "default", cascadeSeconds: "4" }), before));
    expect(describeStudioChange(before, after)).toBe("Assistant studio: model default → gpt-5.4-mini; temperature 0.3 → 0.2");
    expect(describeStudioChange(after, after)).toBe("Assistant studio: saved without changes");
  });
});

/* The agent a client had before the studio existed. The studio must not change it for anyone who never saved it. */
const system = (name: string) => ({ type: "system", name, description: "", params: { system_tool_type: name } });
function legacyExtras(t: Tenant, doctors: { name: string }[]) {
  const brand = t.branding;
  const primary = brand.primaryColor;
  const keywords = [...new Set([t.name, brand.displayName, brand.displayNameAr, ...doctors.map((d) => d.name)].map((k) => (k ?? "").trim()).filter((k) => k && k.length <= 50))].slice(0, 20);
  return [
    { name: "tools", body: { conversation_config: { agent: { prompt: { built_in_tools: { end_call: system("end_call"), skip_turn: system("skip_turn") } } } } } },
    { name: "hardening", body: { conversation_config: { agent: { disable_first_message_interruptions: true, prompt: { timezone: "Asia/Bahrain" } }, turn: { silence_end_call_timeout: 30 } } } },
    { name: "keywords", body: { conversation_config: { asr: { keywords } } } },
    { name: "guardrails", body: { platform_settings: { guardrails: { version: "1", focus: { is_enabled: true }, prompt_injection: { is_enabled: true } } } } },
    { name: "analysis", body: { platform_settings: { evaluation: { criteria: EVALUATION_CRITERIA }, data_collection: DATA_COLLECTION } } },
    { name: "privacy", body: { platform_settings: { privacy: { record_voice: true, retention_days: 90 } } } },
    { name: "limits", body: { platform_settings: { call_limits: { daily_limit: 500 } } } },
    { name: "widget", body: { platform_settings: { widget: {
      bg_color: "#ffffff", text_color: "#111111", border_color: "#e1e1e1", btn_color: primary, btn_text_color: readableOn(primary), focus_color: primary,
      language_selector: true, feedback_mode: "end", show_conversation_id: false, transcript_enabled: true, text_input_enabled: true, supports_text_only: true,
    } } } },
    // the one deliberate change for every client: the widget no longer shows the "Powered by" line
    { name: "branding", body: { platform_settings: { widget: { disable_banner: true } } } },
    // and, since step 4, labels to find the agent in ElevenLabs' list
    { name: "tags", body: { tags: ["CallsDash", "clinic"] } },
  ];
}

describe("an agent whose studio was never saved", () => {
  const t = tenant();
  const doctors = [{ name: "Dr. Ali" }, { name: "Dr. Zainab" }];
  it("gets the same optional settings it always had", () => {
    expect(buildExtras({ tenant: t, doctors })).toEqual(legacyExtras(t, doctors));
    expect(buildExtras({ tenant: t, doctors, settings: base() })).toEqual(legacyExtras(t, doctors));
    expect(buildExtras({ tenant: t, doctors, settings: { ...base(), studio: {} } })).toEqual(legacyExtras(t, doctors));
  });
  it("gets the same core agent: Gemini 2.5 Flash, the flash voice models, 15 minutes and the automatic greeting", () => {
    const c = buildAgentConfig({ tenant: t, settings: base(), toolIds: ["tool_1"], appUrl: "https://app.example" });
    expect(c.conversation_config.agent.prompt.llm).toBe("gemini-2.5-flash");
    expect(c.conversation_config.agent.prompt.temperature).toBe(0.3);
    expect(c.conversation_config.tts).toEqual({ voice_id: "21m00Tcm4TlvDq8ikWAM", model_id: "eleven_flash_v2" });
    expect(c.conversation_config.language_presets.ar.overrides.tts).toEqual({ voice_id: "21m00Tcm4TlvDq8ikWAM", model_id: "eleven_flash_v2_5" });
    expect(c.conversation_config.conversation).toEqual({ max_duration_seconds: 900 });
    expect(c.conversation_config.agent.first_message).toBe(greeting(t, "en", "gulf"));
    expect(c.conversation_config.language_presets.ar.overrides.agent.first_message).toBe(greeting(t, "ar", "gulf"));
  });
  it("keeps following ELEVENLABS_LLM when no model was chosen", () => {
    process.env.ELEVENLABS_LLM = "gpt-4.1-mini";
    try {
      expect(buildAgentConfig({ tenant: t, settings: base(), toolIds: [], appUrl: "https://a.example" }).conversation_config.agent.prompt.llm).toBe("gpt-4.1-mini");
      expect(buildAgentConfig({ tenant: t, settings: { ...base(), studio: { llm: "gpt-5.4" } }, toolIds: [], appUrl: "https://a.example" }).conversation_config.agent.prompt.llm).toBe("gpt-5.4");
    } finally { delete process.env.ELEVENLABS_LLM; }
  });
});

const names = (settings: AgentSettings) => buildExtras({ tenant: tenant(), doctors: [], settings }).map((g) => g.name);
const groupOf = (settings: AgentSettings, name: string) => buildExtras({ tenant: tenant(), doctors: [{ name: "Dr. Ali" }], settings }).find((g) => g.name === name)?.body;

describe("an agent whose studio was saved", () => {
  const saved = (section: SectionId, studio: Record<string, unknown>, top: Partial<AgentSettings> = {}): AgentSettings => ({ ...base(), ...top, studio: { touched: [section], ...studio } });

  it("sends the newer groups only for the sections that were saved", () => {
    expect(names(base())).toEqual(["tools", "hardening", "keywords", "guardrails", "analysis", "privacy", "limits", "widget", "branding", "tags"]);
    expect(names(saved("model", {}))).toContain("model");
    expect(names(saved("model", {}))).not.toContain("voice");
    expect(names(saved("voice", {}))).toContain("voice");
    expect(names(saved("conversation", {}))).toContain("turn");
    expect(names(saved("hearing", { asrProvider: "scribe_realtime" }))).toContain("hearing");
    expect(names(saved("hearing", {}))).toContain("hearing"); // a saved section always sends the provider, so choosing the standard one again really switches back
    expect(names(base())).not.toContain("hearing");
  });
  it("puts the standard speech recognition back when a saved hearing section is reset", () => {
    const turbo = saved("hearing", { asrProvider: "scribe_v2_turbo" });
    expect(groupOf(turbo, "hearing")).toEqual({ conversation_config: { asr: { provider: "scribe_v2_turbo" } } });
    expect(groupOf(resetSection(turbo, "hearing"), "hearing")).toEqual({ conversation_config: { asr: { provider: "scribe_realtime" } } });
  });
  it("sends the model options, with 'no limit' as -1 and the backup in the form ElevenLabs expects", () => {
    expect(groupOf(saved("model", {}), "model")).toEqual({ conversation_config: { agent: { prompt: { max_tokens: -1, reasoning_effort: null, enable_parallel_tool_calls: true, backup_llm_config: { preference: "default" }, cascade_timeout_seconds: 4 } } } });
    expect(groupOf(saved("model", { maxTokens: 300, reasoningEffort: "low", parallelTools: true, backupMode: "custom", backupModels: ["gpt-4.1", "gemini-2.5-flash"], cascadeSeconds: 6 }), "model")).toEqual({
      conversation_config: { agent: { prompt: { max_tokens: 300, reasoning_effort: "low", enable_parallel_tool_calls: true, backup_llm_config: { preference: "override", order: ["gpt-4.1", "gemini-2.5-flash"] }, cascade_timeout_seconds: 6 } } },
    });
    expect((groupOf(saved("model", { backupMode: "disabled" }), "model") as { conversation_config: { agent: { prompt: { backup_llm_config: unknown } } } }).conversation_config.agent.prompt.backup_llm_config).toEqual({ preference: "disabled" });
  });
  it("never sends a longest reply below the minimum, even for a value saved before there was one", () => {
    const sent = (maxTokens: number) => (groupOf(saved("model", { maxTokens }), "model") as { conversation_config: { agent: { prompt: { max_tokens: number } } } }).conversation_config.agent.prompt.max_tokens;
    expect(sent(50)).toBe(LIMITS.maxTokens[0]);
    expect(sent(299)).toBe(LIMITS.maxTokens[0]);
    expect(sent(800)).toBe(800);
    expect(sent(0)).toBe(-1);
  });
  it("puts the chosen model, voice models, duration and greetings into the core agent", () => {
    const s = saved("model", { llm: "gpt-5.4-mini", ttsModelEn: "eleven_multilingual_v2", ttsModelAr: "eleven_v3_conversational", maxDurationSeconds: 1200, greetingEn: "Welcome to {name}!", greetingAr: "أهلا في {name}" }, { temperature: 0.6, voiceEn: "ENvoice12345", voiceAr: "ARvoice12345" });
    const c = buildAgentConfig({ tenant: tenant(), settings: s, toolIds: [], appUrl: "https://a.example" });
    expect(c.conversation_config.agent.prompt).toMatchObject({ llm: "gpt-5.4-mini", temperature: 0.6 });
    expect(c.conversation_config.tts).toEqual({ voice_id: "ENvoice12345", model_id: "eleven_multilingual_v2" });
    expect(c.conversation_config.language_presets.ar.overrides.tts).toEqual({ voice_id: "ARvoice12345", model_id: "eleven_v3_conversational" });
    expect(c.conversation_config.conversation.max_duration_seconds).toBe(1200);
    expect(c.conversation_config.agent.first_message).toBe("Welcome to Al Noor!");
    expect(c.conversation_config.language_presets.ar.overrides.agent.first_message).toBe("أهلا في مركز النور");
  });
  it("sends the voice tuning for both languages", () => {
    expect(groupOf(saved("voice", { stability: 0.3, similarity: 0.9, speed: 1.1, textNormalisation: "elevenlabs", expressive: true }), "voice")).toEqual({
      conversation_config: {
        tts: { stability: 0.3, similarity_boost: 0.9, speed: 1.1, text_normalisation_type: "elevenlabs", expressive_mode: true },
        language_presets: { ar: { overrides: { tts: { stability: 0.3, similarity_boost: 0.9, speed: 1.1 } } } },
      },
    });
  });
  it("sends the turn-taking options, -1 for 'off', and the filler in the caller's language", () => {
    expect(groupOf(saved("conversation", { turnEagerness: "patient", turnTimeout: 12, spellingPatience: "off", speculativeTurn: true, softTimeoutSeconds: 3, maxDurationMessage: "Goodbye" }), "turn")).toEqual({
      conversation_config: {
        agent: { max_conversation_duration_message: "Goodbye" },
        turn: { turn_eagerness: "patient", turn_timeout: 12, spelling_patience: "off", speculative_turn: true, soft_timeout_config: { timeout_seconds: 3, message: "One moment please.", use_llm_generated_message: false } },
        language_presets: { ar: { overrides: { turn: { soft_timeout_config: { message: "لحظة من فضلك." } } } } },
      },
    });
    expect((groupOf(saved("conversation", {}), "turn") as { conversation_config: { turn: { soft_timeout_config: { timeout_seconds: number } } } }).conversation_config.turn.soft_timeout_config.timeout_seconds).toBe(-1);
  });
  it("uses the hang-up time and greeting protection from the studio, and -1 when silence may last", () => {
    expect(groupOf(saved("conversation", { silenceEndSeconds: 60, protectGreeting: false }), "hardening")).toEqual({
      conversation_config: { agent: { disable_first_message_interruptions: false, prompt: { timezone: "Asia/Bahrain" } }, turn: { silence_end_call_timeout: 60 } },
    });
    expect((groupOf(saved("conversation", { silenceEndSeconds: 0 }), "hardening") as { conversation_config: { turn: { silence_end_call_timeout: number } } }).conversation_config.turn.silence_end_call_timeout).toBe(-1);
  });
  it("lists the extra words first, then the clinic and doctor names, and sets the speech recognition", () => {
    const body = groupOf(saved("hearing", { extraKeywords: ["Panadol", "Dr. Ali"], asrProvider: "scribe_realtime" }), "keywords") as { conversation_config: { asr: { keywords: string[] } } };
    expect(body.conversation_config.asr.keywords.slice(0, 3)).toEqual(["Panadol", "Dr. Ali", "Al Noor Medical Center"]);
    expect(body.conversation_config.asr.keywords.filter((k) => k === "Dr. Ali")).toHaveLength(1);
    expect(groupOf(saved("hearing", { asrProvider: "scribe_realtime" }), "hearing")).toEqual({ conversation_config: { asr: { provider: "scribe_realtime" } } });
  });
  it("applies the safety choices: checks, recording, limits and bursting", () => {
    const s = saved("safety", { guardFocus: false, guardInjection: true, recordVoice: false, dailyLimit: 120, concurrencyLimit: 5, bursting: false });
    expect(groupOf(s, "guardrails")).toEqual({ platform_settings: { guardrails: { version: "1", focus: { is_enabled: false }, prompt_injection: { is_enabled: true } } } });
    expect(groupOf(s, "privacy")).toEqual({ platform_settings: { privacy: { record_voice: false, retention_days: 90 } } });
    expect(groupOf(s, "limits")).toEqual({ platform_settings: { call_limits: { daily_limit: 120, agent_concurrency_limit: 5, bursting_enabled: false } } });
    expect((groupOf(saved("safety", { concurrencyLimit: 0 }), "limits") as { platform_settings: { call_limits: { agent_concurrency_limit: number } } }).platform_settings.call_limits.agent_concurrency_limit).toBe(-1);
  });
  it("leaves out the evaluation criteria an admin switched off and sets the summary language", () => {
    const body = groupOf(saved("analysis", { criteriaOff: ["no_medical_advice"], summaryLanguage: "ar" }), "analysis") as { platform_settings: { evaluation: { criteria: { id: string }[] }; summary_language: string } };
    expect(body.platform_settings.evaluation.criteria.map((c) => c.id)).toEqual(["need_resolved", "details_confirmed", "caller_language"]);
    expect(body.platform_settings.summary_language).toBe("ar");
    expect((groupOf(saved("analysis", {}), "analysis") as { platform_settings: { summary_language: unknown } }).platform_settings.summary_language).toBeNull();
    expect(groupOf(base(), "analysis")).not.toHaveProperty("platform_settings.summary_language");
  });
  it("paints the widget in the brand colour or in custom colours, and blank texts put ElevenLabs' words back", () => {
    const w = (o: Record<string, unknown>) => (groupOf(saved("widget", { widget: o }), "widget") as { platform_settings: { widget: Record<string, unknown> } }).platform_settings.widget;
    expect(w({ colors: "brand", btnColor: "#aa0000" })).toMatchObject({ btn_color: "#0e7c86", btn_text_color: "#ffffff", focus_color: "#0e7c86", variant: "full", placement: "bottom-right", action_text: null, start_call_text: null });
    expect(w({ colors: "custom", btnColor: "#aa0000", btnTextColor: "#fefefe", bgColor: "#101010", actionText: "Talk to us", variant: "compact", placement: "bottom-left", micMuting: true })).toMatchObject({
      bg_color: "#101010", btn_color: "#aa0000", btn_text_color: "#fefefe", focus_color: "#aa0000", action_text: "Talk to us", variant: "compact", placement: "bottom-left", mic_muting_enabled: true,
    });
  });
  it("hides the widget's \"Powered by\" line unless an admin turns that off, and keeps it apart from the widget look", () => {
    const banner = (settings: AgentSettings) => (groupOf(settings, "branding") as { platform_settings: { widget: Record<string, unknown> } }).platform_settings.widget;
    expect(banner(base())).toEqual({ disable_banner: true }); // a studio that was never saved
    expect(banner(saved("widget", {}))).toEqual({ disable_banner: true }); // a widget section saved before the option existed
    expect(banner(saved("widget", { widget: { hideBanner: false } }))).toEqual({ disable_banner: false });
    expect(banner(saved("model", { widget: { hideBanner: false } }))).toEqual({ disable_banner: false }); // the choice stands whichever section was saved last
    // the look group does not carry the flag, so a refusal of one never costs the other
    expect(JSON.stringify(groupOf(saved("widget", {}), "widget"))).not.toContain("disable_banner");
    expect(JSON.stringify(groupOf(base(), "widget"))).not.toContain("disable_banner");
  });
  it("sends the look and the \"Powered by\" flag together in one widget object when ElevenLabs takes everything at once", () => {
    const every = saved("widget", {});
    const core = buildAgentConfig({ tenant: tenant(), settings: every, toolIds: [], appUrl: "https://a.example" });
    const widget = ((withExtras(core as unknown as Record<string, unknown>, buildExtras({ tenant: tenant(), doctors: [], settings: every })) as { platform_settings: { widget: Record<string, unknown> } }).platform_settings.widget);
    expect(widget).toMatchObject({ disable_banner: true, btn_color: "#0e7c86", variant: "full" });
  });
  it("is accepted by ElevenLabs' own field names: no group repeats a key another group set differently", () => {
    const every = saved("model", {}) as AgentSettings;
    every.studio = { touched: ["model", "voice", "conversation", "hearing", "safety", "analysis", "widget"], asrProvider: "scribe_realtime" };
    const core = buildAgentConfig({ tenant: tenant(), settings: every, toolIds: [], appUrl: "https://a.example" });
    const merged = withExtras(core as unknown as Record<string, unknown>, buildExtras({ tenant: tenant(), doctors: [], settings: every }));
    // the limits' bounds are the documented ones
    expect(LIMITS.speed).toEqual([0.7, 1.2]);
    expect(JSON.stringify(merged)).toContain('"turn_eagerness":"normal"');
  });
});

describe("the outcome field the call analysis reads is untouched", () => {
  it("is still part of the data collection", () => {
    expect(DATA_COLLECTION.outcome).toBe(OUTCOME_ITEM);
  });
});
