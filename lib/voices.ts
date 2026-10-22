import { studioOf } from "./agent-studio";
import type { AgentSettings, Locale, Voice } from "./types";

// Curated voices, two per language (one female, one male). The ids here are CallsDash's own labels; at sync time
// they are mapped to real ElevenLabs voice ids (see `resolveVoiceId`).
export const VOICES: Voice[] = [
  { id: "voice_en_f", name: "Amelia", language: "en", gender: "female" },
  { id: "voice_en_m", name: "James", language: "en", gender: "male" },
  { id: "voice_ar_f", name: "Noura", language: "ar", gender: "female" },
  { id: "voice_ar_m", name: "Khalid", language: "ar", gender: "male" },
];

/**
 * Until real Arabic voices are picked in the ElevenLabs voice library, the premade multilingual voices (Rachel, Adam)
 * speak both languages. Set ELEVENLABS_VOICES to a JSON object such as {"voice_ar_f":"<id>"} to swap any of them.
 */
const DEFAULTS: Record<string, string> = {
  voice_en_f: "21m00Tcm4TlvDq8ikWAM", voice_en_m: "pNInz6obpgDQGcFmaJgB",
  voice_ar_f: "21m00Tcm4TlvDq8ikWAM", voice_ar_m: "pNInz6obpgDQGcFmaJgB",
};

export function resolveVoiceId(id: string, _lang: Locale, overridesJson = process.env.ELEVENLABS_VOICES): string {
  let overrides: Record<string, string> = {};
  try { if (overridesJson) overrides = JSON.parse(overridesJson); } catch { /* ignore a malformed value, use the defaults */ }
  return overrides[id] ?? DEFAULTS[id] ?? id; // an id that is not one of ours is already an ElevenLabs voice id
}

/** A voice a client can pick on their Voice page. */
export interface VoiceChoice { id: string; name: string; gender?: string; accent?: string; sampleUrl?: string }

type VoiceSettings = Pick<AgentSettings, "studio" | "voiceEn" | "voiceAr">;

/**
 * The voices a client may pick for one language: the ones the admin offered in the Assistant studio, or CallsDash's four own
 * voices when nothing was offered. The voice the client has now always stays on the list, so opening the page never changes it.
 */
export function voiceChoices(settings: VoiceSettings, lang: Locale): VoiceChoice[] {
  const st = studioOf(settings);
  const offered = st.offeredVoices.filter((v) => v.language === lang || v.language === "both");
  const list: VoiceChoice[] = offered.length
    ? offered.map((v) => ({ id: v.id, name: v.name, gender: v.gender, accent: v.accent, sampleUrl: v.previewUrl }))
    : VOICES.filter((v) => v.language === lang).map((v) => ({ id: v.id, name: v.name, gender: v.gender, sampleUrl: v.sampleUrl }));
  const current = lang === "en" ? settings.voiceEn : settings.voiceAr;
  if (current && !list.some((v) => v.id === current)) {
    const own = VOICES.find((v) => v.id === current);
    const note = st.voiceNotes[current];
    list.unshift({ id: current, name: own?.name ?? note?.name ?? current, gender: own?.gender ?? note?.gender, accent: note?.accent, sampleUrl: own?.sampleUrl ?? note?.previewUrl });
  }
  return list;
}

/** True when a client may choose this voice for this language: it is on the list `voiceChoices` shows. */
export const voiceAllowed = (settings: VoiceSettings, lang: Locale, id: string) => voiceChoices(settings, lang).some((v) => v.id === id);
