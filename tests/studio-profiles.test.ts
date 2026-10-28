import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// the dictionaries live in a server-only module; the marker import is harmless here
vi.mock("server-only", () => ({}));

import { dictionaries } from "@/lib/i18n";
import { buildAgentConfig } from "@/lib/agent-config";
import { buildExtras, withExtras } from "@/lib/agent-extras";
import { SECTIONS, studioOf } from "@/lib/agent-studio";
import { ttsAllowed } from "@/lib/agent-catalog";
import { mapLiveAgent } from "@/lib/elevenlabs-catalog";
import { checkCandidate } from "@/lib/studio-apply";
import { importLive, previewLive, readLiveValues } from "@/lib/studio-import";
import {
  BUILTIN_IDS, BUILTIN_VALUES, FIELDS, PROFILE_LIMITS, addProfile, applyValues, cleanProfile, diffValues, getField, loadProfiles, removeProfile,
  renameProfile, snapshot,
} from "@/lib/studio-profiles";
import { DEFAULT_OPENING_HOURS } from "@/lib/availability";
import { DEFAULT_RULES } from "@/lib/flags";
import type { AgentSettings, Tenant } from "@/lib/types";

const en = dictionaries.en as Record<string, string>;
const ar = dictionaries.ar as Record<string, string>;

const tenant = (o: Partial<Tenant> = {}): Tenant => ({
  id: "t", slug: "al-noor", name: "Al Noor Medical Center", status: "live",
  branding: { displayName: "Al Noor", displayNameAr: "مركز النور", primaryColor: "#0f766e" },
  plans: [], alertRules: structuredClone(DEFAULT_RULES), permissions: { editPrompt: true, editVoice: true, editBehaviour: true, editKnowledge: true },
  allowedDomains: ["alnoor.example.bh"], zeroBalancePolicy: "pause", lowBalanceThreshold: 0.15, retentionDays: 90, calendarConnected: false,
  openingHours: DEFAULT_OPENING_HOURS, channels: { website: "pending", whatsapp: "off", instagram: "off", phone: "off" }, onboarding: { done: [] }, integrations: {}, createdAt: "2026-01-01T00:00:00Z", ...o,
});
const settings = (o: Partial<AgentSettings> = {}): AgentSettings => ({
  elevenLabsAgentId: "agent_1", prompt: {} as never, temperature: 0.3, replyLength: "normal", formality: "polite", arabicWrittenStyle: "gulf",
  voiceEn: "EXAVITQu4vr4xnSDxMaL", voiceAr: "pNInz6obpgDQGcFmaJgB", ...o,
});
const doctors = [{ name: "Dr Sara" }];

/** What ElevenLabs would hold after CallsDash synced these settings: the real builders, read back the way the studio reads an agent. */
function liveAfterSync(t: Tenant, s: AgentSettings) {
  const core = buildAgentConfig({ tenant: t, settings: s, doctors: [], toolIds: [], appUrl: "https://x.example" }) as unknown as Record<string, unknown>;
  const body = withExtras(core, buildExtras({ tenant: t, doctors, settings: s }));
  return mapLiveAgent(body);
}

describe("the settings list", () => {
  it("has a label in both languages and a hint in both languages for every setting", () => {
    for (const x of FIELDS) {
      const label = `studio.f.${x.key === "offeredVoices" ? "offered" : x.key}`;
      expect(en[label], label).toBeTruthy();
      expect(ar[label], label).toBeTruthy();
      expect(en[`prof.h.${x.hint}`], x.hint).toBeTruthy();
      expect(ar[`prof.h.${x.hint}`], x.hint).toBeTruthy();
    }
    for (const s of SECTIONS) expect(FIELDS.some((x) => x.section === s)).toBe(true);
  });

  it("covers every option of every studio section, so a saved profile holds all settings", () => {
    const keys = new Set(FIELDS.map((x) => x.key));
    const src = readFileSync(join(__dirname, "..", "lib/agent-studio.ts"), "utf8");
    const fields = [...src.matchAll(/\br\.(?:num|choice|color|str|para|on)\(\s*"([\w.]+)"/g)].map((m) => m[1]);
    for (const k of [...fields, "llm", "temperature", "voiceEn", "voiceAr", "backupModels", "offeredVoices", "extraKeywords", "criteriaOff", "greetingEn", "greetingAr"]) expect(keys.has(k), k).toBe(true);
  });

  it("has the texts of the screen and of every built-in profile in both languages", () => {
    const page = readFileSync(join(__dirname, "..", "app/(admin)/admin/clients/[id]/assistant/profiles/page.tsx"), "utf8");
    const keys = new Set([...page.matchAll(/\bT\(\s*"(prof\.[\w.]+)"/g)].map((m) => m[1]));
    for (const b of BUILTIN_IDS) for (const k of ["name", "who", "impact", "why1", "why2", "why3"]) keys.add(`prof.b.${b}.${k}`);
    for (const k of ["maxTokens", "silenceEndSeconds", "concurrencyLimit", "softTimeoutSeconds"]) keys.add(`prof.zero.${k}`);
    for (const k of ["name", "nameTaken", "full", "missing"]) keys.add(`prof.err.${k}`);
    for (const k of ["applied", "saved", "imported", "nothing", "profileSaved", "renamed", "deleted"]) keys.add(`prof.done.${k}`);
    for (const k of keys) {
      expect(en[k], `en ${k}`).toBeTruthy();
      expect(ar[k], `ar ${k}`).toBeTruthy();
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
      expect(ph(ar[k]), k).toBe(ph(en[k]));
    }
  });
});

describe("built-in profiles", () => {
  it("offers at least three, and the first is the suggested one", () => {
    expect(BUILTIN_IDS.length).toBeGreaterThanOrEqual(3);
    expect(BUILTIN_IDS[0]).toBe("recommended");
  });

  it("holds only values the studio accepts as they are (nothing is clamped or reset to a default)", () => {
    for (const id of BUILTIN_IDS) {
      const values = BUILTIN_VALUES[id];
      const after = applyValues(settings(), values);
      for (const [k, v] of Object.entries(values)) expect(getField(after, k), `${id}.${k}`).toEqual(v);
    }
  });

  it("uses voice models that suit the language", () => {
    for (const id of BUILTIN_IDS) {
      const v = BUILTIN_VALUES[id];
      expect(ttsAllowed("en", v.ttsModelEn as string, "eleven_flash_v2"), id).toBe(true);
      expect(ttsAllowed("ar", v.ttsModelAr as string, "eleven_flash_v2_5"), id).toBe(true);
    }
  });

  it("never touches the client's own voices, greetings, extra words, widget look or list of offered voices", () => {
    for (const id of BUILTIN_IDS) {
      for (const k of ["voiceEn", "voiceAr", "offeredVoices", "greetingEn", "greetingAr", "extraKeywords", "w.bgColor", "w.btnColor", "w.actionText", "w.borderRadius"]) expect(k in BUILTIN_VALUES[id], `${id}.${k}`).toBe(false);
    }
  });

  it("differ from each other in the ways their hints say", () => {
    expect(BUILTIN_VALUES.lowcost.maxDurationSeconds).toBeLessThan(BUILTIN_VALUES.recommended.maxDurationSeconds as number);
    expect(BUILTIN_VALUES.lowcost.bursting).toBe(false);
    expect(BUILTIN_VALUES.premium.ttsModelEn).toBe("eleven_v4_turbo");
    expect(BUILTIN_VALUES.patient.turnEagerness).toBe("patient");
    expect(BUILTIN_VALUES.patient.speed).toBeLessThan(1);
  });
});

describe("applying a profile", () => {
  it("changes exactly the settings it holds and marks their sections as saved", () => {
    const cur = settings({ temperature: 0.7, studio: { greetingEn: "Hi from {name}. This is recorded.", asrProvider: "scribe_v2_turbo" } });
    const after = applyValues(cur, BUILTIN_VALUES.lowcost);
    const st = studioOf(after);
    expect(after.temperature).toBe(0.2);
    expect(st.llm).toBe("gemini-2.5-flash-lite");
    expect(st.greetingEn).toBe("Hi from {name}. This is recorded."); // not in the profile: kept
    expect(st.touched.sort()).toEqual([...SECTIONS].sort());
    expect(after.voiceEn).toBe(cur.voiceEn);
  });

  it("lists what would change, and nothing when the client already has the profile", () => {
    const cur = settings({ studio: { llm: "gemini-2.5-flash" } });
    const { changes } = diffValues(cur, BUILTIN_VALUES.lowcost);
    expect(changes.map((c) => c.key)).toContain("llm");
    expect(changes.find((c) => c.key === "llm")).toMatchObject({ here: "gemini-2.5-flash", next: "gemini-2.5-flash-lite" });
    const once = applyValues(cur, BUILTIN_VALUES.lowcost);
    expect(diffValues(once, BUILTIN_VALUES.lowcost).changes).toEqual([]);
  });

  it("puts a saved snapshot back exactly, including voices, greetings and the widget", () => {
    const a = applyValues(settings({ voiceEn: "voice_en_f" }), {
      ...BUILTIN_VALUES.premium, greetingAr: "أهلاً بكم في {name}. المحادثة مسجلة.", extraKeywords: ["Botox", "Invisalign"], "w.colors": "custom", "w.bgColor": "#112233", "w.actionText": "Talk to us",
      criteriaOff: ["caller_language"], backupMode: "custom", backupModels: ["gpt-6-luna"],
    });
    const snap = snapshot(a);
    const b = applyValues(settings({ temperature: 0.9, voiceEn: "other_voice_id" }), snap);
    expect(snapshot(b)).toEqual(snap);
    expect(b.voiceEn).toBe("voice_en_f");
  });

  it("keeps a wrong value out: an unknown choice or a number out of range never reaches the assistant", () => {
    const after = applyValues(settings(), { turnEagerness: "wild", turnTimeout: 999, temperature: 7, voiceEn: "no spaces allowed", unknownKey: 1 });
    const st = studioOf(after);
    expect(st.turnEagerness).toBe("normal");
    expect(st.turnTimeout).toBe(30);
    expect(after.temperature).toBe(1);
    expect(after.voiceEn).toBe(settings().voiceEn);
  });

  it("checks the model against ElevenLabs' list before sending anything", () => {
    const cur = settings();
    const { candidate } = diffValues(cur, BUILTIN_VALUES.premium);
    const rows = [{ id: "gemini-2.5-flash", reasoningEfforts: [], maxOutputTokens: 65000 }] as never;
    expect(checkCandidate(candidate, cur, { models: rows, listed: true }).map((e) => e.field)).toContain("llm");
    expect(checkCandidate(candidate, cur, { models: rows, listed: false })).toEqual([]);
  });
});

describe("saved profiles", () => {
  const memory = () => {
    const m = new Map<string, unknown>();
    return { getSetting: async (k: string) => m.get(k), setSetting: async (k: string, v: unknown) => { m.set(k, v); } };
  };

  it("are added, found, renamed and removed", async () => {
    const d = memory();
    const added = await addProfile(d, { name: "  Clinic A  ", note: "tuned", values: snapshot(settings()), by: "admin", now: new Date("2026-10-28T10:00:00Z") });
    expect(added.ok && added.profile.name).toBe("Clinic A");
    expect((await loadProfiles(d)).map((p) => p.name)).toEqual(["Clinic A"]);
    const id = (await loadProfiles(d))[0].id;
    expect(await renameProfile(d, id, { name: "Clinic B", note: "" })).toEqual({ ok: true });
    expect((await loadProfiles(d))[0]).toMatchObject({ name: "Clinic B", note: "" });
    expect(await removeProfile(d, id)).toBe(true);
    expect(await removeProfile(d, id)).toBe(false);
    expect(await loadProfiles(d)).toEqual([]);
  });

  it("refuse an empty or repeated name and stop at the limit", async () => {
    const d = memory();
    expect(await addProfile(d, { name: "  ", note: "", values: {}, by: "a" })).toEqual({ ok: false, error: "name" });
    await addProfile(d, { name: "One", note: "", values: {}, by: "a" });
    expect(await addProfile(d, { name: "one", note: "", values: {}, by: "a" })).toEqual({ ok: false, error: "nameTaken" });
    const two = await addProfile(d, { name: "Two", note: "", values: {}, by: "a" });
    expect(await renameProfile(d, two.ok ? two.profile.id : "", { name: "ONE", note: "" })).toEqual({ ok: false, error: "nameTaken" });
    expect(await renameProfile(d, "p_missing12", { name: "X", note: "" })).toEqual({ ok: false, error: "missing" });
    for (let i = 0; i < PROFILE_LIMITS.count; i++) await addProfile(d, { name: `Profile ${i}`, note: "", values: {}, by: "a" });
    expect(await addProfile(d, { name: "Too many", note: "", values: {}, by: "a" })).toEqual({ ok: false, error: "full" });
  });

  it("are read safely from whatever is stored", () => {
    expect(cleanProfile(null)).toBeNull();
    expect(cleanProfile({ id: "bad id", name: "x", values: {} })).toBeNull();
    expect(cleanProfile({ id: "p_abcdef12", name: "", values: {} })).toBeNull();
    const p = cleanProfile({ id: "p_abcdef12", name: "A".repeat(200), note: 5, values: { llm: "x-model", evil: 1 } });
    expect(p?.name).toHaveLength(PROFILE_LIMITS.name);
    expect(p?.values).toEqual({ llm: "x-model" });
  });
});

describe("read from ElevenLabs", () => {
  it("reads back exactly what a sync sent, for a client with every kind of setting changed", () => {
    const t = tenant();
    const s = applyValues(settings(), {
      ...BUILTIN_VALUES.premium, greetingEn: "Welcome to {name}. This call is recorded.", greetingAr: "أهلاً بكم في {name}. المحادثة مسجلة.", extraKeywords: ["Botox"],
      maxDurationMessage: "Goodbye", softTimeoutMessageEn: "Just a second.", backupMode: "custom", backupModels: ["gpt-6-luna", "claude-sonnet-5-5"], concurrencyLimit: 5, silenceEndSeconds: 0, maxTokens: 0,
      criteriaOff: ["details_confirmed"], summaryLanguage: "ar", "w.colors": "custom", "w.bgColor": "#112233", "w.btnColor": "#aa0000", "w.btnTextColor": "#ffffff",
      "w.actionText": "Talk to us", "w.micMuting": true, "w.variant": "compact", "w.placement": "top-left", "w.feedback": "during", "w.hideBanner": false,
    });
    const values = readLiveValues({ settings: s, tenant: t, doctors, live: liveAfterSync(t, s) });
    expect(diffValues(s, values).changes).toEqual([]);
    expect(values.llm).toBeUndefined(); // the same model as CallsDash already holds
    expect(values.silenceEndSeconds).toBe(0);
    expect(values.criteriaOff).toEqual(["details_confirmed"]);
    expect(values.extraKeywords).toEqual(["Botox"]);
    // the clinic and doctor names are added automatically, so they are not extra words
    const withName = applyValues(s, { extraKeywords: ["Botox", "Dr Sara"] });
    expect(readLiveValues({ settings: withName, tenant: t, doctors, live: liveAfterSync(t, withName) }).extraKeywords).toEqual(["Botox"]);
  });

  it("treats the brand-coloured widget and the automatic greeting as such", () => {
    const t = tenant();
    const s = settings();
    const values = readLiveValues({ settings: s, tenant: t, doctors, live: liveAfterSync(t, s) });
    expect(values["w.colors"]).toBe("brand");
    expect(values.greetingEn).toBe("");
    expect(values.voiceEn).toBeUndefined(); // the same voice
  });

  it("finds what was changed by hand inside ElevenLabs", () => {
    const t = tenant();
    const s = settings();
    const body = liveAfterSync(t, s);
    const live = { ...body, temperature: 0.25, turnTimeout: 12, voiceId: "HandPickedVoice1234", firstMessage: "Hello from Al Noor, how can I help? This call is recorded.", widget: { ...body.widget, bg_color: "#101010" } };
    const { changes } = diffValues(s, readLiveValues({ settings: s, tenant: t, doctors, live }));
    const by = Object.fromEntries(changes.map((c) => [c.key, c.next]));
    expect(by).toMatchObject({ temperature: 0.25, turnTimeout: 12, voiceEn: "HandPickedVoice1234", greetingEn: "Hello from {name}, how can I help? This call is recorded.", "w.colors": "custom", "w.bgColor": "#101010" });
  });

  it("leaves alone what ElevenLabs did not report", () => {
    expect(readLiveValues({ settings: settings(), tenant: tenant(), doctors, live: mapLiveAgent({}) })).toEqual({});
  });
});

describe("importing the live settings", () => {
  function setup(over: Partial<ReturnType<typeof mapLiveAgent>> = {}, hasAgent = true) {
    const t = tenant();
    let current = settings(hasAgent ? {} : { elevenLabsAgentId: undefined });
    const saved: { settings: AgentSettings; summary: string }[] = [];
    const live = { ...liveAfterSync(t, current), ...over };
    const data = {
      getAgent: async () => current, getDoctors: async () => doctors, getTenant: async () => t,
      saveAgent: async (_id: string, s: AgentSettings, _actor: string, summary: string) => { current = s; saved.push({ settings: s, summary }); return {} as never; },
    };
    const calls: string[] = [];
    const catalog = { getAgent: async (id: string) => { calls.push(id); return live; } };
    return { data: data as never, catalog, saved, calls, get current() { return current; } };
  }

  it("previews without saving, and copies only the ticked settings", async () => {
    const x = setup({ temperature: 0.25, turnTimeout: 12, ttsModel: "eleven_v3_conversational" });
    const p = await previewLive({ data: x.data, catalog: x.catalog }, "t");
    expect(p.kind === "ok" && p.changes.map((c) => c.key).sort()).toEqual(["temperature", "ttsModelEn", "turnTimeout"]);
    expect(x.saved).toEqual([]);
    const out = await importLive({ data: x.data, catalog: x.catalog }, "t", "admin", ["temperature", "ttsModelEn"]);
    expect(out).toMatchObject({ kind: "imported", count: 2 });
    expect(x.current.temperature).toBe(0.25);
    expect(studioOf(x.current).ttsModelEn).toBe("eleven_v3_conversational");
    expect(studioOf(x.current).turnTimeout).toBe(7); // not ticked
    expect(x.saved[0].summary).toContain("Read from ElevenLabs");
  });

  it("copies nothing when the two sides already match, and says why when ElevenLabs cannot be read", async () => {
    const x = setup();
    expect(await importLive({ data: x.data, catalog: x.catalog }, "t", "admin")).toMatchObject({ kind: "imported" }); // first read: sections count as saved
    expect(await importLive({ data: x.data, catalog: x.catalog }, "t", "admin")).toEqual({ kind: "nothing" });
    expect(await previewLive({ data: x.data, catalog: null }, "t")).toEqual({ kind: "no_key" });
    expect(await previewLive({ data: setup({}, false).data, catalog: x.catalog }, "t")).toEqual({ kind: "no_agent" });
    const bad = { getAgent: async () => { throw new Error("boom"); } };
    expect(await previewLive({ data: x.data, catalog: bad }, "t")).toMatchObject({ kind: "failed" });
  });

  it("never writes to ElevenLabs", async () => {
    const x = setup({ temperature: 0.1 });
    await importLive({ data: x.data, catalog: x.catalog }, "t", "admin");
    expect(Object.keys(x.catalog)).toEqual(["getAgent"]);
    expect(x.calls).toEqual(["agent_1"]);
  });
});
