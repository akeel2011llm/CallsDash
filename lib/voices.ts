import type { Locale, Voice } from "./types";

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
