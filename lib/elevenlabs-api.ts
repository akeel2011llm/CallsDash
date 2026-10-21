/**
 * Thin client for the ElevenLabs Agents REST API. Only the calls CallsDash needs. Takes a `fetch` so tests can
 * check exactly what would be sent. Request shapes follow the public API reference; confirm against a real
 * account on the first sync (docs/channels.md lists what to check).
 */
export class ElevenLabsError extends Error {
  constructor(public status: number, public detail: string) { super(`ElevenLabs ${status}: ${detail}`); }
}

type Json = Record<string, unknown>;
type FetchLike = typeof fetch;

const BASE = "https://api.elevenlabs.io";

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
  /** The agent's latest conversations, newest first (ElevenLabs' own history, including ones CallsDash never heard about). */
  listConversations(agentId: string, pageSize: number): Promise<{ conversations?: Json[] }>;
  /** One conversation with its transcript, including each tool call and the answer it got. */
  getConversation(conversationId: string): Promise<Json>;
  /** Speech to text for a voice note. */
  transcribe(audio: Uint8Array, filename: string, mime: string): Promise<{ text: string; language?: string }>;
}

export function createElevenLabsApi(apiKey: string, fetchImpl: FetchLike = fetch): ElevenLabsApi {
  async function call<T>(method: string, path: string, body?: Json | FormData, timeoutMs?: number): Promise<T> {
    const isForm = body instanceof FormData;
    const res = await fetchImpl(`${BASE}${path}`, {
      method, ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
      headers: { "xi-api-key": apiKey, ...(body && !isForm ? { "content-type": "application/json" } : {}) },
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new ElevenLabsError(res.status, text.slice(0, 500));
    return (text ? JSON.parse(text) : {}) as T;
  }
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
    listConversations: (agentId, pageSize) =>
      call("GET", `/v1/convai/conversations?agent_id=${encodeURIComponent(agentId)}&page_size=${pageSize}`, undefined, 8000),
    getConversation: (id) => call("GET", `/v1/convai/conversations/${encodeURIComponent(id)}`, undefined, 8000),
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
