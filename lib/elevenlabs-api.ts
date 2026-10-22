/**
 * Thin client for the ElevenLabs Agents REST API. Only the calls CallsDash needs. Takes a `fetch` so tests can
 * check exactly what would be sent. Request shapes follow the public API reference; confirm against a real
 * account on the first sync (docs/channels.md lists what to check).
 */
export class ElevenLabsError extends Error {
  constructor(public status: number, public detail: string) { super(`ElevenLabs ${status}: ${detail}`); }
}

const lineOf = (d: unknown): string | null => {
  if (typeof d === "string") return d.trim() || null;
  if (!d || typeof d !== "object") return null;
  const o = d as { msg?: unknown; message?: unknown; status?: unknown; loc?: unknown };
  const text = [o.msg, o.message, o.status].find((v): v is string => typeof v === "string" && !!v.trim())?.trim();
  if (!text) return null;
  const where = Array.isArray(o.loc) ? o.loc.filter((p) => (typeof p === "string" && p !== "body") || typeof p === "number").join(".") : "";
  return where ? `${text} (${where})` : text;
};

/**
 * What ElevenLabs said, without the JSON around it, so an admin can read it: `ElevenLabs 422: {"detail":[{"loc":["body","a","b"],"msg":"Not allowed"}]}`
 * becomes `Not allowed (a.b)`. Text that is not JSON, or has no message to pick out, comes back as it was.
 */
export function plainDetail(message: string): string {
  let parsed: unknown;
  try { parsed = JSON.parse(message.replace(/^ElevenLabs \d{3}:\s*/, "").trim()); } catch { return message; }
  const detail = parsed && typeof parsed === "object" && !Array.isArray(parsed) && "detail" in parsed ? (parsed as { detail: unknown }).detail : parsed;
  const lines = (Array.isArray(detail) ? detail : [detail]).map(lineOf).filter((l): l is string => !!l);
  return lines.length ? lines.join("; ") : message;
}

type Json = Record<string, unknown>;
type FetchLike = typeof fetch;

/** ELEVENLABS_API_BASE exists only so tests can point the app at a local fake; in production it stays unset. */
export const elevenLabsBase = () => (process.env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io").replace(/\/+$/, "");

export interface WhatsappTemplateParams {
  type: "body" | "header" | "button";
  parameters: { type: "text"; parameter_name?: string; text: string }[];
}

export interface ElevenLabsApi {
  createAgent(body: Json): Promise<{ agent_id: string }>;
  updateAgent(agentId: string, body: Json): Promise<void>;
  createKnowledgeText(input: { name: string; text: string }): Promise<{ id: string }>;
  deleteKnowledge(id: string): Promise<void>;
  createWebhookTool(toolConfig: Json): Promise<{ id: string }>;
  updateTool(id: string, toolConfig: Json): Promise<void>;
  sendWhatsappTemplate(input: {
    phoneNumberId: string; userId: string; templateName: string; languageCode: string; params: WhatsappTemplateParams[];
    agentId: string; dynamicVariables?: Record<string, string>;
  }): Promise<{ conversation_id?: string }>;
  /** Speech to text for a voice note. */
  transcribe(audio: Uint8Array, filename: string, mime: string): Promise<{ text: string; language?: string }>;
}

/** One request to ElevenLabs with the key attached. Errors carry ElevenLabs' own message. `timeoutMs` stops a slow answer from holding up a page. */
export function elevenLabsRequester(apiKey: string, fetchImpl: FetchLike = fetch) {
  return async function call<T>(method: string, path: string, body?: Json | FormData, opts: { timeoutMs?: number } = {}): Promise<T> {
    const isForm = body instanceof FormData;
    const res = await fetchImpl(`${elevenLabsBase()}${path}`, {
      method,
      headers: { "xi-api-key": apiKey, ...(body && !isForm ? { "content-type": "application/json" } : {}) },
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
      ...(opts.timeoutMs ? { signal: AbortSignal.timeout(opts.timeoutMs) } : {}),
    });
    const text = await res.text();
    if (!res.ok) throw new ElevenLabsError(res.status, text.slice(0, 500));
    return (text ? JSON.parse(text) : {}) as T;
  };
}

export function createElevenLabsApi(apiKey: string, fetchImpl: FetchLike = fetch): ElevenLabsApi {
  const call = elevenLabsRequester(apiKey, fetchImpl);
  return {
    createAgent: (body) => call("POST", "/v1/convai/agents/create", body),
    updateAgent: async (id, body) => { await call("PATCH", `/v1/convai/agents/${encodeURIComponent(id)}`, body); },
    createKnowledgeText: (i) => call("POST", "/v1/convai/knowledge-base/text", { name: i.name, text: i.text }),
    deleteKnowledge: async (id) => { await call("DELETE", `/v1/convai/knowledge-base/${encodeURIComponent(id)}?force=true`); },
    createWebhookTool: (tool_config) => call("POST", "/v1/convai/tools", { tool_config }),
    updateTool: async (id, tool_config) => { await call("PATCH", `/v1/convai/tools/${encodeURIComponent(id)}`, { tool_config }); },
    sendWhatsappTemplate: (i) =>
      call("POST", "/v1/convai/whatsapp/outbound-message", {
        whatsapp_phone_number_id: i.phoneNumberId, whatsapp_user_id: i.userId, template_name: i.templateName,
        template_language_code: i.languageCode, template_params: i.params, agent_id: i.agentId,
        ...(i.dynamicVariables ? { conversation_initiation_client_data: { dynamic_variables: i.dynamicVariables } } : {}),
      }),
    transcribe: async (audio, filename, mime) => {
      const form = new FormData();
      form.set("model_id", "scribe_v1");
      form.set("file", new Blob([audio as BlobPart], { type: mime }), filename);
      return call("POST", "/v1/speech-to-text", form);
    },
  };
}

/** The client, or null when no API key is configured (pages then say what is missing). */
export const elevenLabsFromEnv = (): ElevenLabsApi | null =>
  process.env.ELEVENLABS_API_KEY ? createElevenLabsApi(process.env.ELEVENLABS_API_KEY) : null;
