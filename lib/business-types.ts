/**
 * Business types (milestone 1b of docs/reorganization.md). CallsDash serves clinics, salons, shops, restaurants and other
 * businesses. Each client has a type; the type decides the words on its screens ("Doctors" becomes "Stylists" or "Staff")
 * and, from the setup wizard on, which setup steps are required. Data, tables and addresses stay the same for every type:
 * a salon's stylists are stored as doctors, so nothing that works today changes.
 *
 * Pure module (no server code), so it can be tested and used by both server and browser components.
 */
import type { Locale, Tenant } from "./types";

export const BUSINESS_TYPES = ["clinic", "salon", "retail", "restaurant", "service", "custom"] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

/** What a client stored. Missing on every client created before business types existed: those are clinics. */
export interface BusinessProfile {
  type: BusinessType;
  /** Does the business book time with named people (doctors, stylists)? Off by default for shops and restaurants. */
  staffScheduling?: boolean;
  /** Custom type only: the admin's own words for the people. Blank parts fall back to "staff". */
  words?: { staffOne?: string; staffMany?: string; staffOneAr?: string; staffManyAr?: string };
}

export interface Vocab {
  staffOne: string; staffMany: string;
  customerOne: string; customerMany: string;
  place: string; placeMany: string;
}

/** The words each type uses. The clinic row is the wording the app was written in, so a clinic sees no change. */
export const VOCAB: Record<BusinessType, Record<Locale, Vocab>> = {
  clinic: {
    en: { staffOne: "doctor", staffMany: "doctors", customerOne: "patient", customerMany: "patients", place: "clinic", placeMany: "clinics" },
    ar: { staffOne: "طبيب", staffMany: "أطباء", customerOne: "مريض", customerMany: "مرضى", place: "عيادة", placeMany: "عيادات" },
  },
  salon: {
    en: { staffOne: "stylist", staffMany: "stylists", customerOne: "customer", customerMany: "customers", place: "salon", placeMany: "salons" },
    ar: { staffOne: "أخصائي", staffMany: "أخصائيين", customerOne: "عميل", customerMany: "عملاء", place: "منشأة", placeMany: "منشآت" },
  },
  retail: {
    en: { staffOne: "staff member", staffMany: "staff", customerOne: "customer", customerMany: "customers", place: "shop", placeMany: "shops" },
    ar: { staffOne: "موظف", staffMany: "موظفين", customerOne: "عميل", customerMany: "عملاء", place: "منشأة", placeMany: "منشآت" },
  },
  restaurant: {
    en: { staffOne: "staff member", staffMany: "staff", customerOne: "guest", customerMany: "guests", place: "restaurant", placeMany: "restaurants" },
    ar: { staffOne: "موظف", staffMany: "موظفين", customerOne: "ضيف", customerMany: "ضيوف", place: "منشأة", placeMany: "منشآت" },
  },
  service: {
    en: { staffOne: "staff member", staffMany: "staff", customerOne: "customer", customerMany: "customers", place: "business", placeMany: "businesses" },
    ar: { staffOne: "موظف", staffMany: "موظفين", customerOne: "عميل", customerMany: "عملاء", place: "منشأة", placeMany: "منشآت" },
  },
  custom: {
    en: { staffOne: "staff member", staffMany: "staff", customerOne: "customer", customerMany: "customers", place: "business", placeMany: "businesses" },
    ar: { staffOne: "موظف", staffMany: "موظفين", customerOne: "عميل", customerMany: "عملاء", place: "منشأة", placeMany: "منشآت" },
  },
};
// Arabic note: every non-clinic type says "منشأة" (establishment) because, like "عيادة", it is feminine, so the sentences
// written for a clinic stay grammatical. English can be specific (salon, shop, restaurant).

/** Rules the setup wizard (milestone 5) follows for each type. */
export interface TypeRules {
  /** People with calendars are needed before the client can go live (a clinic always; others when staff scheduling is on). */
  needsStaff: boolean;
  /** At least one catalogue item (product, package, offer) is needed. */
  needsCatalog: boolean;
  /** Knowledge OR catalogue is enough (clinic, service, custom). */
  knowledgeOrCatalog: boolean;
}

const CATALOG_FIRST: Record<BusinessType, boolean> = { clinic: false, salon: true, retail: true, restaurant: true, service: false, custom: false };
const SCHEDULING_DEFAULT: Record<BusinessType, boolean> = { clinic: true, salon: true, retail: false, restaurant: false, service: true, custom: true };

export const isBusinessType = (v: unknown): v is BusinessType => typeof v === "string" && (BUSINESS_TYPES as readonly string[]).includes(v);

/** The client's business profile, with the defaults filled in. Clients from before business types are clinics. */
export function businessOf(t: Pick<Tenant, "business"> | null | undefined): Required<Pick<BusinessProfile, "type" | "staffScheduling">> & BusinessProfile {
  const b = t?.business;
  const type = isBusinessType(b?.type) ? b.type : "clinic";
  return { ...b, type, staffScheduling: typeof b?.staffScheduling === "boolean" ? b.staffScheduling : SCHEDULING_DEFAULT[type] };
}

/** The setup rules for a client. A clinic always needs a doctor; any other type needs people only with staff scheduling on. */
export function rulesOf(t: Pick<Tenant, "business"> | null | undefined): TypeRules {
  const b = businessOf(t);
  const catalog = CATALOG_FIRST[b.type];
  return { needsStaff: b.type === "clinic" || b.staffScheduling, needsCatalog: catalog, knowledgeOrCatalog: !catalog };
}

export function vocabOf(t: Pick<Tenant, "business"> | null | undefined, locale: Locale): Vocab {
  const b = businessOf(t);
  const v = { ...VOCAB[b.type][locale] };
  if (b.type === "custom" && b.words) {
    const w = b.words;
    const one = (locale === "ar" ? w.staffOneAr : w.staffOne)?.trim();
    const many = (locale === "ar" ? w.staffManyAr : w.staffMany)?.trim();
    if (one) v.staffOne = one;
    if (many) v.staffMany = many;
    else if (one && locale === "en") v.staffMany = one + "s";
  }
  return v;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** English: whole words only, keeps capitals and the possessive. */
function relabelEn(s: string, v: Vocab, base: Vocab): string {
  const pairs: [string, string][] = [
    [base.staffMany, v.staffMany], [base.staffOne, v.staffOne],
    [base.customerMany, v.customerMany], [base.customerOne, v.customerOne],
    [base.placeMany, v.placeMany], [base.place, v.place],
  ];
  let out = s;
  for (const [from, to] of pairs) {
    if (from === to) continue;
    out = out.replace(new RegExp(`\\b(${from}|${cap(from)})\\b`, "g"), (m) => (m[0] === m[0].toUpperCase() ? cap(to) : to));
  }
  return out;
}

/**
 * Arabic: the clinic words appear with the article and joined prefixes (الطبيب، للعيادة، والأطباء، عيادتك). Each form is
 * mapped to the same form of the new word. Longest forms first so "الأطباء" is not caught as "أطباء" with a stray "ال".
 */
function relabelAr(s: string, v: Vocab): string {
  const al = (w: string) => "ال" + w;
  return construct(s
    .replace(/([وبكف]?)(لل|ال)أطباء/g, (_, pre, art) => pre + (art === "لل" ? "لل" + v.staffMany : al(v.staffMany)))
    .replace(/أطباء/g, v.staffMany)
    .replace(/([وبكف]?)(لل|ال)طبيب/g, (_, pre, art) => pre + (art === "لل" ? "لل" + v.staffOne : al(v.staffOne)))
    .replace(/طبيباً/g, v.staffOne + "اً")
    .replace(/طبيب/g, v.staffOne)
    .replace(/([وبكف]?)(لل|ال)مرضى/g, (_, pre, art) => pre + (art === "لل" ? "لل" + v.customerMany : al(v.customerMany)))
    .replace(/مرضى/g, v.customerMany)
    .replace(/([وبكف]?)(لل|ال)مريض/g, (_, pre, art) => pre + (art === "لل" ? "لل" + v.customerOne : al(v.customerOne)))
    .replace(/مريض/g, v.customerOne)
    .replace(/([وبكف]?)(لل|ال)عيادات/g, (_, pre, art) => pre + (art === "لل" ? "لل" + v.placeMany : al(v.placeMany)))
    .replace(/عيادات/g, v.placeMany)
    .replace(/([وبكف]?)(لل|ال)عيادة/g, (_, pre, art) => pre + (art === "لل" ? "لل" + v.place : al(v.place)))
    // possessive forms: عيادتك / عيادتنا keep the ta marbuta as ta
    .replace(/عيادت/g, v.place.endsWith("ة") ? v.place.slice(0, -1) + "ت" : v.place + " ")
    .replace(/عيادة/g, v.place), v);
}

/**
 * A sound plural ending in "ين" loses its "ن" when it owns the next word: "أطباء العيادة" became "موظفين المنشأة", which must
 * read "موظفي المنشأة". Broken plurals (أطباء، عملاء) need nothing.
 */
function construct(s: string, v: Vocab): string {
  if (!v.staffMany.endsWith("ين")) return s;
  const stem = v.staffMany.slice(0, -2);
  return s.replace(new RegExp(`(^|[^\\u0621-\\u064A])(${stem})ين (?=ال)`, "g"), (_, b, w) => `${b}${w}ي `);
}

/**
 * Rewrites one screen text for the client's business type. Placeholders ({doctors}) and anything that is not a whole word
 * are left alone. A clinic gets its text back unchanged.
 */
export function relabel(text: string, locale: Locale, v: Vocab): string {
  const base = VOCAB.clinic[locale];
  if (JSON.stringify(v) === JSON.stringify(base)) return text;
  // keep {placeholders} out of the rewrite
  return text.split(/(\{\w+\})/g).map((part) => (/^\{\w+\}$/.test(part) ? part : locale === "ar" ? relabelAr(part, v) : relabelEn(part, v, base))).join("");
}

/** Reads the business form (admin client page, New client). Unknown values fall back to clinic; words are trimmed and short. */
export function businessFromForm(get: (k: string) => string, has: (k: string) => boolean): BusinessProfile {
  const raw = get("businessType");
  const type: BusinessType = isBusinessType(raw) ? raw : "clinic";
  const w = (k: string) => get(k).replace(/\s+/g, " ").trim().slice(0, 40);
  const words = { staffOne: w("staffOne"), staffMany: w("staffMany"), staffOneAr: w("staffOneAr"), staffManyAr: w("staffManyAr") };
  return {
    type,
    // a clinic always books doctors; the box only appears with the other types
    staffScheduling: type === "clinic" ? true : has("schedulingShown") ? get("staffScheduling") === "on" : SCHEDULING_DEFAULT[type],
    ...(type === "custom" && Object.values(words).some(Boolean) ? { words } : {}),
  };
}
