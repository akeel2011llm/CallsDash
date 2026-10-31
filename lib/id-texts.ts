/**
 * The screen texts that name the CPR number, written again for a client that asks for another ID number (`custom`) or for
 * none (`none`). getT() uses them in place of the texts in lib/i18n.ts; {id} is the ID's name as a label, {idl} the same name
 * inside a sentence, and {format} what a valid number looks like (lib/id-rule.ts). A client that asks for the CPR number reads
 * the texts exactly as written in lib/i18n.ts.
 */
import { idFormat, idName, type IdRule } from "./id-rule";
import type { Locale } from "./types";

type Texts = Record<string, string>;

const CUSTOM: Record<Locale, Texts> = {
  en: {
    "bookings.searchPlaceholder": "Name, phone, {idl} or booking reference",
    "customers.help": "People the assistant has talked to. Below, choose whether it finds a returning customer by phone number or by {idl}.",
    "customers.cpr": "{id}",
    "customers.cpr.help": "Optional, {format}. The assistant asks for it before it shares notes and earlier conversations.",
    "customers.notes.help": "Preferences and practical things to remember. Not for medical details. The assistant can read these once the customer has been checked with the {idl}.",
    "customers.err.bad_cpr": "The {idl} must be {format}.",
    "customers.lookup.phone.help": "Best when customers call or write from their own phone. The assistant greets them by first name; their notes and past conversations stay private until they say their {idl}.",
    "customers.lookup.cpr": "By {idl}",
    "customers.lookup.cpr.help": "The assistant asks for the {idl} and finds the customer whatever phone they use. A matching {idl} is enough to share their notes and past conversations.",
    "customers.lookup.note": "The assistant is updated automatically after you save. Customers who have no {idl} on file cannot be found by it, so add it on their record.",
    "bookings.patientCpr": "{id}",
    "bookings.cprHelp": "The customer's {idl} ({format}). Leave it empty for someone who has none. The AI receptionist always asks for it, and customers give it again to find, move or cancel a booking.",
    "bookings.noCpr": "Not recorded",
    "bookings.cprShort": "{id}",
    "bookings.err.bad_cpr": "The {idl} must be {format}.",
    "bookings.wa.help": "The message has the doctor, service, date, time, the clinic's address and phone, and a booking reference. The {idl} is never sent.",
    "data.err.bad_cpr": "The {idl} must be {format}.",
    "data.err.cpr_mismatch": "The {idl} does not match the one on file.",
  },
  ar: {
    "bookings.searchPlaceholder": "الاسم أو الهاتف أو {id} أو رقم الحجز",
    "customers.help": "الأشخاص الذين تحدّث معهم المساعد. اختاروا أدناه هل يتعرّف على العميل العائد برقم الهاتف أم بـ{id}.",
    "customers.cpr": "{id}",
    "customers.cpr.help": "اختياري، {format}. يطلبه المساعد قبل أن يشارك الملاحظات والمحادثات السابقة.",
    "customers.notes.help": "تفضيلات وأمور عملية للتذكّر. ليست للتفاصيل الطبية. يستطيع المساعد قراءتها بعد التحقق من العميل بـ{id}.",
    "customers.err.bad_cpr": "{id}: {format}.",
    "customers.lookup.phone.help": "الأنسب عندما يتصل العملاء أو يكتبون من هواتفهم. يرحّب المساعد بالعميل باسمه الأول، وتبقى ملاحظاته ومحادثاته السابقة خاصة إلى أن يذكر {id}.",
    "customers.lookup.cpr": "بـ{id}",
    "customers.lookup.cpr.help": "يطلب المساعد {id} ويجد العميل مهما كان هاتفه. يكفي تطابق {id} لعرض ملاحظاته ومحادثاته السابقة.",
    "customers.lookup.note": "يتحدّث المساعد تلقائياً بعد الحفظ. العملاء الذين لا يوجد {id} في سجلهم لا يمكن إيجادهم به، لذا أضيفوه في سجلهم.",
    "bookings.patientCpr": "{id}",
    "bookings.cprHelp": "{id} الخاص بالعميل ({format}). اتركه فارغاً لمن ليس لديه رقم. يطلبه موظف الاستقبال الذكي دائماً، ويذكره العميل مرة أخرى للاستعلام عن حجزه أو تغييره أو إلغائه.",
    "bookings.noCpr": "غير مسجّل",
    "bookings.cprShort": "{id}",
    "bookings.err.bad_cpr": "{id}: {format}.",
    "bookings.wa.help": "تتضمن الرسالة الطبيب والخدمة والتاريخ والوقت وعنوان العيادة وهاتفها ورقم الحجز. لا يُرسل {id} أبداً.",
    "data.err.bad_cpr": "{id}: {format}.",
    "data.err.cpr_mismatch": "{id} لا يطابق المسجّل.",
  },
};

/** No ID: the inputs are hidden, so only the texts that still show are written again. */
const NONE: Record<Locale, Texts> = {
  en: {
    "bookings.searchPlaceholder": "Name, phone or booking reference",
    "customers.help": "People the assistant has talked to. It finds a returning customer by phone number.",
    "customers.notes.help": "Preferences and practical things to remember. Not for medical details. Only your team sees these: without an ID number the assistant never shares them.",
    "customers.lookup.phone.help": "The assistant greets a returning customer by first name. Their notes and past conversations stay private, because this business asks for no ID number to check who is calling.",
    "bookings.noCpr": "Not recorded",
    "bookings.wa.help": "The message has the doctor, service, date, time, the clinic's address and phone, and a booking reference.",
  },
  ar: {
    "bookings.searchPlaceholder": "الاسم أو الهاتف أو رقم الحجز",
    "customers.help": "الأشخاص الذين تحدّث معهم المساعد. يتعرّف على العميل العائد برقم الهاتف.",
    "customers.notes.help": "تفضيلات وأمور عملية للتذكّر. ليست للتفاصيل الطبية. يراها فريقكم فقط: من دون رقم هوية لا يشاركها المساعد أبداً.",
    "customers.lookup.phone.help": "يرحّب المساعد بالعميل العائد باسمه الأول. وتبقى ملاحظاته ومحادثاته السابقة خاصة، لأن هذه المنشأة لا تطلب رقم هوية للتحقق من المتصل.",
    "bookings.noCpr": "غير مسجّل",
    "bookings.wa.help": "تتضمن الرسالة الطبيب والخدمة والتاريخ والوقت وعنوان العيادة وهاتفها ورقم الحجز.",
  },
};

/** The texts to use in place of the CPR wording for this rule, with {id}, {idl} and {format} filled in; empty for the CPR rule. */
export function idTexts(r: IdRule, locale: Locale): Texts {
  if (r.kind === "cpr") return {};
  if (r.kind === "none") return NONE[locale];
  const id = idName(r, locale);
  const idl = locale === "en" && /^[A-Z][a-z]/.test(id) ? id[0].toLowerCase() + id.slice(1) : id;
  const fill = (s: string) => s.replace(/\{id\}/g, id).replace(/\{idl\}/g, idl).replace(/\{format\}/g, idFormat(r, locale));
  return Object.fromEntries(Object.entries(CUSTOM[locale]).map(([k, v]) => [k, fill(v)]));
}
