/**
 * Which ID number a client asks its customers for (step 2 of the any-business plan). A Bahraini clinic asks for the CPR
 * number; a gym may ask for a membership number, a hotel for a passport number, and a shop for nothing at all (the phone
 * number is enough). The rule is part of the client's business profile and is set on the admin Business tab.
 *
 * Every client made before this existed asks for the CPR number, so nothing changes for them. The value is stored where the
 * CPR number always was (bookings.patient_cpr, customers.cpr), and the tools keep their `patient_cpr` field name.
 *
 * Pure module (no server code), so screens, actions and tests can all use it.
 */
import { CPR_DIGITS, asciiDigits, normalizeCpr } from "./cpr";
import type { Locale } from "./types";

export const ID_KINDS = ["cpr", "custom", "none"] as const;
export type IdKind = (typeof ID_KINDS)[number];

export interface IdRule {
  /** cpr: the Bahraini CPR number (9 digits). custom: an ID the admin names. none: no ID; the phone number finds a booking. */
  kind: IdKind;
  /** custom only: the ID's name in English and Arabic ("Passport number", "رقم الجواز"). */
  en?: string;
  ar?: string;
  /** custom only: digits only, or letters and digits (a passport number). */
  format?: "digits" | "text";
  /** custom only: the exact length, when every number has the same length. Missing = 4 to 20 characters. */
  length?: number;
}

export const ID_CPR: IdRule = { kind: "cpr" };
export const ID_MIN = 4;
export const ID_MAX = 20;

/** The client's rule. Missing on every client made before the rule existed: those ask for the CPR number. */
export function idRuleOf(t?: { business?: { id?: IdRule } | null } | null): IdRule {
  const r = t?.business?.id;
  if (!r || !ID_KINDS.includes(r.kind)) return ID_CPR;
  if (r.kind !== "custom") return { kind: r.kind };
  return { kind: "custom", en: r.en || "ID number", ar: r.ar || "رقم الهوية", format: r.format === "text" ? "text" : "digits", ...(r.length ? { length: r.length } : {}) };
}

/** Whether customers give an ID number to book and to find, move or cancel a booking. */
export const asksId = (r: IdRule) => r.kind !== "none";

/**
 * The ID as stored, or null when it is not a valid number under the rule. Spaces, dashes and dots are dropped, Arabic digits
 * read as digits, letters are upper case. The same character over and over (000000000) is a placeholder, not a number.
 */
export function normalizeId(r: IdRule, v: string | null | undefined): string | null {
  if (r.kind === "none") return null;
  if (r.kind === "cpr") return normalizeCpr(v);
  const s = asciiDigits(String(v ?? "")).replace(/[\s.\-–/]/g, "").toUpperCase();
  const ok = r.format === "text" ? /^[A-Z0-9]+$/.test(s) : /^\d+$/.test(s);
  const len = r.length ? s.length === r.length : s.length >= ID_MIN && s.length <= ID_MAX;
  return ok && len && !/^(.)\1+$/.test(s) ? s : null;
}

/** The ID's name on screens, as a heading or label ("CPR number", "Passport number"). */
export function idName(r: IdRule, locale: Locale): string {
  if (r.kind === "cpr") return locale === "ar" ? "الرقم الشخصي (CPR)" : "CPR number";
  if (r.kind === "none") return locale === "ar" ? "رقم الهوية" : "ID number";
  return (locale === "ar" ? r.ar : r.en) || (locale === "ar" ? "رقم الهوية" : "ID number");
}

/** What a valid number looks like, in words ("9 digits", "letters and digits, 8 characters"). */
export function idFormat(r: IdRule, locale: Locale): string {
  const ar = locale === "ar";
  if (r.kind === "cpr") return ar ? `${CPR_DIGITS} أرقام` : `${CPR_DIGITS} digits`;
  const n = r.length;
  if (r.format === "text") return ar ? `أحرف وأرقام${n ? `، ${n} خانات` : ""}` : `letters and digits${n ? `, ${n} characters` : ""}`;
  return n ? (ar ? `${n} أرقام` : `${n} digits`) : (ar ? "أرقام فقط" : "digits only");
}

/** A name in the middle of an English sentence: "Passport number" reads "passport number", "QID" stays "QID". */
const inSentence = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

/**
 * Rewrites English text written for the CPR number (the assistant's rules, tool answers) for another ID. CPR text comes back
 * unchanged, so a client that asks for the CPR number gets the same words as before. Not meant for the `none` rule, which
 * has its own wording wherever it differs.
 */
export function idify(text: string, r: IdRule): string {
  if (r.kind === "cpr") return text;
  const name = inSentence(idName(r, "en"));
  const fmt = idFormat(r, "en");
  const bit = r.format === "text" ? "character by character" : "digit by digit";
  return text
    .replace(/CPR number \(the 9-digit personal number on the Bahraini ID card\)/g, `${name} (${fmt})`)
    .replace(/CPR number: the 9 digits on (?:their|the) Bahraini ID card/g, `${name} (${fmt})`)
    .replace(/CPR number \(9 digits\)/g, `${name} (${fmt})`)
    .replace(/CPR number, 9 digits/g, `${name}, ${fmt}`)
    .replace(/CPR number must be 9 digits/g, `${name} must be ${fmt}`)
    .replace(/must be 9 digits/g, `must be ${fmt}`)
    .replace(/, 9 digits/g, `, ${fmt}`)
    .replace(/digit by digit/g, bit)
    .replace(/before CPR numbers were asked/g, `before the ${name} was asked`)
    .replace(/before the CPR was asked/g, `before the ${name} was asked`)
    .replace(/ \(for example a visitor\)/g, "")
    .replace(/CPR numbers/g, `${name}s`)
    .replace(/CPR number/g, name)
    .replace(/\bCPR\b/g, name);
}

/** The ID input's attributes for a form: a number pad for digits, room for spaces and dashes, a sample only for the CPR number. */
export function idInputProps(r: IdRule) {
  const text = r.kind === "custom" && r.format === "text";
  return {
    inputMode: text ? ("text" as const) : ("numeric" as const),
    maxLength: r.kind === "cpr" ? 12 : (r.length ?? ID_MAX) + 6,
    placeholder: r.kind === "cpr" ? "850123456" : undefined,
    autoCapitalize: text ? "characters" : "off",
    autoComplete: "off",
    dir: "ltr" as const,
  };
}
