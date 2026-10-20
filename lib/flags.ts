import type { AlertRules, Conversation, FlagKind, FlagRule, Outcome } from "./types";

export const FLAG_KINDS: FlagKind[] = ["emergency", "complaint", "lead"];

/**
 * Built-in phrases per kind, English and Arabic (Gulf and Modern Standard). Clients add their own on top.
 * Matching is on plain words, not meaning: a conversation that mentions these is flagged for a person to look at.
 */
export const BUILT_IN_KEYWORDS: Record<FlagKind, string[]> = {
  emergency: [
    "emergency", "ambulance", "chest pain", "can't breathe", "cannot breathe", "not breathing", "bleeding", "unconscious", "fainted", "severe pain", "allergic reaction", "heart attack", "overdose",
    "طوارئ", "حالة طارئة", "اسعاف", "نزيف", "الم في الصدر", "الم شديد", "ضيق نفس", "ضيق تنفس", "لا استطيع التنفس", "فاقد الوعي", "اغماء", "جلطه", "تسمم",
  ],
  complaint: [
    "complaint", "complain", "unhappy", "disappointed", "unacceptable", "terrible", "worst", "rude", "refund", "speak to the manager", "manager", "waited too long", "overcharged", "angry", "not satisfied",
    "شكوى", "اشتكي", "شكاوي", "غير راضي", "مو راضي", "مستاء", "سيء", "اسوا", "وقحه", "استرجاع المبلغ", "المدير", "انتظرت كثير", "زعلان", "غضبان", "غير مقبول",
  ],
  lead: [
    "how much", "price", "prices", "cost", "quote", "interested in", "new patient", "first visit", "package", "offer", "discount", "whitening", "implant", "braces", "consultation",
    "كم سعر", "كم يكلف", "كم تكلفه", "بكم", "الاسعار", "سعر", "مهتم", "مريض جديد", "اول زياره", "عرض", "خصم", "تبييض", "زراعه", "تقويم", "استشاره",
  ],
};

export const DEFAULT_RULES: AlertRules = {
  emergency: { enabled: true, keywords: [], notifyStaff: true },
  complaint: { enabled: true, keywords: [], notifyStaff: false },
  lead: { enabled: true, keywords: [], notifyStaff: false },
};

const rule = (raw: unknown, base: FlagRule): FlagRule => {
  const r = (raw ?? {}) as Partial<FlagRule>;
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : base.enabled,
    notifyStaff: typeof r.notifyStaff === "boolean" ? r.notifyStaff : base.notifyStaff,
    keywords: Array.isArray(r.keywords) ? r.keywords.map(String).map((k) => k.trim()).filter(Boolean).slice(0, 50) : base.keywords,
  };
};

/** Fills gaps so older rows and partial input always yield a complete rule set. */
export const normalizeRules = (raw: unknown): AlertRules => {
  const r = (raw ?? {}) as Partial<Record<FlagKind, unknown>>;
  return { emergency: rule(r.emergency, DEFAULT_RULES.emergency), complaint: rule(r.complaint, DEFAULT_RULES.complaint), lead: rule(r.lead, DEFAULT_RULES.lead) };
};

/** Lower-case; Arabic made comparable: no diacritics or tatweel, alef/ya/ta-marbuta variants unified. */
export const fold = (s: string) =>
  s.normalize("NFKC").toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ");

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Latin phrases match on word edges ("cost" does not match "costume"); Arabic phrases match as substrings. */
export function matches(text: string, phrase: string): boolean {
  const p = fold(phrase).trim();
  if (!p) return false;
  if (/[؀-ۿ]/.test(p)) return text.includes(p);
  return new RegExp(`(?<![\\p{L}\\p{N}])${escape(p)}(?![\\p{L}\\p{N}])`, "u").test(text);
}

export function detectFlags(
  c: { summary: string; transcript: { role: string; text: string }[]; outcome: Outcome },
  rules: AlertRules,
): FlagKind[] {
  // what the caller said plus the summary; the agent's own words are left out so its polite phrases do not trigger anything
  const text = fold([c.summary, ...c.transcript.filter((l) => l.role !== "agent").map((l) => l.text)].join(" \n "));
  const out: FlagKind[] = [];
  for (const kind of FLAG_KINDS) {
    const r = rules[kind];
    if (!r.enabled) continue;
    if (kind === "lead" && c.outcome === "booked") continue; // already converted
    if ([...BUILT_IN_KEYWORDS[kind], ...r.keywords].some((k) => matches(text, k))) out.push(kind);
  }
  return out;
}

/** Order that puts what needs a person first. */
export const flagRank: Record<FlagKind, number> = { emergency: 0, complaint: 1, lead: 2 };
export const needsAttention = (c: Pick<Conversation, "flags" | "reviewed">) => c.flags.length > 0 && !c.reviewed;
