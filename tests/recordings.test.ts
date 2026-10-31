import { describe, expect, it } from "vitest";
import { deleteRecordings, fetchRecording, recordingState, removedOn } from "@/lib/recordings";
import { createPgData, type Db, type Q } from "@/lib/data/pg";
import { makeDb } from "./helpers/pgdb";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-31T12:00:00Z");
const voice = { mode: "voice" as const, elevenLabsConversationId: "conv_1", startedAt: new Date(NOW - 10 * DAY).toISOString() };

describe("recording states", () => {
  it("plays a voice conversation ElevenLabs knows, inside the retention period", () => {
    expect(recordingState(voice, 90, NOW)).toBe("available");
    expect(recordingState({ ...voice, mode: "text" }, 90, NOW)).toBe("none");
    expect(recordingState({ ...voice, elevenLabsConversationId: undefined }, 90, NOW)).toBe("none");
    expect(recordingState({ ...voice, recordingDeletedAt: new Date(NOW).toISOString() }, 90, NOW)).toBe("deleted");
    expect(recordingState(voice, 7, NOW)).toBe("expired");
    expect(removedOn(voice, 30)).toBe(new Date(NOW + 20 * DAY).toISOString());
  });
});

describe("talking to ElevenLabs about recordings", () => {
  it("asks for the audio with the key, and refuses an odd id without asking", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fake = (async (url: string, init?: RequestInit) => { calls.push({ url, init }); return new Response("mp3", { status: 200 }); }) as unknown as typeof fetch;
    expect((await fetchRecording("k", "conv_1", fake)).status).toBe(200);
    expect(calls[0].url).toMatch(/\/v1\/convai\/conversations\/conv_1\/audio$/);
    expect((calls[0].init?.headers as Record<string, string>)["xi-api-key"]).toBe("k");
    expect((await fetchRecording("k", "../x", fake)).status).toBe(404);
    expect(calls).toHaveLength(1);
  });

  it("deletes each recording, counts one already gone as deleted, and reports failures", async () => {
    const seen: string[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      seen.push(`${init?.method} ${url.split("/v1/")[1]}`);
      return new Response("", { status: url.endsWith("gone") ? 404 : url.endsWith("broken") ? 500 : 200 });
    }) as unknown as typeof fetch;
    const r = await deleteRecordings("k", [
      { id: "a", elevenLabsConversationId: "ok" }, { id: "b", elevenLabsConversationId: "gone" },
      { id: "c", elevenLabsConversationId: "broken" }, { id: "d" },
    ], fake);
    expect(r).toEqual({ done: ["a", "b"], failed: 1 });
    expect(seen).toEqual(["DELETE convai/conversations/ok", "DELETE convai/conversations/gone", "DELETE convai/conversations/broken"]);
  });
});

describe("marking recordings deleted", () => {
  it("keeps the conversation and its transcript, once per recording", async () => {
    const pg = await makeDb();
    const q: Q = async (sql, params) => (await pg.query(sql, params as unknown[])).rows as never;
    const db: Db = { q, tx: (fn) => pg.transaction((tx) => fn(async (sql, params) => (await tx.query(sql, params as unknown[])).rows as never)) };
    const data = createPgData(db);
    const t = await data.createTenant({ name: "Rec Clinic", nameAr: "", color: "#112233", domain: "", planType: "package", actor: "x" });
    const { conversation } = await data.recordConversation(t.id, {
      channel: "phone", mode: "voice", language: "en", outcome: "answered", transcript: [{ role: "agent", text: "hello", atSec: 0 }],
      startedAt: new Date().toISOString(), durationSec: 60, messages: 0, summary: "s", sentiment: "neutral", elevenLabsConversationId: "conv_9",
    });
    expect(await data.markRecordingsDeleted(t.id, [conversation.id, "not-a-uuid"], "x")).toBe(1);
    expect(await data.markRecordingsDeleted(t.id, [conversation.id], "x")).toBe(0);
    const after = await data.getConversation(t.id, conversation.id);
    expect(after?.recordingDeletedAt).toBeTruthy();
    expect(after?.transcript[0].text).toBe("hello");
    expect(recordingState(after!, 90)).toBe("deleted");
  });
});
