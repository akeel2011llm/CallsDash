import { createHmac, timingSafeEqual } from "node:crypto";
import type { Channel, FlagKind, Locale, NewConversation, Outcome, TranscriptLine } from "./types";

const TOLERANCE_SECONDS = 30 * 60;

/** Verifies the `ElevenLabs-Signature` header: `t=<unix>,v0=<hex hmac-sha256 of "<t>.<raw body>">`. */
export function verifySignature(rawBody: string, header: string | null, secret: string, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  const t = Number(parts.t);
  const sig = parts.v0;
  if (!Number.isFinite(t) || !sig || Math.abs(nowSec - t) > TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", secret).update(`${parts.t}.${rawBody}`).digest("hex");
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface ParsedCall {
  agentId: string;
  externalId: string;
  conversation: NewConversation;
  /** The customer's phone number when the payload carries one (a phone call or WhatsApp chat), as ElevenLabs wrote it. */
  callerPhone?: string;
}

const hasArabic = (s: string) => /[؀-ۿ]/.test(s);

/**
 * A WhatsApp conversation the patient never replied to: it holds only the confirmation template CallsDash sent. That is not a
 * conversation with the assistant, so it is neither listed nor charged.
 */
export const unansweredConfirmation = (c: Pick<NewConversation, "channel" | "transcript">) =>
  c.channel === "whatsapp" && c.transcript.length > 0 && !c.transcript.some((l) => l.role === "patient");

/**
 * Maps an ElevenLabs `post_call_transcription` webhook payload to a CallsDash conversation.
 * Field names follow the ElevenLabs Agents webhook docs; confirm against a real payload on the first live call.
 */
export function parsePostCall(body: Json): ParsedCall | null {
  if (body?.type !== "post_call_transcription") return null;
  const d: Json = body.data ?? {};
  const agentId = String(d.agent_id ?? "");
  const externalId = String(d.conversation_id ?? "");
  if (!agentId || !externalId) return null;

  const transcript: TranscriptLine[] = (Array.isArray(d.transcript) ? d.transcript : [])
    .filter((l: Json) => typeof l?.message === "string" && l.message.trim())
    .map((l: Json) => ({ role: l.role === "agent" ? "agent" : "patient", text: String(l.message), atSec: Math.round(Number(l.time_in_call_secs) || 0) }));

  const meta: Json = d.metadata ?? {};
  const dyn: Json = d.conversation_initiation_client_data?.dynamic_variables ?? {};
  const rawChannel = String(dyn.channel ?? meta.channel ?? (meta.phone_call ? "phone" : "website")).toLowerCase();
  const channel: Channel = (["website", "whatsapp", "instagram", "phone"] as const).find((c) => c === rawChannel) ?? "website";
  const mode = d.has_audio === true || channel === "phone" ? "voice" : "text";

  const collected = d.analysis?.data_collection_results?.outcome?.value;
  const outcome: Outcome =
    transcript.length === 0 ? "abandoned"
    : (["booked", "answered", "handed_off", "abandoned"] as const).find((o) => o === collected) ?? "answered";

  // ElevenLabs reads each conversation after it ends (see DATA_COLLECTION in lib/agent-extras.ts)
  const result = (id: string): unknown => d.analysis?.data_collection_results?.[id]?.value;
  const intent = String(result("intent") ?? "");
  const aiFlags = ([
    intent === "emergency" || result("urgent") === true ? "emergency" : null,
    intent === "complaint" ? "complaint" : null,
    intent === "lead" ? "lead" : null,
  ].filter(Boolean)) as FlagKind[];
  const sentiment = (["positive", "neutral", "negative"] as const).find((v) => v === result("caller_sentiment")) ?? "neutral";

  const language: Locale = String(meta.main_language ?? "").startsWith("ar") || hasArabic(transcript.map((t) => t.text).join(" ")) ? "ar" : "en";
  const startedSec = Number(meta.start_time_unix_secs);
  // the number our own start-of-conversation webhook was given (lib/agent-context.ts), else the ones ElevenLabs records itself
  const callerPhone = [dyn.caller_phone, dyn.system__caller_id, meta.phone_call?.external_number, meta.whatsapp?.whatsapp_user_id]
    .map((v) => String(v ?? "").trim()).find((v) => v.replace(/\D/g, "").length >= 8);
  return {
    agentId,
    externalId,
    ...(callerPhone ? { callerPhone } : {}),
    conversation: {
      channel, mode, language, outcome, transcript,
      startedAt: new Date((Number.isFinite(startedSec) && startedSec > 0 ? startedSec : Date.now() / 1000) * 1000).toISOString(),
      durationSec: Math.max(0, Math.round(Number(meta.call_duration_secs) || 0)),
      messages: mode === "text" ? transcript.length : 0,
      summary: String(d.analysis?.transcript_summary ?? "").slice(0, 1000),
      sentiment,
      elevenLabsConversationId: externalId,
      ...(aiFlags.length ? { aiFlags } : {}),
    },
  };
}
