/** Seconds settings, shown with an "s". */
const SECONDS = new Set(["cascadeSeconds", "turnTimeout", "silenceEndSeconds", "maxDurationSeconds", "softTimeoutSeconds", "initialWaitSeconds", "queueWaitSeconds"]);

/**
 * One studio setting's value in words, for the profile lists and the "Recommended" lists: On or Off, a choice by its name,
 * seconds with an "s", lists counted or joined. `T` looks a text up, `has` says whether the dictionary holds a key.
 */
export function showValue(key: string, v: unknown, T: (k: string, vars?: Record<string, string | number>) => string, has: (k: string) => boolean): string {
  if (v === undefined || v === null) return "–";
  if (typeof v === "boolean") return T(v ? "studio.live.on" : "studio.live.off");
  if (typeof v === "number") return v === 0 && has(`prof.zero.${key}`) ? T(`prof.zero.${key}`) : SECONDS.has(key) ? `${v} s` : String(v);
  if (Array.isArray(v)) {
    if (key === "offeredVoices") return v.length ? T("prof.voices", { n: v.length }) : "–";
    if (key === "extraKeywords" || key === "ignoreTerms") return v.length ? T("prof.words", { n: v.length }) : "–";
    if (key === "criteriaOff") return v.length ? v.map((x) => (has(`studio.criteria.${x}`) ? T(`studio.criteria.${x}`) : String(x))).join(", ") : "–";
    if (key === "audioTags") return v.length ? v.map((x) => (x && typeof x === "object" && "tag" in x ? String((x as { tag: unknown }).tag) : String(x))).join(", ") : "–";
    return v.length ? v.join(", ") : "–";
  }
  if (typeof v === "string") {
    if (v === "") return has(`studio.opt.${key}.default`) ? T(`studio.opt.${key}.default`) : key === "llm" || key === "reasoningEffort" ? T("prof.default") : T("prof.blank");
    const named = [`studio.opt.${key}.${v}`, key === "reasoningEffort" && `studio.effort.${v}`, key === "backupMode" && `studio.model.backup.${v}`, key.startsWith("ttsModel") && `studio.tts.${v}`].find((k): k is string => !!k && has(k));
    if (named) return T(named);
    return v.length > 70 ? `${v.slice(0, 70)}…` : v;
  }
  return JSON.stringify(v).slice(0, 70);
}
