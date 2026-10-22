import { describeSlot } from "./availability";
import { agentVariables } from "./agent-context";
import { asciiDigits } from "./cpr";
import { plainDetail, type ElevenLabsApi } from "./elevenlabs-api";
import type { Data } from "./data/demo";
import type { BookingMessage, Locale, Tenant, WhatsappSettings } from "./types";

/**
 * WhatsApp ids are digits with the country code, no plus or spaces. A bare 8-digit number is a Bahrain number.
 * Returns "" when it cannot be a phone number.
 */
export function whatsappUserId(phone: string): string {
  let d = asciiDigits(phone).replace(/\D/g, "").replace(/^00/, ""); // a number typed with Arabic digits is still a number
  if (d.length === 8) d = `973${d}`;
  return d.length >= 9 && d.length <= 15 ? d : "";
}

export type Wording = "full" | "short";

export interface TemplateSpec {
  /** What the template is called in WhatsApp Manager unless the admin chose another name. */
  name: string;
  /** The named variables, in the order the body uses them. They must match the template exactly (Meta error 132000 otherwise). */
  variables: readonly string[];
  /** The body to paste into WhatsApp Manager, per language. */
  text: Record<Locale, string>;
  /** Example values Meta asks for next to each variable when the template is created. */
  samples: Record<Locale, Record<string, string>>;
}

const FULL_VARIABLES = ["name", "clinic", "doctor", "service", "date", "time", "address", "phone", "reference"] as const;

/**
 * The confirmation with every booking detail. Written to be approved as a Utility template: it only confirms the patient's own
 * appointment, has no offers, starts and ends with fixed words and has plenty of fixed text around its variables.
 */
const FULL: TemplateSpec = {
  name: "appointment_confirmation",
  variables: FULL_VARIABLES,
  text: {
    en: [
      "Hello {{name}}, your appointment at {{clinic}} is confirmed.", "",
      "Doctor: {{doctor}}", "Service: {{service}}", "Date: {{date}}", "Time: {{time}}", "Address: {{address}}", "Clinic phone: {{phone}}", "Booking reference: {{reference}}", "",
      "To change or cancel your appointment, just reply to this message.",
    ].join("\n"),
    ar: [
      "مرحباً {{name}}، تم تأكيد موعدك في {{clinic}}.", "",
      "الطبيب: {{doctor}}", "الخدمة: {{service}}", "التاريخ: {{date}}", "الوقت: {{time}}", "العنوان: {{address}}", "هاتف العيادة: {{phone}}", "رقم الحجز: {{reference}}", "",
      "لتعديل الموعد أو إلغائه، يمكنك الرد على هذه الرسالة.",
    ].join("\n"),
  },
  samples: {
    en: { name: "Sara Ahmed", clinic: "Al Noor Clinic", doctor: "Dr. Hana", service: "Consultation", date: "Saturday 24 October 2026", time: "4:00 PM", address: "Building 12, Road 3, Manama", phone: "+973 1700 0000", reference: "3F2A9C1E" },
    ar: { name: "سارة أحمد", clinic: "عيادة النور", doctor: "د. هناء", service: "استشارة", date: "السبت 24 أكتوبر 2026", time: "4:00 م", address: "مبنى 12، طريق 3، المنامة", phone: "+973 1700 0000", reference: "3F2A9C1E" },
  },
};

/** The first, shorter confirmation (name, clinic, doctor and time). Clinics whose template was made from it keep working with it. */
const SHORT: TemplateSpec = {
  name: "booking_confirmation",
  variables: ["name", "clinic", "doctor", "time"],
  text: {
    en: "Hello {{name}}, your appointment at {{clinic}} with {{doctor}} is confirmed for {{time}}. Reply here if you need to change or cancel it.",
    ar: "مرحباً {{name}}، تم تأكيد موعدك في {{clinic}} مع {{doctor}} يوم {{time}}. للتعديل أو الإلغاء يمكنك الرد على هذه الرسالة.",
  },
  samples: {
    en: { name: "Sara Ahmed", clinic: "Al Noor Clinic", doctor: "Dr. Hana", time: "Saturday 24 October, 16:00" },
    ar: { name: "سارة أحمد", clinic: "عيادة النور", doctor: "د. هناء", time: "السبت 24 أكتوبر، 16:00" },
  },
};

export const TEMPLATES: Record<Wording, TemplateSpec> = { full: FULL, short: SHORT };

/** A clinic that already saved a template before the full wording existed keeps the short one until an admin switches. */
export const wordingOf = (w?: WhatsappSettings): Wording => w?.confirmWording ?? (w?.confirmTemplate ? "short" : "full");
export const mainLanguage = (w?: WhatsappSettings): Locale => (w?.confirmTemplateLang === "ar" ? "ar" : "en");

/** The languages the clinic's template exists in at Meta: always the main one, plus the ticked ones for the full wording. */
export function templateLanguages(w?: WhatsappSettings): Locale[] {
  const main = mainLanguage(w);
  const extra = wordingOf(w) === "full" ? (w?.templateLangs ?? []) : [];
  return (["en", "ar"] as const).filter((l) => l === main || extra.includes(l));
}

/** The template language for a patient: their own when the clinic has a template in it, otherwise the clinic's main one. */
export function pickLanguage(w: WhatsappSettings | undefined, wanted?: Locale): Locale {
  return wanted && templateLanguages(w).includes(wanted) ? wanted : mainLanguage(w);
}

const TZ = "Asia/Bahrain";
const tag = (l: Locale) => (l === "ar" ? "ar-BH-u-nu-latn" : "en-GB");
/** "Saturday 24 October 2026" */
export const slotDate = (iso: string, l: Locale) => new Intl.DateTimeFormat(tag(l), { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: TZ }).format(new Date(iso));
/** "4:00 PM" ("4:00 م" in Arabic): the time of day patients in Bahrain read most easily. */
export const slotTime = (iso: string, l: Locale) => new Intl.DateTimeFormat(l === "ar" ? tag(l) : "en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ }).format(new Date(iso));

/**
 * WhatsApp refuses a template value that is empty, runs over several lines or has long runs of spaces, so every value is
 * made one tidy line, cut to `max` characters. A value left empty becomes a dash.
 */
export function cleanValue(v: string | undefined, max = 120): string {
  const s = (v ?? "").replace(/\s+/g, " ").trim();
  return (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s) || "-";
}

const clinicName = (tenant: Pick<Tenant, "name" | "branding">, lang: Locale) =>
  (lang === "ar" ? tenant.branding.displayNameAr : tenant.branding.displayName) || tenant.name;

/** The address as printed: the clinic's address in the patient's language, then the map link. */
export function addressLine(w: WhatsappSettings | undefined, lang: Locale): string {
  const text = (lang === "ar" ? w?.addressAr || w?.address : w?.address || w?.addressAr) ?? "";
  return [text.trim(), (w?.mapUrl ?? "").trim()].filter(Boolean).join(" - ");
}

/** The clinic's phone: the one typed for the confirmation, else its support phone, else the WhatsApp number patients are writing to. */
export const clinicPhone = (tenant: Pick<Tenant, "branding">, w?: WhatsappSettings) => w?.phone || tenant.branding.supportPhone || w?.displayNumber || "";

/** The booking the confirmation is about. */
export interface ConfirmationBooking {
  patientName: string; patientPhone: string; doctorName: string; startsAt: string;
  service?: string; /** See `bookingRef`. */ reference?: string; language?: Locale;
}

const serviceLabel = (service: string | undefined, lang: Locale) => (lang === "ar" && /^\s*consultation\s*$/i.test(service ?? "") ? "استشارة" : service || (lang === "ar" ? "استشارة" : "Consultation"));

/** What goes into each variable of the template, for this booking, in this language. */
export function confirmationValues(wording: Wording, tenant: Pick<Tenant, "name" | "branding">, w: WhatsappSettings | undefined, lang: Locale, b: ConfirmationBooking): Record<string, string> {
  const name = cleanValue(b.patientName, 80), clinic = cleanValue(clinicName(tenant, lang), 80), doctor = cleanValue(b.doctorName, 80);
  if (wording === "short") return { name, clinic, doctor, time: cleanValue(describeSlot(b.startsAt, lang), 80) };
  return {
    name, clinic, doctor,
    service: cleanValue(serviceLabel(b.service, lang), 80),
    date: cleanValue(slotDate(b.startsAt, lang), 60),
    time: cleanValue(slotTime(b.startsAt, lang), 40),
    address: cleanValue(addressLine(w, lang), 300),
    phone: cleanValue(clinicPhone(tenant, w), 40),
    reference: cleanValue(b.reference, 16),
  };
}

/** The `template_params` of ElevenLabs' outbound message: the body's named variables, in the template's order. */
export function templateParams(wording: Wording, values: Record<string, string>) {
  return [{
    type: "body" as const,
    parameters: TEMPLATES[wording].variables.map((k) => ({ type: "text" as const, parameter_name: k, text: values[k] ?? "-" })),
  }];
}

/** The message as the patient reads it, for the preview on the Channels page. */
export function renderTemplate(wording: Wording, lang: Locale, values: Record<string, string>): string {
  return TEMPLATES[wording].text[lang].replace(/\{\{(\w+)\}\}/g, (m, k: string) => values[k] ?? m);
}

export type SkipReason = "channel_off" | "confirmations_off" | "not_configured" | "bad_phone" | "no_agent";
export type ConfirmationResult =
  | { status: "sent"; conversationId?: string; lang: Locale }
  | { status: "skipped"; reason: SkipReason }
  | { status: "failed"; error: string; lang: Locale };

export type ConfirmationPlan =
  | { send: true; tenant: Tenant; settings: WhatsappSettings; agentId: string; userId: string; wording: Wording; lang: Locale }
  | { send: false; reason: SkipReason };

/** Whether a confirmation can be sent to this phone, and in which language, without sending anything. */
export async function planConfirmation(d: { data: Pick<Data, "getTenant" | "getAgent"> }, tenantId: string, phone: string, wanted?: Locale): Promise<ConfirmationPlan> {
  const tenant = await d.data.getTenant(tenantId);
  const settings = tenant?.integrations.whatsapp;
  if (!tenant || tenant.channels.whatsapp !== "connected") return { send: false, reason: "channel_off" };
  if (settings?.confirmations === false) return { send: false, reason: "confirmations_off" };
  if (!settings?.phoneNumberId || !settings.confirmTemplate) return { send: false, reason: "not_configured" };
  const userId = whatsappUserId(phone);
  if (!userId) return { send: false, reason: "bad_phone" };
  const agentId = (await d.data.getAgent(tenantId)).elevenLabsAgentId;
  if (!agentId) return { send: false, reason: "no_agent" };
  return { send: true, tenant, settings, agentId, userId, wording: wordingOf(settings), lang: pickLanguage(settings, wanted) };
}

/**
 * Sends the booking confirmation template to the patient's WhatsApp. Never throws: a failed confirmation must not undo a
 * booking, so the outcome is returned for the caller to record. "sent" means ElevenLabs accepted it; Meta can still decline.
 */
export async function sendBookingConfirmation(
  d: { api: ElevenLabsApi; data: Pick<Data, "getTenant" | "getAgent">; now?: () => Date },
  tenantId: string,
  b: ConfirmationBooking,
): Promise<ConfirmationResult> {
  const plan = await planConfirmation(d, tenantId, b.patientPhone, b.language);
  if (!plan.send) return { status: "skipped", reason: plan.reason };
  const { tenant, settings, lang, userId } = plan;
  try {
    const r = await d.api.sendWhatsappTemplate({
      phoneNumberId: settings.phoneNumberId!, userId, templateName: settings.confirmTemplate!, languageCode: lang, agentId: plan.agentId,
      params: templateParams(plan.wording, confirmationValues(plan.wording, tenant, settings, lang, b)),
      // The patient's reply continues this conversation. Template values are not visible to the assistant, and a variable it
      // reads that has no value would stop the conversation, so it gets the same ones as any other chat.
      dynamicVariables: agentVariables(tenant, (d.now ?? (() => new Date()))(), { channel: "whatsapp", callerPhone: `+${userId}` }),
    });
    return { status: "sent", conversationId: r.conversation_id, lang };
  } catch (e) {
    return { status: "failed", error: plainDetail(e instanceof Error ? e.message : "unknown error").slice(0, 300), lang };
  }
}

/** What to record on the booking for an outcome, or null when there is nothing worth showing (WhatsApp is simply not used). */
export function messageOf(r: ConfirmationResult, at: string): BookingMessage | null {
  if (r.status === "sent") return { status: "sent", at, lang: r.lang, ...(r.conversationId ? { conversationId: r.conversationId } : {}) };
  if (r.status === "failed") return { status: "failed", at, detail: r.error, lang: r.lang };
  if (r.reason === "channel_off" || r.reason === "confirmations_off") return null;
  return { status: "skipped", at, detail: r.reason };
}

/** What the sender said when it refused a message that an admin can fix: the codes are Meta's, as ElevenLabs lists them. */
export type FailureHint = "template" | "params" | "payment" | "name" | "token";
export function failureHint(error: string | undefined): FailureHint | null {
  const e = error ?? "";
  if (/\b132001\b|template[^.]*(not found|does not exist|not approved|pending|rejected)/i.test(e)) return "template";
  if (/\b132000\b|parameter[^.]*(count|number|match)/i.test(e)) return "params";
  if (/\b131042\b|payment/i.test(e)) return "payment";
  if (/\b131037\b|display name/i.test(e)) return "name";
  if (/access token|token[^.]*expired|\b190\b[^.]*token/i.test(e)) return "token";
  return null;
}

/** The same advice in English, for the alert an admin sees. */
export const HINT_EN: Record<FailureHint, string> = {
  template: "Check the template's name and language in WhatsApp Manager, and that its status is approved.",
  params: "The template must have exactly the variables CallsDash sends (Channels, WhatsApp shows them).",
  payment: "Add or fix the payment method in WhatsApp Manager.",
  name: "Finish the display name approval in WhatsApp Manager.",
  token: "Import the WhatsApp account again on ElevenLabs' WhatsApp page.",
};

/** Whether booking confirmations are on for a clinic: WhatsApp connected, set up, and not switched off. */
export function confirmationsActive(tenant: Pick<Tenant, "channels" | "integrations">): boolean {
  const w = tenant.integrations.whatsapp;
  return tenant.channels.whatsapp === "connected" && w?.confirmations !== false && Boolean(w?.phoneNumberId && w.confirmTemplate);
}

/** What the booking screens offer: whether to send a confirmation, and in which languages the clinic has a template. */
export const confirmationOptions = (tenant: Pick<Tenant, "channels" | "integrations">) => {
  const w = tenant.integrations.whatsapp;
  return { active: confirmationsActive(tenant), languages: templateLanguages(w), main: mainLanguage(w) };
};

/** Why the last "send a test" failed is kept on the server and shown for a few minutes, so the page never shows words that came in through its address. */
export const testFailKey = (tenantId: string) => `whatsapp.test.${tenantId}`;
export function testFailToShow(saved: unknown, now = Date.now()): string | null {
  if (!saved || typeof saved !== "object") return null;
  const { detail, at } = saved as { detail?: unknown; at?: unknown };
  if (typeof detail !== "string" || !detail.trim() || typeof at !== "string") return null;
  const age = now - Date.parse(at);
  return Number.isFinite(age) && age >= 0 && age <= 10 * 60_000 ? detail.slice(0, 300) : null;
}
