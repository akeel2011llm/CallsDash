import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { dictionaries } from "@/lib/i18n";
import { BUSINESS_TYPES, businessFromForm, businessOf, relabel, rulesOf, VOCAB, vocabOf, type BusinessProfile } from "@/lib/business-types";

const tenant = (business?: BusinessProfile) => ({ business });
const en = dictionaries.en as Record<string, string>;
const ar = dictionaries.ar as Record<string, string>;

describe("business type", () => {
  it("treats a client from before business types as a clinic that books doctors", () => {
    expect(businessOf(tenant())).toEqual({ type: "clinic", staffScheduling: true });
    expect(businessOf(tenant({ type: "nonsense" as never }))).toMatchObject({ type: "clinic" });
    expect(businessOf(tenant({ type: "retail" })).staffScheduling).toBe(false);
  });

  it("sets the setup rules per type", () => {
    expect(rulesOf(tenant())).toEqual({ needsStaff: true, needsCatalog: false, knowledgeOrCatalog: true });
    expect(rulesOf(tenant({ type: "retail" }))).toEqual({ needsStaff: false, needsCatalog: true, knowledgeOrCatalog: false });
    expect(rulesOf(tenant({ type: "retail", staffScheduling: true })).needsStaff).toBe(true);
    expect(rulesOf(tenant({ type: "salon" }))).toMatchObject({ needsStaff: true, needsCatalog: true });
    // a clinic always needs a doctor, whatever the box says
    expect(rulesOf(tenant({ type: "clinic", staffScheduling: false })).needsStaff).toBe(true);
  });

  it("reads the form", () => {
    const form = (o: Record<string, string>) => businessFromForm((k) => o[k] ?? "", (k) => k in o);
    expect(form({ businessType: "salon", schedulingShown: "1", staffScheduling: "on" })).toEqual({ type: "salon", staffScheduling: true });
    expect(form({ businessType: "salon", schedulingShown: "1" })).toEqual({ type: "salon", staffScheduling: false });
    expect(form({ businessType: "clinic", schedulingShown: "1" })).toEqual({ type: "clinic", staffScheduling: true });
    expect(form({ businessType: "bad" }).type).toBe("clinic");
    expect(form({ businessType: "custom", schedulingShown: "1", staffScheduling: "on", staffOne: "  trainer ", staffOneAr: "مدرب" })).toEqual({
      type: "custom", staffScheduling: true, words: { staffOne: "trainer", staffMany: "", staffOneAr: "مدرب", staffManyAr: "" },
    });
    // words are kept only for the custom type
    expect(form({ businessType: "salon", staffOne: "x" })).not.toHaveProperty("words");
  });

  it("uses the admin's own words for a custom type", () => {
    const t = tenant({ type: "custom", words: { staffOne: "trainer", staffOneAr: "مدرب", staffManyAr: "مدربين" } });
    expect(vocabOf(t, "en")).toMatchObject({ staffOne: "trainer", staffMany: "trainers" });
    expect(vocabOf(t, "ar")).toMatchObject({ staffOne: "مدرب", staffMany: "مدربين" });
  });
});

describe("relabel", () => {
  const salonEn = VOCAB.salon.en, salonAr = VOCAB.salon.ar, shopEn = VOCAB.retail.en;

  it("leaves a clinic's texts exactly as written", () => {
    for (const [k, v] of Object.entries(en)) expect(relabel(v, "en", VOCAB.clinic.en), k).toBe(v);
    for (const [k, v] of Object.entries(ar)) expect(relabel(v, "ar", VOCAB.clinic.ar), k).toBe(v);
  });

  it("rewrites English words with their capitals and possessives", () => {
    expect(relabel("Add doctor", "en", salonEn)).toBe("Add stylist");
    expect(relabel("Doctors and Google Calendars", "en", salonEn)).toBe("Stylists and Google Calendars");
    expect(relabel("The doctor's calendar for the clinic's patients", "en", salonEn)).toBe("The stylist's calendar for the salon's customers");
    expect(relabel("Choose a doctor", "en", shopEn)).toBe("Choose a staff member");
    // plural possessive: "staff" takes no apostrophe
    expect(relabel("Doctors' calendars", "en", salonEn)).toBe("Stylists' calendars");
    expect(relabel("Doctors' calendars and the doctors' hours", "en", shopEn)).toBe("Staff calendars and the staff hours");
  });

  it("keeps placeholders and longer words untouched", () => {
    expect(relabel("{doctors} doctor(s) copied", "en", salonEn)).toBe("{doctors} stylist(s) copied");
    expect(relabel("doctorHours", "en", salonEn)).toBe("doctorHours");
  });

  it("rewrites the Arabic forms with their article and prefixes", () => {
    expect(relabel("أضف الطبيب", "ar", salonAr)).toBe("أضف الأخصائي");
    expect(relabel("تقويم الأطباء والطبيب", "ar", salonAr)).toBe("تقويم الأخصائيين والأخصائي");
    expect(relabel("اتصل بالعيادة أو بعيادتك", "ar", salonAr)).toBe("اتصل بالمنشأة أو بمنشأتك");
    expect(relabel("للعيادة وللمريض", "ar", VOCAB.retail.ar)).toBe("للمنشأة وللعميل");
    expect(relabel("{doctors} أطباء", "ar", salonAr)).toBe("{doctors} أخصائيين");
  });

  it("leaves no clinic word on any screen text of a salon or a shop", () => {
    const left = (type: "salon" | "retail") => [
      ...Object.entries(en).filter(([k]) => !k.startsWith("biz.")).map(([k, v]) => [k, relabel(v, "en", VOCAB[type].en)] as const)
        .filter(([, v]) => /\b(doctors?|patients?|clinics?)\b/i.test(v.replace(/\{\w+\}/g, ""))),
      ...Object.entries(ar).filter(([k]) => !k.startsWith("biz.")).map(([k, v]) => [k, relabel(v, "ar", VOCAB[type].ar)] as const)
        .filter(([, v]) => /طبيب|أطباء|مريض|مرضى|عياد/.test(v)),
    ];
    expect(left("salon")).toEqual([]);
    expect(left("retail")).toEqual([]);
  });

  it("covers every type in both languages", () => {
    for (const ty of BUSINESS_TYPES) for (const l of ["en", "ar"] as const) expect(Object.values(VOCAB[ty][l]).every((w) => w.trim())).toBe(true);
  });
});

describe("Arabic possessive plural", () => {
  it("drops the nun when the plural owns the next word", () => {
    expect(relabel("أضف أطباء العيادة أولاً", "ar", VOCAB.retail.ar)).toBe("أضف موظفي المنشأة أولاً");
    expect(relabel("لا يوجد أطباء بعد", "ar", VOCAB.retail.ar)).toBe("لا يوجد موظفين بعد");
    expect(relabel("تقاويم الأطباء الآن", "ar", VOCAB.retail.ar)).toBe("تقاويم الموظفين الآن");
  });
});
