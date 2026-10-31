import { describe, expect, it } from "vitest";
import { DATA_COLLECTION, EVALUATION_CRITERIA, agentTags, buildExtras, criteriaFor, dataCollectionFor } from "@/lib/agent-extras";
import { STUDIO_DEFAULTS, applySection, audioTagLines, parseAudioTags, parseSection, resetSection, studioOf, type SectionId } from "@/lib/agent-studio";
import { mapEffects, mapLiveAgent } from "@/lib/elevenlabs-catalog";
import { checkHoldAudio, deleteHoldAudio, uploadHoldAudio, HOLD_AUDIO_MAX_BYTES } from "@/lib/hold-audio";
import { readLiveValues } from "@/lib/studio-import";
import { BUILTIN_VALUES, diffValues, recommendedFor } from "@/lib/studio-profiles";
import { agent } from "@/lib/seed";
import type { AgentSettings, Tenant } from "@/lib/types";

const base = (): AgentSettings => agent("", "Glow Salon");
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.append(k, v);
  return f;
};
const saved = (section: SectionId, studio: Record<string, unknown>): AgentSettings => ({ ...base(), studio: { touched: [section], ...studio } });
const salon = { name: "Glow Salon", branding: { displayName: "Glow", displayNameAr: "", primaryColor: "#aa3366" }, retentionDays: 90, allowedDomains: [], business: { type: "salon" as const } };
const clinic = { ...salon, name: "Al Noor", business: undefined };
const group = (settings: AgentSettings, name: string, t: Parameters<typeof buildExtras>[0]["tenant"] = clinic) =>
  buildExtras({ tenant: t, doctors: [], settings }).find((g) => g.name === name)?.body;

describe("V3 styles", () => {
  it("reads one style per line, with or without when to use it, and shows them back the same way", () => {
    const { tags, tooLong } = parseAudioTags("warm: when greeting\n[reassuring] - when the caller is worried\n\napologetic\nWarm: again");
    expect(tooLong).toBe(false);
    expect(tags).toEqual([{ tag: "warm", description: "when greeting" }, { tag: "reassuring", description: "when the caller is worried" }, { tag: "apologetic", description: "" }]);
    expect(audioTagLines(tags)).toBe("warm: when greeting\nreassuring: when the caller is worried\napologetic");
    expect(parseAudioTags(`${"x".repeat(31)}: too long`).tooLong).toBe(true);
  });
});

describe("the new options in the section forms", () => {
  const conversation = {
    more: "1", turnEagerness: "normal", turnTimeout: "7", silenceEndSeconds: "30", spellingPatience: "auto", maxDurationSeconds: "900", maxDurationMessage: "",
    softTimeoutSeconds: "0", softTimeoutMessageEn: "One moment please.", softTimeoutMessageAr: "لحظة", greetingEn: "", greetingAr: "",
    backgroundSound: "office1", backgroundVolume: "0.3", initialWaitSeconds: "0", ignoreTerms: "okay\nتمام, زين", ignoreDefaults: "on", turnModel: "turn_v3", chatFiles: "on", chatFilesMax: "4",
  };
  it("reads background sound, interruptions, turn model and chat files", () => {
    const r = parseSection("conversation", form(conversation), base());
    expect(r.errors).toEqual([]);
    expect(r.studio).toMatchObject({ backgroundSound: "office1", backgroundVolume: 0.3, initialWaitSeconds: 0, ignoreTerms: ["okay", "تمام", "زين"], ignoreDefaults: true, turnModel: "turn_v3", chatFiles: true, chatFilesMax: 4 });
  });
  it("refuses an unknown sound and a first wait under one second", () => {
    const r = parseSection("conversation", form({ ...conversation, backgroundSound: "jungle", initialWaitSeconds: "0.5" }), base());
    expect(r.errors.map((e) => e.field).sort()).toEqual(["backgroundSound", "initialWaitSeconds"]);
  });
  it("keeps the newer options of an older form that does not show them", () => {
    const before = { ...base(), studio: { queueEnabled: false, queueWaitSeconds: 120, tags: ["vip"] } };
    const { more: _more, ...old } = { more: "1", guardFocus: "on", guardInjection: "on", recordVoice: "on", dailyLimit: "500", concurrencyLimit: "0" };
    const r = parseSection("safety", form(old), before);
    expect(r.errors).toEqual([]);
    expect(r.studio.queueEnabled).toBeUndefined();
    expect(studioOf(applySection(before, "safety", r))).toMatchObject({ queueEnabled: false, queueWaitSeconds: 120 });
  });
  it("reads the queue, the speed tier, the effects and the labels, and resets them", () => {
    const safety = parseSection("safety", form({ more: "1", guardFocus: "on", dailyLimit: "500", concurrencyLimit: "0", queueEnabled: "on", queueWaitSeconds: "90" }), base());
    expect(safety.studio).toMatchObject({ queueEnabled: true, queueWaitSeconds: 90 });
    const analysis = parseSection("analysis", form({ more: "1", summaryLanguage: "", tags: "Bahrain\nPilot, Pilot" }), base());
    expect(analysis.studio.tags).toEqual(["Bahrain", "Pilot"]);
    const voice = parseSection("voice", form({
      more: "1", voiceEn: "voice_en_f", voiceAr: "voice_ar_f", ttsModelEn: "eleven_flash_v2", ttsModelAr: "eleven_flash_v2_5", stability: "0.5", similarity: "0.8", speed: "1",
      textNormalisation: "system_prompt", audioTags: "warm", effectFilter: "phone", effectEnvironment: "", effectNoise: "bad id!", effectDistance: "0.25",
    }), base());
    expect(voice.errors).toEqual([{ field: "effectNoise", key: "studio.err.choice" }]);
    expect(voice.studio).toMatchObject({ audioTags: [{ tag: "warm", description: "" }], effectFilter: "phone", effectEnvironment: "", effectNoise: "", effectDistance: 0.25 });
    const after = applySection(base(), "safety", safety);
    expect(studioOf(resetSection(after, "safety")).queueWaitSeconds).toBe(STUDIO_DEFAULTS.queueWaitSeconds);
  });
});

describe("what is sent to ElevenLabs", () => {
  it("sends each newer option in its own group, only for a saved section", () => {
    expect(group(base(), "sound")).toBeUndefined();
    expect(group(saved("model", { serviceTier: "fast" }), "tier")).toEqual({ conversation_config: { agent: { prompt: { service_tier: "fast" } } } });
    expect(group(saved("model", {}), "tier")).toEqual({ conversation_config: { agent: { prompt: { service_tier: null } } } });
    expect(group(saved("conversation", { backgroundSound: "office2", backgroundVolume: 0.15 }), "sound")).toEqual({
      conversation_config: { conversation: { background_sound: { source_type: "preset", source_id: "office2", volume: 0.15, crossfade_loop: true } } },
    });
    expect(group(saved("conversation", {}), "sound")).toEqual({ conversation_config: { conversation: { background_sound: null } } });
    expect(group(saved("conversation", { ignoreTerms: ["okay"], ignoreDefaults: true, initialWaitSeconds: 4, turnModel: "turn_v3" }), "interrupt")).toEqual({
      conversation_config: { turn: { initial_wait_time: 4, interruption_ignore_terms: ["okay"], interruption_ignore_term_languages: ["en", "ar"], merge_with_default_ignore_terms: true, turn_model: "turn_v3" } },
    });
    expect(group(saved("conversation", { chatFiles: true, chatFilesMax: 2 }), "files")).toEqual({ conversation_config: { conversation: { file_input: { enabled: true, max_files_per_conversation: 2, max_files_in_memory: 2 } } } });
    expect(group(saved("safety", { queueWaitSeconds: 45 }), "queue")).toEqual({ platform_settings: { queueing_config: { enabled: true, wait_timeout_seconds: 45 } } });
  });
  it("sends the voice effects and styles, or no effects at all", () => {
    expect(group(saved("voice", { effectFilter: "phone", effectDistance: 0.2, audioTags: [{ tag: "warm", description: "greeting" }, { tag: "calm", description: "" }] }), "effects")).toEqual({
      conversation_config: { tts: { suggested_audio_tags: [{ tag: "warm", description: "greeting" }, { tag: "calm" }], audio_effects: { filter_preset_id: "phone", distance: 0.2 } } },
    });
    expect(group(saved("voice", {}), "effects")).toEqual({ conversation_config: { tts: { suggested_audio_tags: [], audio_effects: null } } });
  });
  it("labels the agent with CallsDash, the business type and the admin's own labels", () => {
    expect(agentTags(salon, ["Bahrain", "callsdash", "salon"])).toEqual(["CallsDash", "salon", "Bahrain"]);
    expect(group(saved("analysis", { tags: ["Pilot"] }), "tags", salon)).toEqual({ tags: ["CallsDash", "salon", "Pilot"] });
  });
});

describe("analysis in the client's own words", () => {
  it("keeps a clinic's criteria and data collection exactly as they were", () => {
    expect(criteriaFor(clinic)).toBe(EVALUATION_CRITERIA);
    expect(dataCollectionFor(clinic)).toBe(DATA_COLLECTION);
  });
  it("speaks of customers and staff for a salon, and does not judge it on medical advice", () => {
    const c = criteriaFor(salon);
    expect(c.map((x) => x.id)).not.toContain("no_medical_advice");
    const all = JSON.stringify([c, dataCollectionFor(salon)]);
    expect(all).not.toMatch(/patient|clinic|doctor|medical|appointment/i);
    expect(all).toContain("customer");
    expect(Object.keys(dataCollectionFor(salon))).toEqual(Object.keys(DATA_COLLECTION));
  });
});

describe("reading the new options from ElevenLabs", () => {
  const live = mapLiveAgent({
    tags: ["CallsDash", "salon", "Pilot"],
    conversation_config: {
      agent: { prompt: { service_tier: "fast" } },
      tts: { suggested_audio_tags: [{ tag: "warm", description: "hi" }], audio_effects: { filter_preset_id: "phone", distance: 0.3 } },
      turn: { initial_wait_time: 5, interruption_ignore_terms: ["ok"], merge_with_default_ignore_terms: true, turn_model: "turn_v3" },
      conversation: { background_sound: { source_type: "preset", source_id: "city", volume: 0.4 }, file_input: { enabled: true, max_files_per_conversation: 3 } },
    },
    platform_settings: { queueing_config: { enabled: false, wait_timeout_seconds: 30, hold_audio: { original_filename: "music.mp3", audio_url: "https://cdn.example/m.mp3", duration_secs: 42 } } },
  });
  it("maps them from ElevenLabs' answer", () => {
    expect(live).toMatchObject({
      serviceTier: "fast", audioTags: [{ tag: "warm", description: "hi" }], effectFilter: "phone", effectEnvironment: "", effectDistance: 0.3,
      backgroundSound: "city", backgroundVolume: 0.4, initialWaitSeconds: 5, ignoreTerms: ["ok"], ignoreDefaults: true, turnModel: "turn_v3",
      chatFiles: true, chatFilesMax: 3, queueEnabled: false, queueWaitSeconds: 30, holdAudio: { name: "music.mp3", url: "https://cdn.example/m.mp3", seconds: 42 }, tags: ["CallsDash", "salon", "Pilot"],
    });
    expect(mapLiveAgent({}).holdAudio).toBeUndefined();
  });
  it("takes them into CallsDash with Read from ElevenLabs, leaving out the labels CallsDash adds itself", () => {
    const v = readLiveValues({ settings: base(), tenant: salon, doctors: [], live });
    expect(v).toMatchObject({ serviceTier: "fast", backgroundSound: "city", backgroundVolume: 0.4, initialWaitSeconds: 5, turnModel: "turn_v3", chatFiles: true, queueEnabled: false, tags: ["Pilot"] });
    const { candidate } = diffValues(base(), v);
    expect(studioOf(candidate)).toMatchObject({ effectFilter: "phone", ignoreTerms: ["ok"], queueWaitSeconds: 30 });
  });
  it("reads the effects catalogue", () => {
    expect(mapEffects({ filter_presets: [{ filter_preset_id: "phone", name: "Phone" }], environments: [{ environment_id: "hall", name: "Hall", description: "big" }], background_noises: [{ name: "no id" }] })).toEqual({
      filters: [{ id: "phone", name: "Phone", description: undefined }], environments: [{ id: "hall", name: "Hall", description: "big" }], noises: [],
    });
  });
});

describe("recommended values", () => {
  it("lists each section's recommended values and leaves the client's own choices out", () => {
    expect(recommendedFor("safety")).toMatchObject({ queueEnabled: true, queueWaitSeconds: 60, guardFocus: true });
    expect(Object.keys(recommendedFor("hearing"))).toEqual(["asrProvider"]);
    expect(recommendedFor("voice")).not.toHaveProperty("voiceEn");
    expect(recommendedFor("conversation")).not.toHaveProperty("greetingEn");
    expect(recommendedFor("conversation")).toMatchObject({ ignoreDefaults: true, backgroundSound: "" });
    expect(Object.keys(recommendedFor("widget")).every((k) => k.startsWith("w."))).toBe(true);
  });
  it("puts them on one section only", () => {
    const custom = { ...base(), studio: { touched: ["safety", "conversation"] as SectionId[], queueEnabled: false, softTimeoutSeconds: 0 } };
    const { candidate, changes } = diffValues(custom, recommendedFor("safety"));
    expect(changes.map((c) => c.key)).toEqual(["queueEnabled"]);
    expect(studioOf(candidate).softTimeoutSeconds).toBe(0);
    expect(BUILTIN_VALUES.recommended).toMatchObject(recommendedFor("safety"));
  });
});

describe("hold audio", () => {
  it("takes an MP3 or WAV under the size limit", () => {
    expect(checkHoldAudio(null)).toBe("missing");
    expect(checkHoldAudio({ name: "a.mp3", size: 0, type: "" })).toBe("missing");
    expect(checkHoldAudio({ name: "a.mp3", size: HOLD_AUDIO_MAX_BYTES + 1, type: "audio/mpeg" })).toBe("too_big");
    expect(checkHoldAudio({ name: "a.png", size: 10, type: "image/png" })).toBe("not_audio");
    expect(checkHoldAudio({ name: "Hold.WAV", size: 10, type: "" })).toBeNull();
    expect(checkHoldAudio({ name: "clip", size: 10, type: "audio/mpeg" })).toBeNull();
  });
  it("uploads it to the agent and removes it, a clip already gone counting as removed", async () => {
    const calls: { url: string; method?: string; file?: unknown }[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, file: init?.body instanceof FormData ? (init.body.get("hold_audio_file") as File).name : undefined });
      return new Response("", { status: init?.method === "DELETE" ? 404 : 200 });
    }) as unknown as typeof fetch;
    await uploadHoldAudio("k", "agent_1", new Blob(["x"]), "my music.mp3", fake);
    await deleteHoldAudio("k", "agent_1", fake);
    expect(calls).toEqual([
      { url: expect.stringMatching(/\/v1\/convai\/agents\/agent_1\/hold-audio$/), method: "POST", file: "my music.mp3" },
      { url: expect.stringMatching(/\/v1\/convai\/agents\/agent_1\/hold-audio$/), method: "DELETE", file: undefined },
    ]);
    const refusing = (async () => new Response("bad file", { status: 422 })) as unknown as typeof fetch;
    await expect(uploadHoldAudio("k", "agent_1", new Blob(["x"]), "a.mp3", refusing)).rejects.toThrow();
  });
});

// the salon tenant type above is a sketch of the fields the code reads
void ({} as Tenant);
