import { describe, expect, it } from "vitest";
import { voiceAllowed, voiceChoices } from "@/lib/voices";
import { STUDIO_DEFAULTS } from "@/lib/agent-studio";
import type { AgentSettings } from "@/lib/types";

const settings = (over: Partial<Pick<AgentSettings, "studio" | "voiceEn" | "voiceAr">> = {}) => ({
  voiceEn: "voice_en_f", voiceAr: "voice_ar_f", ...over,
});
const offered = [
  { id: "Voice1234567", name: "Layla", language: "ar" as const, gender: "female", accent: "gulf", previewUrl: "https://example.com/layla.mp3" },
  { id: "Voice7654321", name: "Sam", language: "en" as const, gender: "male" },
  { id: "VoiceBoth0001", name: "Noor", language: "both" as const },
];

describe("voices a client may choose", () => {
  it("offers the four built-in voices until the admin offers others", () => {
    expect(voiceChoices(settings(), "en").map((v) => v.id)).toEqual(["voice_en_f", "voice_en_m"]);
    expect(voiceChoices(settings(), "ar").map((v) => v.id)).toEqual(["voice_ar_f", "voice_ar_m"]);
  });

  it("offers only the admin's list for each language, with both-language voices in both", () => {
    const s = settings({ studio: { ...STUDIO_DEFAULTS, offeredVoices: offered }, voiceEn: "Voice7654321", voiceAr: "Voice1234567" });
    expect(voiceChoices(s, "en").map((v) => v.id)).toEqual(["Voice7654321", "VoiceBoth0001"]);
    expect(voiceChoices(s, "ar").map((v) => v.id)).toEqual(["Voice1234567", "VoiceBoth0001"]);
    expect(voiceChoices(s, "ar")[0]).toMatchObject({ name: "Layla", accent: "gulf", sampleUrl: "https://example.com/layla.mp3" });
  });

  it("always keeps the current voice on the list, named from what the studio remembers", () => {
    const s = settings({
      studio: { ...STUDIO_DEFAULTS, offeredVoices: offered, voiceNotes: { OldVoice0001: { name: "Old friend", gender: "female" } } },
      voiceEn: "OldVoice0001",
    });
    const en = voiceChoices(s, "en");
    expect(en[0]).toMatchObject({ id: "OldVoice0001", name: "Old friend", gender: "female" });
    expect(en).toHaveLength(3);
  });

  it("accepts a built-in label as the current voice", () => {
    const s = settings({ studio: { ...STUDIO_DEFAULTS, offeredVoices: offered }, voiceEn: "voice_en_m" });
    expect(voiceChoices(s, "en")[0]).toMatchObject({ id: "voice_en_m", name: "James" });
  });

  it("refuses a voice that was not offered", () => {
    const s = settings({ studio: { ...STUDIO_DEFAULTS, offeredVoices: offered }, voiceEn: "Voice7654321" });
    expect(voiceAllowed(s, "en", "VoiceBoth0001")).toBe(true);
    expect(voiceAllowed(s, "en", "Voice7654321")).toBe(true);
    expect(voiceAllowed(s, "en", "SomeoneElse01")).toBe(false);
    expect(voiceAllowed(s, "en", "Voice1234567")).toBe(false); // offered, but only for Arabic
    expect(voiceAllowed(settings(), "ar", "voice_ar_m")).toBe(true);
    expect(voiceAllowed(settings(), "ar", "voice_en_m")).toBe(false);
  });
});
