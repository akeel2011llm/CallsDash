import { describeSlot } from "./availability";
import type { ElevenLabsApi } from "./elevenlabs-api";
import type { Data } from "./data/demo";

/**
 * WhatsApp ids are digits with the country code, no plus or spaces. A bare 8-digit number is a Bahrain number.
 * Returns "" when it cannot be a phone number.
 */
export function whatsappUserId(phone: string): string {
  let d = phone.replace(/\D/g, "").replace(/^00/, "");
  if (d.length === 8) d = `973${d}`;
  return d.length >= 9 && d.length <= 15 ? d : "";
}

/** Wording to create once in WhatsApp Manager (Meta approves it). The variable names must match `confirmationParams`. */
export const CONFIRMATION_TEMPLATE = {
  name: "booking_confirmation",
  en: "Hello {{name}}, your appointment at {{clinic}} with {{doctor}} is confirmed for {{time}}. Reply here if you need to change or cancel it.",
  ar: "مرحباً {{name}}، تم تأكيد موعدك في {{clinic}} مع {{doctor}} يوم {{time}}. للتعديل أو الإلغاء يمكنك الرد على هذه الرسالة.",
};

export const confirmationParams = (p: { name: string; clinic: string; doctor: string; time: string }) => [{
  type: "body" as const,
  parameters: (["name", "clinic", "doctor", "time"] as const).map((k) => ({ type: "text" as const, parameter_name: k, text: p[k] })),
}];

export type ConfirmationResult = { status: "sent"; conversationId?: string } | { status: "skipped"; reason: "channel_off" | "not_configured" | "bad_phone" | "no_agent" } | { status: "failed"; error: string };

/**
 * Sends the booking confirmation template to the patient's WhatsApp. Never throws: a failed confirmation must not undo a booking,
 * so the outcome is returned for the caller to log.
 */
export async function sendBookingConfirmation(
  d: { api: ElevenLabsApi; data: Pick<Data, "getTenant" | "getAgent"> },
  tenantId: string,
  b: { patientName: string; patientPhone: string; doctorName: string; startsAt: string },
): Promise<ConfirmationResult> {
  const tenant = await d.data.getTenant(tenantId);
  const w = tenant?.integrations.whatsapp;
  if (!tenant || tenant.channels.whatsapp !== "connected") return { status: "skipped", reason: "channel_off" };
  if (!w?.phoneNumberId || !w.confirmTemplate) return { status: "skipped", reason: "not_configured" };
  const userId = whatsappUserId(b.patientPhone);
  if (!userId) return { status: "skipped", reason: "bad_phone" };
  const agentId = (await d.data.getAgent(tenantId)).elevenLabsAgentId;
  if (!agentId) return { status: "skipped", reason: "no_agent" };
  const lang = w.confirmTemplateLang === "ar" ? "ar" : "en";
  try {
    const r = await d.api.sendWhatsappTemplate({
      phoneNumberId: w.phoneNumberId, userId, templateName: w.confirmTemplate, languageCode: lang, agentId,
      params: confirmationParams({
        name: b.patientName, clinic: lang === "ar" ? tenant.branding.displayNameAr || tenant.name : tenant.branding.displayName || tenant.name,
        doctor: b.doctorName, time: describeSlot(b.startsAt, lang),
      }),
      dynamicVariables: { channel: "whatsapp", caller_phone: `+${userId}` },
    });
    return { status: "sent", conversationId: r.conversation_id };
  } catch (e) {
    return { status: "failed", error: e instanceof Error ? e.message : "unknown error" };
  }
}
