/**
 * Voice recordings (step 3 of the any-business plan). ElevenLabs keeps the audio of every voice conversation for the client's
 * retention period (Business tab, sent to the agent as platform_settings.privacy.retention_days) and removes it afterwards.
 * CallsDash never stores audio: it plays and downloads it through /api/recordings/<id>, which fetches it from ElevenLabs with
 * the server's key, so the key never reaches a browser. Deleting a recording deletes the conversation's copy at ElevenLabs
 * (audio and their transcript); the transcript and summary kept in CallsDash stay.
 */
import { elevenLabsBase, ElevenLabsError } from "./elevenlabs-api";
import type { Conversation } from "./types";

type FetchLike = typeof fetch;

export type RecordingState = "available" | "deleted" | "expired" | "none";

/** Whether a conversation's recording can be played: a voice conversation ElevenLabs knows, not deleted, still inside the retention period. */
export function recordingState(c: Pick<Conversation, "mode" | "elevenLabsConversationId" | "recordingDeletedAt" | "startedAt">, retentionDays: number, nowMs = Date.now()): RecordingState {
  if (c.mode !== "voice" || !c.elevenLabsConversationId) return "none";
  if (c.recordingDeletedAt) return "deleted";
  if (nowMs - Date.parse(c.startedAt) > Math.max(1, retentionDays) * 86_400_000) return "expired";
  return "available";
}

/** The day ElevenLabs removes the recording on its own. */
export const removedOn = (c: Pick<Conversation, "startedAt">, retentionDays: number) =>
  new Date(Date.parse(c.startedAt) + Math.max(1, retentionDays) * 86_400_000).toISOString();

const safeId = (id: string) => /^[\w-]{1,128}$/.test(id);

/** The audio of one conversation from ElevenLabs, as their answer (status 404 when it is gone). */
export async function fetchRecording(apiKey: string, elevenLabsConversationId: string, fetchImpl: FetchLike = fetch): Promise<Response> {
  if (!safeId(elevenLabsConversationId)) return new Response("Not found", { status: 404 });
  return fetchImpl(`${elevenLabsBase()}/v1/convai/conversations/${encodeURIComponent(elevenLabsConversationId)}/audio`, {
    headers: { "xi-api-key": apiKey }, signal: AbortSignal.timeout(30_000),
  });
}

/** Deletes the conversation at ElevenLabs. One that is already gone counts as deleted. */
export async function deleteRecording(apiKey: string, elevenLabsConversationId: string, fetchImpl: FetchLike = fetch): Promise<void> {
  if (!safeId(elevenLabsConversationId)) return;
  const res = await fetchImpl(`${elevenLabsBase()}/v1/convai/conversations/${encodeURIComponent(elevenLabsConversationId)}`, {
    method: "DELETE", headers: { "xi-api-key": apiKey }, signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok && res.status !== 404) throw new ElevenLabsError(res.status, (await res.text()).slice(0, 300));
}

/** Deletes several recordings; returns the ids that were deleted (or already gone) and how many failed. */
export async function deleteRecordings(apiKey: string, convs: Pick<Conversation, "id" | "elevenLabsConversationId">[], fetchImpl: FetchLike = fetch) {
  const done: string[] = [];
  let failed = 0;
  for (const c of convs) {
    if (!c.elevenLabsConversationId) continue;
    try { await deleteRecording(apiKey, c.elevenLabsConversationId, fetchImpl); done.push(c.id); }
    catch { failed++; }
  }
  return { done, failed };
}
