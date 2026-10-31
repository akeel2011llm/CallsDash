/**
 * Business types (milestone 1b of docs/reorganization.md). CallsDash serves clinics, salons, shops, restaurants and other
 * businesses. Each client has a type; the type decides the words on its screens ("Doctors" becomes "Stylists" or "Staff")
 * and, from the setup wizard on, which setup steps are required. Data, tables and addresses stay the same for every type:
 * a salon's stylists are stored as doctors, so nothing that works today changes.
 *
 * Pure module (no server code), so it can be tested and used by both server and browser components.
 */
import type { Locale, Tenant } from "./types";
import { ID_KINDS, type IdKind, type IdRule } from "./id-rule";

export const BUSINESS_TYPES = ["clinic", "salon", "retail", "restaurant", "service", "custom"] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

/** What a client stored. Missing on every client created before business types existed: those are clinics. */
export interface BusinessProfile {
  type: BusinessType;
  /** Does the business book time with named people (doctors, stylists)? Off by default for shops and restaurants. */
  staffScheduling?: boolean;
  /**
   * The admin's own words, for any type (until milestone 8b only the custom type had them). A blank word keeps the type's word.
   * staff* is the word for the whole team; with one role it defaults to that role's name.
   */
  words?: Partial<Record<WordKey, string>>;
  /** The kinds of people who take bookings (Doctor, Nurse, Stylist). Missing = one role named after the type. */
  roles?: Role[];
  /** The ID number customers give (lib/id-rule.ts). Missing = the CPR number, as every client asked before the rule existed. */
  id?: IdRule;
}

export const WORD_KEYS = [
  "staffOne", "staffMany", "staffOneAr", "staffManyAr",
  "customerOne", "customerMany", "customerOneAr", "customerManyAr",
  "placeOne", "placeMany", "placeOneAr", "placeManyAr",
] as const;
export type WordKey = (typeof WORD_KEYS)[number];

/** One kind of team member, named by the admin in English and Arabic, singular and plural. `key` never changes once made. */
export interface Role { key: string; one: string; many: string; oneAr: string; manyAr: string }
export const MAX_ROLES = 12;

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

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lower = (s: string, locale: Locale) => (locale === "en" ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** The roles a client has. Before roles existed every client had one: the type's own word (Doctor for a clinic). */
export function rolesOf(t: Pick<Tenant, "business"> | null | undefined): Role[] {
  const b = businessOf(t);
  const ok = (b.roles ?? []).filter((r) => r && /^[a-z][a-z0-9_]{0,30}$/.test(r.key) && r.one?.trim());
  if (ok.length) return ok.slice(0, MAX_ROLES);
  const en = VOCAB[b.type].en, ar = VOCAB[b.type].ar;
  return [{ key: "staff", one: cap(en.staffOne), many: cap(en.staffMany), oneAr: ar.staffOne, manyAr: ar.staffMany }];
}

/** The role of one team member: its own, or the first role when it has none (every doctor made before roles existed). */
export const roleOf = (roles: Role[], key: string | undefined): Role => roles.find((r) => r.key === key) ?? roles[0];

/** A role's name in a language, singular or plural. Arabic falls back to English when the admin left it blank. */
export const roleName = (r: Role, locale: Locale, many = false): string =>
  (locale === "ar" ? (many ? r.manyAr || r.oneAr : r.oneAr) : "") || (many ? r.many || r.one : r.one);

export function vocabOf(t: Pick<Tenant, "business"> | null | undefined, locale: Locale): Vocab {
  const b = businessOf(t);
  const v = { ...VOCAB[b.type][locale] };
  const w = b.words ?? {};
  const pick = (k: string) => (w[(locale === "ar" ? `${k}Ar` : k) as WordKey] ?? "").trim();
  // the team word: the admin's own, else the only role's name, else (several roles) a neutral word
  const roles = b.roles?.length ? rolesOf(t) : [];
  if (roles.length === 1) { v.staffOne = lower(roleName(roles[0], locale), locale); v.staffMany = lower(roleName(roles[0], locale, true), locale); }
  else if (roles.length > 1) { v.staffOne = VOCAB.retail[locale].staffOne; v.staffMany = VOCAB.retail[locale].staffMany; }
  if (pick("staffOne")) { v.staffOne = pick("staffOne"); v.staffMany = pick("staffMany") || (locale === "en" ? v.staffOne + "s" : v.staffOne); }
  else if (pick("staffMany")) v.staffMany = pick("staffMany");
  if (pick("customerOne")) { v.customerOne = pick("customerOne"); v.customerMany = pick("customerMany") || (locale === "en" ? v.customerOne + "s" : v.customerOne); }
  else if (pick("customerMany")) v.customerMany = pick("customerMany");
  if (pick("placeOne")) { v.place = pick("placeOne"); v.placeMany = pick("placeMany") || (locale === "en" ? v.place + "s" : v.place); }
  else if (pick("placeMany")) v.placeMany = pick("placeMany");
  return v;
}


/** English: whole words only, keeps capitals and the possessive. */
function relabelEn(s: string, v: Vocab, base: Vocab): string {
  const pairs: [string, string][] = [
    [base.staffMany, v.staffMany], [base.staffOne, v.staffOne],
    [base.customerMany, v.customerMany], [base.customerOne, v.customerOne],
    [base.placeMany, v.placeMany], [base.place, v.place],
  ];
  let out = s;
  // plural possessive: "doctors' calendars" -> "stylists' calendars", but "staff calendars" (no apostrophe after "staff")
  if (base.staffMany !== v.staffMany && !v.staffMany.endsWith("s"))
    out = out.replace(new RegExp(`\\b(${base.staffMany}|${cap(base.staffMany)})'`, "g"), (m) => (m[0] === m[0].toUpperCase() ? cap(v.staffMany) : v.staffMany));
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
  const words = Object.fromEntries(WORD_KEYS.map((k) => [k, w(k)]).filter(([, v]) => v)) as BusinessProfile["words"];
  const roles = has("roleCount") ? rolesFromForm(get) : undefined;
  return {
    type,
    // a clinic always books doctors; the box only appears with the other types
    staffScheduling: type === "clinic" ? true : has("schedulingShown") ? get("staffScheduling") === "on" : SCHEDULING_DEFAULT[type],
    ...(words && Object.keys(words).length ? { words } : {}),
    ...(roles && roles.length ? { roles } : {}),
    ...(has("idShown") ? { id: idFromForm(get) } : {}),
  };
}

/** The ID rule inputs of the business form (idKind, idEn, idAr, idFormat, idLength). A custom ID needs an English name. */
export function idFromForm(get: (k: string) => string): IdRule {
  const kind = (ID_KINDS as readonly string[]).includes(get("idKind")) ? (get("idKind") as IdKind) : "cpr";
  if (kind !== "custom") return { kind };
  const t = (k: string) => get(k).replace(/\s+/g, " ").trim().slice(0, 40);
  const n = Math.round(Number(get("idLength")));
  const en = t("idEn");
  if (!en) return { kind: "cpr" };
  return { kind, en, ar: t("idAr") || en, format: get("idFormat") === "text" ? "text" : "digits", ...(n >= 4 && n <= 20 ? { length: n } : {}) };
}

/** A role key from its English name: lower case latin letters, digits and "_", unique among the client's roles. */
export function roleKey(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "role";
  let key = /^[a-z]/.test(base) ? base : `r_${base}`;
  for (let n = 2; used.has(key); n++) key = `${base}_${n}`;
  return key;
}

/**
 * The role lines of the business form (role0_key, role0_one, ...; `roleCount` lines). A removed or blank line is dropped; an
 * existing role keeps its key so its team members keep it. English singular is required; the rest fills itself.
 */
export function rolesFromForm(get: (k: string) => string): Role[] {
  const n = Math.min(Number(get("roleCount")) || 0, MAX_ROLES + 3);
  const t = (k: string) => get(k).replace(/\s+/g, " ").trim().slice(0, 40);
  const lines = Array.from({ length: n }, (_, i) => ({
    key: /^[a-z][a-z0-9_]{0,30}$/.test(get(`role${i}_key`)) ? get(`role${i}_key`) : "",
    one: t(`role${i}_one`), many: t(`role${i}_many`), oneAr: t(`role${i}_oneAr`), manyAr: t(`role${i}_manyAr`), remove: get(`role${i}_remove`) === "on",
  })).filter((l) => !l.remove && l.one);
  const taken = new Set(lines.map((l) => l.key).filter(Boolean));
  const out: Role[] = [];
  for (const l of lines) {
    const key = l.key || roleKey(l.one, taken);
    taken.add(key);
    if (out.some((r) => r.key === key)) continue;
    out.push({ key, one: l.one, many: l.many || `${l.one}s`, oneAr: l.oneAr, manyAr: l.manyAr || l.oneAr });
  }
  return out.slice(0, MAX_ROLES);
}
