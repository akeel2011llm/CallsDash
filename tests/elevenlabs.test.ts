import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parsePostCall, verifySignature } from "@/lib/elevenlabs";

const secret = "whsec_test";
const sign = (body: string, t: number) => `t=${t},v0=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;

describe("verifySignature", () => {
  const body = '{"type":"post_call_transcription"}';
  const now = 1_800_000_000;
  it("accepts a valid, fresh signature", () => expect(verifySignature(body, sign(body, now), secret, now)).toBe(true));
  it("rejects a tampered body", () => expect(verifySignature(body + " ", sign(body, now), secret, now)).toBe(false));
  it("rejects a wrong secret", () => expect(verifySignature(body, sign(body, now), "other", now)).toBe(false));
  it("rejects a stale timestamp", () => expect(verifySignature(body, sign(body, now - 3600), secret, now)).toBe(false));
  it("rejects missing header or secret", () => {
    expect(verifySignature(body, null, secret, now)).toBe(false);
    expect(verifySignature(body, sign(body, now), "", now)).toBe(false);
  });
});

describe("parsePostCall", () => {
  const payload = {
    type: "post_call_transcription",
    data: {
      agent_id: "agent_1", conversation_id: "conv_1", has_audio: true,
      transcript: [
        { role: "agent", message: "مرحبا", time_in_call_secs: 0 },
        { role: "user", message: "أبي موعد", time_in_call_secs: 3 },
      ],
      metadata: { call_duration_secs: 95, start_time_unix_secs: 1_800_000_000 },
      analysis: { transcript_summary: "Booking request", data_collection_results: { outcome: { value: "booked" } } },
    },
  };
  it("maps a voice call", () => {
    const r = parsePostCall(payload)!;
    expect(r.agentId).toBe("agent_1");
    expect(r.conversation).toMatchObject({ mode: "voice", language: "ar", outcome: "booked", durationSec: 95, summary: "Booking request" });
  });
  it("ignores other event types and malformed payloads", () => {
    expect(parsePostCall({ type: "post_call_audio", data: {} })).toBeNull();
    expect(parsePostCall({ type: "post_call_transcription", data: {} })).toBeNull();
  });
  it("treats an empty transcript as abandoned", () => {
    const r = parsePostCall({ ...payload, data: { ...payload.data, transcript: [] } })!;
    expect(r.conversation.outcome).toBe("abandoned");
  });
});
