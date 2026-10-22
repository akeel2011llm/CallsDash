import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// the dictionaries live in a server-only module; the marker import is harmless here
vi.mock("server-only", () => ({}));

import { dictionaries } from "@/lib/i18n";
import { CHOICES, SECTIONS } from "@/lib/agent-studio";
import { TTS_MODELS } from "@/lib/agent-catalog";
import { EVALUATION_CRITERIA, EXTRA_GROUPS } from "@/lib/agent-extras";
import { liveRows } from "@/lib/studio-live";
import { mapLiveAgent } from "@/lib/elevenlabs-catalog";

const en = dictionaries.en as Record<string, string>;
const ar = dictionaries.ar as Record<string, string>;
const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/** Every text key the Assistant studio can ask for that is not written out literally in its screens. */
function dynamicKeys(): string[] {
  const k: string[] = [];
  for (const s of SECTIONS) k.push(`studio.sec.${s}`, `studio.sec.${s}.help`);
  for (const g of EXTRA_GROUPS) k.push(`channels.group.${g}`);
  const opt = (name: string, values: readonly string[]) => values.forEach((v) => k.push(`studio.opt.${name}.${v || "default"}`));
  opt("textNormalisation", CHOICES.textNormalisation);
  opt("turnEagerness", CHOICES.turnEagerness);
  opt("spellingPatience", CHOICES.spellingPatience);
  opt("asrProvider", CHOICES.asrProvider);
  opt("summaryLanguage", CHOICES.summaryLanguage);
  opt("w.colors", CHOICES.widgetColors);
  opt("w.variant", CHOICES.widgetVariant);
  opt("w.placement", CHOICES.widgetPlacement);
  opt("w.expandable", CHOICES.widgetExpandable);
  opt("w.feedback", CHOICES.widgetFeedback);
  CHOICES.reasoningEffort.forEach((e) => k.push(`studio.effort.${e}`));
  CHOICES.backupMode.forEach((m) => k.push(`studio.model.backup.${m}`, `studio.model.backupHelp.${m}`));
  TTS_MODELS.forEach((m) => k.push(`studio.tts.${m.id}`));
  EVALUATION_CRITERIA.forEach((c) => k.push(`studio.criteria.${c.id}`, `studio.criteria.${c.id}.help`));
  for (const a of ["start", "fastest", "accurate"]) k.push(`studio.model.advice.${a}`);
  for (const s of ["elevenlabs", "estimate", "unknown"]) k.push(`studio.model.price.${s}`);
  for (const s of ["live", "saved", "builtin"]) k.push(`studio.model.source.${s}`);
  for (const f of ["all", "best", "openai", "google", "anthropic", "elevenlabs"]) k.push(`studio.model.filter.${f}`);
  for (const l of ["any", "en", "ar"]) k.push(`studio.vb.language.${l}`);
  for (const g of ["any", "female", "male", "neutral"]) k.push(`studio.vb.gender.${g}`);
  for (const s of ["account", "library"]) k.push(`studio.vb.source.${s}`, `studio.vb.source.${s}.help`);
  for (const l of ["en", "ar"]) k.push(`studio.vb.title.${l}`, `studio.vb.use.${l}`, `studio.vb.verified.${l}`, `studio.voice.${l}`, `studio.voice.${l}.help`, `studio.voice.model.${l}`);
  for (const l of ["en", "ar", "both"]) k.push(`studio.voice.offered.lang.${l}`);
  for (const s of ["same", "differs", "unset"]) k.push(`studio.live.state.${s}`);
  for (const n of ["noLimit", "default", "notUsed"]) k.push(`studio.live.none.${n}`);
  // every row the live panel can show
  const rows = liveRows({ settings: { elevenLabsAgentId: "a", prompt: {} as never, temperature: 0.3, replyLength: "normal", formality: "polite", arabicWrittenStyle: "gulf", voiceEn: "voice_en_f", voiceAr: "voice_ar_f" }, tenant: { retentionDays: 90 }, live: mapLiveAgent({}) });
  rows.forEach((r) => k.push(`studio.live.row.${r.id}`));
  return k;
}

/** The form fields lib/agent-studio.ts reads: each one needs a label, because an error names the field. */
function formFields(): string[] {
  const src = read("lib/agent-studio.ts");
  const names = [...src.matchAll(/\br\.(?:num|choice|color|str|para|on)\(\s*"([\w.]+)"/g)].map((m) => m[1]);
  const widget = ["actionText", "startCallText", "endCallText", "listeningText", "speakingText", "transcript", "textInput", "micMuting", "languageSelector", "textOnlyMode", "defaultExpanded", "dismissible", "endConfirmation", "showConversationId"].map((n) => `w.${n}`);
  return [...names, ...widget, "llm", "backupModels", "voiceEn", "voiceAr", "ttsModelEn", "ttsModelAr", "offered", "extraKeywords", "criteriaOff", "parallelTools", "greetingEn", "greetingAr", "speculativeTurn", "protectGreeting", "guardFocus", "guardInjection", "recordVoice", "bursting", "expressive"];
}

/** Keys written out in the screens as plain strings. */
function literalKeys(): string[] {
  const files = ["app/(admin)/admin/clients/[id]/assistant/page.tsx", ...readdirSync(join(root, "components/studio")).filter((f) => f.endsWith(".tsx")).map((f) => `components/studio/${f}`), "lib/studio-actions.ts"];
  const out = new Set<string>();
  for (const f of files) for (const m of read(f).matchAll(/\b(?:T|t)\(\s*"((?:studio|channels\.group)\.[\w.-]+)"/g)) out.add(m[1]);
  return [...out];
}

/** Error keys any studio code can produce. */
function errorKeys(): string[] {
  const out = new Set<string>();
  for (const f of ["lib/agent-studio.ts", "lib/studio-apply.ts"]) for (const m of read(f).matchAll(/"(studio\.err\.\w+)"/g)) out.add(m[1]);
  return [...out];
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

describe("Assistant studio texts", () => {
  const keys = [...new Set([...dynamicKeys(), ...formFields().map((n) => `studio.f.${n}`), ...literalKeys(), ...errorKeys()])];

  it("covers a useful number of keys", () => {
    expect(keys.length).toBeGreaterThan(250);
  });

  it("has every key in English and in Arabic", () => {
    expect(keys.filter((k) => !(k in en))).toEqual([]);
    expect(keys.filter((k) => !(k in ar))).toEqual([]);
  });

  it("writes the Arabic text in Arabic and keeps the same {placeholders}", () => {
    const studio = Object.keys(en).filter((k) => k.startsWith("studio.") || k === "nav.assistant");
    const noArabic = studio.filter((k) => !/[؀-ۿ]/.test(ar[k] ?? "") && !/^[A-Za-z0-9 ./·\-()%+*#_:,]+$/.test(en[k]));
    expect(noArabic).toEqual([]);
    expect(studio.filter((k) => placeholders(en[k]) !== placeholders(ar[k] ?? ""))).toEqual([]);
  });

  it("has no empty text", () => {
    expect(Object.keys(en).filter((k) => k.startsWith("studio.") && !en[k].trim())).toEqual([]);
    expect(Object.keys(ar).filter((k) => k.startsWith("studio.") && !ar[k].trim())).toEqual([]);
  });
});
