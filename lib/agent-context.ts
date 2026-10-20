import { LOCAL_OFFSET_MIN, describeSlot, isOpenAt, nextOpening } from "./availability";
import type { Tenant } from "./types";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * What the agent needs to know that changes from conversation to conversation. They are ElevenLabs "dynamic variables":
 * the agent prompt refers to them as {{today}} and so on, and every conversation start fills them in.
 */
export const VARIABLE_NAMES = ["today", "open_now", "hours_today", "next_opening", "caller_phone", "channel"] as const;

export function agentVariables(tenant: Pick<Tenant, "openingHours">, now: Date, o: { channel: string; callerPhone?: string }): Record<(typeof VARIABLE_NAMES)[number], string> {
  const ms = now.getTime();
  const local = new Date(ms + LOCAL_OFFSET_MIN * 60_000);
  const day = local.getUTCDay();
  const open = isOpenAt(tenant.openingHours, ms);
  const today = tenant.openingHours[String(day)] ?? [];
  const phone = (o.callerPhone ?? "").replace(/[^\d+]/g, "");
  return {
    today: `${WEEKDAYS[day]} ${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]} ${local.getUTCFullYear()} (${local.toISOString().slice(0, 10)}), Bahrain time`,
    open_now: open ? "yes" : "no",
    hours_today: today.length ? today.map(([a, b]) => `${a}-${b}`).join(", ") : "closed",
    next_opening: open ? "" : ((n) => (n ? describeSlot(n, "en") : ""))(nextOpening(tenant.openingHours, ms)),
    caller_phone: phone ? (phone.startsWith("+") ? phone : `+${phone}`) : "",
    channel: o.channel,
  };
}

/** Placeholder values the agent is created with, so a missing variable never breaks a conversation. */
export const variablePlaceholders = (): Record<string, string> =>
  ({ today: "", open_now: "yes", hours_today: "", next_opening: "", caller_phone: "", channel: "website" });

export interface InitBody { caller_id?: string; agent_id?: string; called_number?: string; call_sid?: string; conversation_id?: string }

const PAUSED_EN = "The assistant is not available right now. Please contact the clinic directly. Thank you.";
const PAUSED_AR = "المساعد غير متاح حالياً. يرجى التواصل مع العيادة مباشرة. شكراً لك.";

/**
 * The answer to ElevenLabs' "conversation initiation" webhook, sent before a call or WhatsApp chat starts.
 * When the client has no credits left and is set to pause (or is suspended), the agent only says so and ends the call.
 */
export function initiationResponse(p: { tenant: Tenant; balance: number; body: InitBody; now?: Date }) {
  const { tenant, body } = p;
  const channel = body.call_sid ? "phone" : "whatsapp";
  const vars = agentVariables(tenant, p.now ?? new Date(), { channel, callerPhone: body.caller_id });
  const paused = tenant.status === "suspended" || (p.balance <= 0 && tenant.zeroBalancePolicy === "pause");
  return {
    type: "conversation_initiation_client_data" as const,
    dynamic_variables: vars,
    ...(paused ? {
      conversation_config_override: {
        agent: {
          first_message: `${PAUSED_EN} ${PAUSED_AR}`,
          prompt: { prompt: "The service is paused. Say the first message once, do not help with anything else, then end the call." },
        },
      },
    } : {}),
  };
}
