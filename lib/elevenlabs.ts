import { createHmac, timingSafeEqual } from "node:crypto";
import type { Channel, Conversation, Locale, Outcome, TranscriptLine } from "./types";

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
  conversation: Omit<Conversation, "id" | "tenantId" | "creditsCharged" | "costUsd">;
}

const hasArabic = (s: string) => /[؀-ۿ]/.test(s);

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

  const language: Locale = String(meta.main_language ?? "").startsWith("ar") || hasArabic(transcript.map((t) => t.text).join(" ")) ? "ar" : "en";
  const startedSec = Number(meta.start_time_unix_secs);
  return {
    agentId,
    externalId,
    conversation: {
      channel, mode, language, outcome, transcript,
      startedAt: new Date((Number.isFinite(startedSec) && startedSec > 0 ? startedSec : Date.now() / 1000) * 1000).toISOString(),
      durationSec: Math.max(0, Math.round(Number(meta.call_duration_secs) || 0)),
      messages: mode === "text" ? transcript.length : 0,
      summary: String(d.analysis?.transcript_summary ?? "").slice(0, 1000),
      sentiment: "neutral",
      elevenLabsConversationId: externalId,
    },
  };
}
