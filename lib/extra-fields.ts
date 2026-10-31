/**
 * A client's own fields (step 2b of the any-business plan): the admin adds questions to bookings (insurance company, car
 * plate, party size), customers (date of birth, membership level) and team members (languages spoken, gender). Each field has
 * the same types as a custom table column (lib/custom-tables.ts). On bookings and customers a field can be marked "the
 * assistant asks"; on team members, "the assistant may tell customers".
 *
 * The definitions live in tenants.business.fields; the answers in the `extra` column of bookings, customers and doctors, by
 * field key. A removed field's answers stay stored (nothing is deleted) and come back if the field is added again with the
 * same key. Pure module, shared by screens, actions, the assistant and tests.
 */
import { FIELD_TYPES, cleanValue, fieldsFromLines, labelOf, type FieldLine } from "./custom-tables";
import { foldText } from "./items";
import type { DataField, DataFieldType, Locale } from "./types";

export const EXTRA_TARGETS = ["booking", "customer", "team"] as const;
export type ExtraTarget = (typeof EXTRA_TARGETS)[number];
export const isExtraTarget = (v: unknown): v is ExtraTarget => typeof v === "string" && (EXTRA_TARGETS as readonly string[]).includes(v);

/** A stock count makes no sense on a booking or a person; every other column type does. */
export const EXTRA_TYPES: DataFieldType[] = FIELD_TYPES.filter((x) => x !== "stock");
export const MAX_EXTRA = 15;

export interface ExtraField extends DataField {
  /** Bookings and customers: the assistant asks for it. Team members: the assistant may tell customers. */
  ask?: boolean;
}
export type ExtraFields = Partial<Record<ExtraTarget, ExtraField[]>>;
export type ExtraValues = Record<string, string>;

export class ExtraError extends Error {
  constructor(readonly code: "bad_field" | "too_many_fields" | "duplicate_label", readonly label = "") { super(code); }
}

/** The client's fields for one target, in their order. */
export function extraFieldsOf(t: { business?: { fields?: ExtraFields } | null } | null | undefined, target: ExtraTarget): ExtraField[] {
  const list = t?.business?.fields?.[target];
  return Array.isArray(list) ? list.filter((f) => f && typeof f.key === "string" && typeof f.label === "string") : [];
}

/** The designer form's lines (f0_key, f0_label, ... f0_ask) as fields, checked: a label each, unique labels, options for a choice. */
export function extraFromLines(lines: (FieldLine & { ask?: boolean })[]): ExtraField[] {
  const fields = fieldsFromLines(lines.map((l) => ({ ...l, type: EXTRA_TYPES.includes(l.type as DataFieldType) ? l.type : "text" })));
  if (fields.length > MAX_EXTRA) throw new ExtraError("too_many_fields");
  const seen = new Set<string>();
  return fields.map((f) => {
    if (!f.label) throw new ExtraError("bad_field");
    if (f.type === "choice" && !(f.options ?? []).length) throw new ExtraError("bad_field", f.label);
    const k = foldText(f.label);
    if (seen.has(k)) throw new ExtraError("duplicate_label", f.label);
    seen.add(k);
    const line = lines.find((l) => l.key === f.key) ?? lines.find((l) => !l.key && foldText(l.label) === k);
    return { ...f, ...(line?.ask ? { ask: true } : {}) };
  });
}

/**
 * Tidies the answers for these fields. `need` decides which blank required answers are errors: "all" on a staff form, "asked"
 * for the assistant (it can only give what it asks for), "none" when only some answers are given (an import). Answers to
 * other keys are ignored.
 */
export function cleanExtra(fields: ExtraField[], raw: Record<string, unknown>, need: "all" | "asked" | "none" = "all"):
  { values: ExtraValues; errors: { key: string; label: string; code: string }[] } {
  const values: ExtraValues = {};
  const errors: { key: string; label: string; code: string }[] = [];
  for (const f of fields) {
    if (!(f.key in raw) && need === "none") continue;
    const r = cleanValue(f, raw[f.key]);
    if ("error" in r) { errors.push({ key: f.key, label: f.label, code: r.error }); continue; }
    if (!r.value && f.required && (need === "all" || (need === "asked" && f.ask))) { errors.push({ key: f.key, label: f.label, code: "required" }); continue; }
    values[f.key] = r.value;
  }
  return { values, errors };
}

/** The answers a form sent: inputs named x_<key>. */
export const extraFromForm = (fields: ExtraField[], get: (k: string) => string): Record<string, string> =>
  Object.fromEntries(fields.map((f) => [f.key, get(`x_${f.key}`)]));

/**
 * New answers on top of what was stored: the shown fields take their new value (blank clears it), answers to fields that are
 * no longer shown are kept.
 */
export function mergeExtra(before: ExtraValues | undefined, fields: ExtraField[], values: ExtraValues): ExtraValues {
  const out: ExtraValues = { ...(before ?? {}) };
  for (const f of fields) {
    if (f.key in values && values[f.key]) out[f.key] = values[f.key];
    else if (f.key in values) delete out[f.key];
  }
  return out;
}

/**
 * The `details` the assistant passes: a JSON object, or "label: value" lines. Keys may be the field key or its English or
 * Arabic label, in any case. Unknown keys are dropped.
 */
export function parseDetails(fields: ExtraField[], raw: unknown): Record<string, string> {
  let pairs: [string, unknown][] = [];
  if (raw && typeof raw === "object" && !Array.isArray(raw)) pairs = Object.entries(raw as Record<string, unknown>);
  else if (typeof raw === "string" && raw.trim()) {
    const s = raw.trim();
    try {
      const o = JSON.parse(s);
      if (o && typeof o === "object" && !Array.isArray(o)) pairs = Object.entries(o);
    } catch {
      pairs = s.split(/\n|;/).map((line) => line.split(/[:=]/)).filter((p) => p.length >= 2).map(([k, ...v]) => [k, v.join(":")]);
    }
  }
  const out: Record<string, string> = {};
  for (const [k, v] of pairs) {
    const want = foldText(String(k)).replace(/[\s_-]+/g, " ").trim();
    const f = fields.find((x) => [x.key, x.label, x.labelAr ?? ""].some((n) => n && foldText(n).replace(/[\s_-]+/g, " ").trim() === want));
    if (f && v != null && typeof v !== "object") out[f.key] = String(v).trim().slice(0, 500);
  }
  return out;
}

/** The answers as label and value for a screen, in field order; yes/no in words. Fields without an answer are left out. */
export function extraLines(fields: ExtraField[], values: ExtraValues | undefined, locale: Locale, yesNo: { yes: string; no: string }): { key: string; label: string; value: string }[] {
  if (!values) return [];
  return fields
    .filter((f) => values[f.key])
    .map((f) => ({ key: f.key, label: labelOf(f, locale), value: f.type === "yesno" ? (values[f.key] === "yes" ? yesNo.yes : yesNo.no) : values[f.key] }));
}

/** One field described for the assistant: its key, name, type and, for a choice, the answers it accepts. */
export function describeField(f: ExtraField): string {
  const kind = f.type === "choice" ? `one of: ${(f.options ?? []).join(", ")}` : f.type === "yesno" ? "yes or no" : f.type === "date" ? "a date, YYYY-MM-DD"
    : f.type === "number" || f.type === "price" ? "a number" : f.type === "link" ? "a web address" : "text";
  return `${f.label}${f.labelAr ? ` (in Arabic ${f.labelAr})` : ""}: key \`${f.key}\`, ${kind}${f.required ? ", required" : ""}`;
}
