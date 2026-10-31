/**
 * Hold audio: the clip callers hear on a loop while they wait in the agent's queue (when every line is busy and the queue is on,
 * Assistant studio > Safety). ElevenLabs only takes it as an upload to its own endpoint; values sent with the agent are ignored.
 * The file passes through CallsDash to ElevenLabs and is not kept here.
 */
import { elevenLabsBase, ElevenLabsError } from "./elevenlabs-api";

type FetchLike = typeof fetch;

/** ElevenLabs takes up to 40 MB; a CallsDash upload passes through a Vercel function, which takes about 4.5 MB in one request. */
export const HOLD_AUDIO_MAX_BYTES = 4 * 1024 * 1024;

export type HoldAudioProblem = "missing" | "too_big" | "not_audio";

/** Whether the file can be sent: an MP3 or WAV under the size limit. */
export function checkHoldAudio(file: { name: string; size: number; type: string } | null): HoldAudioProblem | null {
  if (!file || !file.size) return "missing";
  if (file.size > HOLD_AUDIO_MAX_BYTES) return "too_big";
  const ext = file.name.toLowerCase().match(/\.(mp3|wav)$/)?.[1];
  const typeOk = /^audio\/(mpeg|mp3|wav|x-wav|wave|vnd\.wave)$/.test(file.type);
  return ext || typeOk ? null : "not_audio";
}

const safeAgent = (id: string) => /^[\w-]{1,128}$/.test(id);

/** Sends the clip to the agent, replacing any earlier one. */
export async function uploadHoldAudio(apiKey: string, agentId: string, file: Blob, name: string, fetchImpl: FetchLike = fetch): Promise<void> {
  if (!safeAgent(agentId)) throw new ElevenLabsError(400, "bad agent id");
  const body = new FormData();
  body.append("hold_audio_file", file, name.replace(/[^\w.() -]/g, "_").slice(0, 100) || "hold.mp3");
  const res = await fetchImpl(`${elevenLabsBase()}/v1/convai/agents/${encodeURIComponent(agentId)}/hold-audio`, {
    method: "POST", headers: { "xi-api-key": apiKey }, body, signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new ElevenLabsError(res.status, (await res.text()).slice(0, 300));
}

/** Removes the clip; callers hear ElevenLabs' default hold tone again. One that is already gone counts as removed. */
export async function deleteHoldAudio(apiKey: string, agentId: string, fetchImpl: FetchLike = fetch): Promise<void> {
  if (!safeAgent(agentId)) return;
  const res = await fetchImpl(`${elevenLabsBase()}/v1/convai/agents/${encodeURIComponent(agentId)}/hold-audio`, {
    method: "DELETE", headers: { "xi-api-key": apiKey }, signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok && res.status !== 404) throw new ElevenLabsError(res.status, (await res.text()).slice(0, 300));
}
