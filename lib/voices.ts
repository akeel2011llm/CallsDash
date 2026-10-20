import type { Voice } from "./types";

// Curated voices, two per language (one female, one male). The ids are placeholders until the
// real ElevenLabs voice ids are picked in the ElevenLabs voice library; `sampleUrl` is filled in then.
export const VOICES: Voice[] = [
  { id: "voice_en_f", name: "Amelia", language: "en", gender: "female" },
  { id: "voice_en_m", name: "James", language: "en", gender: "male" },
  { id: "voice_ar_f", name: "Noura", language: "ar", gender: "female" },
  { id: "voice_ar_m", name: "Khalid", language: "ar", gender: "male" },
];
