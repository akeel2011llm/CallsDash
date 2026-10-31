import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { dictionaries } from "@/lib/i18n";
import { BUSINESS_TYPES, businessFromForm, businessOf, relabel, roleName, roleOf, rolesFromForm, rolesOf, rulesOf, VOCAB, vocabOf, type BusinessProfile } from "@/lib/business-types";
import { buildPrompt, toolDefinitions } from "@/lib/agent-config";
import { agent } from "@/lib/seed";

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
      type: "custom", staffScheduling: true, words: { staffOne: "trainer", staffOneAr: "مدرب" },
    });
    // since milestone 8b every type may have its own words; blank words are not stored
    expect(form({ businessType: "salon", customerOne: "client" })).toMatchObject({ words: { customerOne: "client" } });
    expect(form({ businessType: "salon", staffOne: "" })).not.toHaveProperty("words");
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

describe("roles and the client's own words (milestone 8b)", () => {
  const roles = [
    { key: "doctor", one: "Doctor", many: "Doctors", oneAr: "طبيب", manyAr: "أطباء" },
    { key: "nurse", one: "Nurse", many: "Nurses", oneAr: "ممرض", manyAr: "ممرضون" },
  ];

  it("gives a client without roles one role named after its type", () => {
    expect(rolesOf(tenant())).toEqual([{ key: "staff", one: "Doctor", many: "Doctors", oneAr: "طبيب", manyAr: "أطباء" }]);
    expect(rolesOf(tenant({ type: "salon" }))[0]).toMatchObject({ one: "Stylist", oneAr: "أخصائي" });
  });

  it("reads role lines: keeps keys, makes new ones, drops removed and blank lines, fills plurals", () => {
    const get = (o: Record<string, string>) => (k: string) => o[k] ?? "";
    const r = rolesFromForm(get({
      roleCount: "4", role0_key: "staff", role0_one: "Doctor", role0_oneAr: "طبيب",
      role1_one: "Nurse", role1_oneAr: "ممرض", role2_key: "old", role2_one: "Old", role2_remove: "on", role3_one: "",
    }));
    expect(r).toEqual([
      { key: "staff", one: "Doctor", many: "Doctors", oneAr: "طبيب", manyAr: "طبيب" },
      { key: "nurse", one: "Nurse", many: "Nurses", oneAr: "ممرض", manyAr: "ممرض" },
    ]);
  });

  it("finds a person's role, the first role when none is set, and names it per language", () => {
    expect(roleOf(roles, "nurse").one).toBe("Nurse");
    expect(roleOf(roles, undefined).key).toBe("doctor");
    expect(roleName(roles[1], "ar", true)).toBe("ممرضون");
    expect(roleName({ ...roles[1], oneAr: "" }, "ar")).toBe("Nurse");
  });

  it("uses one role's name as the team word, a neutral word for several, and the admin's words over both", () => {
    expect(vocabOf(tenant({ type: "service", roles: [roles[1]] }), "en")).toMatchObject({ staffOne: "nurse", staffMany: "nurses" });
    expect(vocabOf(tenant({ type: "clinic", roles }), "en")).toMatchObject({ staffOne: "staff member", staffMany: "staff" });
    expect(vocabOf(tenant({ type: "clinic", roles, words: { staffOne: "care giver", customerOne: "client", placeOneAr: "مركز" } }), "en"))
      .toMatchObject({ staffOne: "care giver", staffMany: "care givers", customerOne: "client", customerMany: "clients", place: "clinic" });
    expect(vocabOf(tenant({ type: "clinic", words: { placeOneAr: "مركز" } }), "ar").place).toBe("مركز");
    // a clinic with only doctors reads exactly as before
    expect(vocabOf(tenant({ type: "clinic", roles: [roles[0]] }), "en")).toEqual(VOCAB.clinic.en);
  });

  it("writes the assistant's built-in instructions in the client's words, and lists each person's role", () => {
    const team = [{ id: "d1", name: "Sara", specialty: "", active: true, role: "nurse" }, { id: "d2", name: "Dr Ali", specialty: "GP", active: true }];
    const clinic = buildPrompt(agent("", "X"), team, tenant({ type: "clinic" }));
    expect(clinic).toContain("# Doctors");
    expect(clinic).toBe(buildPrompt(agent("", "X"), team)); // an unchanged clinic gets exactly the old text
    const salon = buildPrompt(agent("", "X"), team, tenant({ type: "salon" }));
    expect(salon).toContain("# Stylists");
    expect(salon).toContain("The salon is open now");
    // the built-in parts have no clinic words left, apart from tool names (find_patient_booking, doctor_id) and the value `doctor`
    expect(salon.slice(salon.indexOf("# Facts")).replace(/\w+_\w+/g, "").replace(/`doctor`/g, "")).not.toMatch(/\b(patient|doctor|clinic)s?\b/i);
    expect(salon).toContain("kind is `doctor`");
    const mixed = buildPrompt(agent("", "X"), team, tenant({ type: "clinic", roles }));
    expect(mixed).toContain("- Sara [role: Nurse]");
    expect(mixed).toContain("- Dr Ali [role: Doctor], GP");
    expect(mixed).toContain("Nurse (in Arabic ممرض)");
  });

  it("describes the shared tools without clinic words", () => {
    const text = JSON.stringify(toolDefinitions("https://x", "s")).replace(/"\w*(doctor|patient)\w*"/g, "").replace(/\w+_(doctor|patient)\w*|\b(doctor|patient)_\w+/g, "");
    expect(text).not.toMatch(/\b(patient|clinic)\b/i);
  });
});

describe("the assistant's own sections follow the business words", () => {
  it("rewrites untouched sections, follows later changes, and never touches text someone wrote", async () => {
    const { promptForWords } = await import("@/lib/business-words");
    const s = agent("", "Glow");
    const t0 = { name: "Glow", business: { type: "clinic" as const } };
    const salon = { type: "salon" as const };
    const p1 = promptForWords(s, t0, salon)!;
    expect(p1.languages).toContain("Switch if the customer switches.");
    expect(p1.identity).toContain("the salon's AI assistant");
    // later: salon -> a custom word for customers; the sections written for the salon follow again
    const p2 = promptForWords({ ...s, prompt: p1 }, { name: "Glow", business: salon }, { type: "salon", words: { customerOne: "guest" } })!;
    expect(p2.handoff).toContain("when the guest asks");
    // an edited section stays as written
    const own = { ...s, prompt: { ...s.prompt, identity: "My own words for this clinic." } };
    expect(promptForWords(own, t0, salon)!.identity).toBe("My own words for this clinic.");
    // nothing to change: null
    expect(promptForWords(s, t0, { type: "clinic" })).toBeNull();
  });
});
