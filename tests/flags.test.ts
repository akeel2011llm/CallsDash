import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, detectFlags, fold, matches, normalizeRules } from "@/lib/flags";

const conv = (over: Partial<Parameters<typeof detectFlags>[0]> & { caller?: string[]; agent?: string[] } = {}) => ({
  summary: over.summary ?? "",
  outcome: over.outcome ?? "answered",
  transcript: [
    ...(over.agent ?? []).map((text) => ({ role: "agent", text })),
    ...(over.caller ?? []).map((text) => ({ role: "patient", text })),
  ],
});

describe("flag detection", () => {
  it("flags an emergency in English and Arabic", () => {
    expect(detectFlags(conv({ caller: ["My father has chest pain, please help"] }), DEFAULT_RULES)).toEqual(["emergency"]);
    expect(detectFlags(conv({ caller: ["أبوي عنده ألم في الصدر وضيق نفس"] }), DEFAULT_RULES)).toContain("emergency");
    expect(detectFlags(conv({ caller: ["في نزيف عندي"] }), DEFAULT_RULES)).toContain("emergency");
  });

  it("flags a complaint and a lead, but only the caller's words count", () => {
    expect(detectFlags(conv({ caller: ["I want to make a complaint, I waited too long"] }), DEFAULT_RULES)).toEqual(["complaint"]);
    expect(detectFlags(conv({ caller: ["How much is teeth whitening?"] }), DEFAULT_RULES)).toEqual(["lead"]);
    expect(detectFlags(conv({ agent: ["Sorry about the complaint, is there an emergency?"], caller: ["No thanks"] }), DEFAULT_RULES)).toEqual([]);
    expect(detectFlags(conv({ caller: ["كم سعر تبييض الأسنان؟"] }), DEFAULT_RULES)).toContain("lead");
  });

  it("does not match inside other words, and treats a booked caller as already converted", () => {
    expect(matches(fold("what a nice costume"), "cost")).toBe(false);
    expect(matches(fold("what is the cost?"), "cost")).toBe(true);
    expect(detectFlags(conv({ caller: ["How much is it?"], outcome: "booked" }), DEFAULT_RULES)).toEqual([]);
    expect(detectFlags(conv({ summary: "Caller asked about prices", outcome: "abandoned" }), DEFAULT_RULES)).toEqual(["lead"]);
  });

  it("ignores Arabic spelling variants and diacritics", () => {
    expect(fold("إسعاف")).toBe(fold("اسعاف"));
    expect(fold("شكوَى")).toBe(fold("شكوى"));
    expect(detectFlags(conv({ caller: ["أريد استرجاع المبلغ"] }), DEFAULT_RULES)).toEqual(["complaint"]);
  });

  it("respects switched-off kinds and a client's own words", () => {
    const rules = normalizeRules({ emergency: { enabled: false }, lead: { keywords: ["root canal"] } });
    expect(detectFlags(conv({ caller: ["I have an emergency"] }), rules)).toEqual([]);
    expect(detectFlags(conv({ caller: ["Do you do a root canal?"] }), rules)).toEqual(["lead"]);
    expect(rules.complaint).toEqual({ enabled: true, keywords: [], notifyStaff: false });
  });
});
