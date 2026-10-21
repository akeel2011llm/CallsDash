import type { ElevenLabsApi } from "./elevenlabs-api";

export interface InspectedToolCall { name: string; asked: string; ok: boolean | null; answer: string }
export interface InspectedConversation {
  id: string;
  startedAt?: string;
  seconds?: number;
  status: string;
  /** What the person said first, to recognise the test. */
  opening: string;
  tools: InspectedToolCall[];
}

type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === "object" ? (v as J) : {});
const arr = (v: unknown): J[] => (Array.isArray(v) ? v.map(obj) : []);
const text = (v: unknown, n = 240) => (typeof v === "string" ? v : v === undefined || v === null ? "" : JSON.stringify(v)).replace(/\s+/g, " ").slice(0, n);

/**
 * Reads one ElevenLabs conversation into the tool calls the agent made and the answers it got. This is ElevenLabs'
 * side of the story: a call that never reached CallsDash (wrong address, refused, timed out) shows here as an error.
 */
export function inspectConversation(raw: J): InspectedConversation {
  const transcript = arr(raw.transcript);
  const calls: InspectedToolCall[] = [];
  const byId = new Map<string, InspectedToolCall>();
  for (const turn of transcript) {
    for (const c of arr(turn.tool_calls)) {
      const call: InspectedToolCall = { name: text(c.tool_name, 60), asked: text(c.params_as_json, 300), ok: null, answer: "" };
      calls.push(call);
      if (typeof c.request_id === "string") byId.set(c.request_id, call);
    }
    for (const r of arr(turn.tool_results)) {
      const call = (typeof r.request_id === "string" && byId.get(r.request_id)) || [...calls].reverse().find((c) => c.name === text(r.tool_name, 60) && c.ok === null);
      const answer = text(r.result_value ?? r.result, 400);
      const failed = r.is_error === true || /"ok"\s*:\s*false/.test(answer);
      if (call) { call.ok = !failed; call.answer = answer; }
      else calls.push({ name: text(r.tool_name, 60), asked: "", ok: !failed, answer });
    }
  }
  const meta = obj(raw.metadata);
  const start = Number(meta.start_time_unix_secs ?? raw.start_time_unix_secs);
  const firstUser = transcript.find((t) => t.role === "user" && typeof t.message === "string" && t.message.trim());
  return {
    id: text(raw.conversation_id, 80),
    startedAt: Number.isFinite(start) && start > 0 ? new Date(start * 1000).toISOString() : undefined,
    seconds: typeof meta.call_duration_secs === "number" ? meta.call_duration_secs : undefined,
    status: text(raw.status, 30),
    opening: text(firstUser?.message, 120),
    tools: calls,
  };
}

/** The agent's latest few conversations from ElevenLabs, with their tool calls. Never throws: the page shows the reason instead. */
export async function recentConversations(api: ElevenLabsApi, agentId: string, count = 4): Promise<{ items: InspectedConversation[]; error?: string }> {
  try {
    const list = arr((await api.listConversations(agentId, count)).conversations).slice(0, count);
    const items = await Promise.all(list.map(async (c) => {
      const id = String(c.conversation_id ?? "");
      try { return inspectConversation(await api.getConversation(id) as J); }
      catch { return { id, status: text(c.status, 30), opening: "", tools: [] } satisfies InspectedConversation; }
    }));
    return { items };
  } catch (e) {
    return { items: [], error: (e instanceof Error ? e.message : "unreachable").slice(0, 200) };
  }
}
