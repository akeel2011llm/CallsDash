/**
 * Phone line (step 8 of the any-business plan): a Twilio number connected to the client's ElevenLabs assistant, so people can
 * call it and the admin can place a test call.
 *
 * The Twilio SID and token are sent straight to ElevenLabs when the number is connected and are NEVER stored by CallsDash.
 * What CallsDash keeps is only the ElevenLabs phone number id (`Integrations.phone.elevenLabsId`).
 * Request shapes from ElevenLabs' JavaScript SDK 2.75.0 types; not yet tried against the real service from the build environment.
 */
import { elevenLabsRequester } from "./elevenlabs-api";

type FetchLike = typeof fetch;
type Json = Record<string, unknown>;

export interface PhoneLine {
  id: string;
  number: string;
  label: string;
  inbound: boolean;
  outbound: boolean;
  agentId: string;
  agentName: string;
}
export interface ConnectInput { number: string; label: string; sid: string; token: string }
export interface CallResult { ok: boolean; message: string; conversationId: string }

const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");
const safe = (id: string) => /^[\w-]{1,128}$/.test(id);

/** A number in international form: "+" and 8 to 15 digits. Spaces, dashes and brackets are dropped; "00" becomes "+". Null if it is not one. */
export function cleanPhone(raw: string): string | null {
  let s = raw.trim().replace(/[\s\-().]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}

export function mapLine(raw: unknown): PhoneLine | null {
  const p = obj(raw);
  const id = str(p.phone_number_id);
  if (!id) return null;
  const a = obj(p.assigned_agent);
  return { id, number: str(p.phone_number), label: str(p.label), inbound: p.supports_inbound !== false, outbound: p.supports_outbound !== false, agentId: str(a.agent_id), agentName: str(a.agent_name) };
}

/** The Twilio form: a SID (starts AC, or SK for an API key), a token, and a number. Returns the field that is wrong. */
export function connectFromForm(get: (k: string) => string): { ok: true; value: ConnectInput } | { ok: false; error: "number" | "sid" | "token" } {
  const number = cleanPhone(get("number"));
  if (!number) return { ok: false, error: "number" };
  const sid = get("sid").trim();
  if (!/^(AC|SK)[0-9a-fA-F]{32}$/.test(sid)) return { ok: false, error: "sid" };
  const token = get("token").trim();
  if (token.length < 16 || token.length > 128 || /\s/.test(token)) return { ok: false, error: "token" };
  return { ok: true, value: { number, label: get("label").replace(/\s+/g, " ").trim().slice(0, 60) || number, sid, token } };
}

export interface PhoneApi {
  list(): Promise<PhoneLine[]>;
  read(id: string): Promise<PhoneLine | null>;
  /** Connects a Twilio number. Returns the new number id. */
  connect(input: ConnectInput, agentId: string): Promise<string>;
  assign(id: string, agentId: string | null): Promise<void>;
  remove(id: string): Promise<void>;
  /** The assistant calls `to` from the connected number. */
  call(agentId: string, lineId: string, to: string, extra?: { firstName?: string }): Promise<CallResult>;
}

export function createPhoneApi(apiKey: string, fetchImpl: FetchLike = fetch): PhoneApi {
  const call = elevenLabsRequester(apiKey, fetchImpl);
  const one = (id: string) => {
    if (!safe(id)) throw new Error("bad id");
    return `/v1/convai/phone-numbers/${encodeURIComponent(id)}`;
  };
  return {
    async list() {
      const r = await call("GET", "/v1/convai/phone-numbers", undefined, { timeoutMs: 10_000 });
      const rows = Array.isArray(r) ? r : Array.isArray(obj(r).phone_numbers) ? (obj(r).phone_numbers as unknown[]) : [];
      return rows.map(mapLine).filter((x): x is PhoneLine => !!x);
    },
    async read(id) {
      return mapLine(await call("GET", one(id), undefined, { timeoutMs: 10_000 }));
    },
    async connect(input, agentId) {
      if (agentId && !safe(agentId)) throw new Error("bad id");
      const r = obj(await call("POST", "/v1/convai/phone-numbers", {
        provider: "twilio", phone_number: input.number, label: input.label, sid: input.sid, token: input.token,
        supports_inbound: true, supports_outbound: true, ...(agentId ? { agent_id: agentId } : {}),
      }, { timeoutMs: 25_000 }));
      const id = str(r.phone_number_id);
      if (!id) throw new Error("ElevenLabs did not return a phone number id");
      return id;
    },
    async assign(id, agentId) {
      if (agentId && !safe(agentId)) throw new Error("bad id");
      await call("PATCH", one(id), { agent_id: agentId }, { timeoutMs: 15_000 });
    },
    async remove(id) {
      await call("DELETE", one(id), undefined, { timeoutMs: 15_000 });
    },
    async call(agentId, lineId, to, extra) {
      if (!safe(agentId) || !safe(lineId)) throw new Error("bad id");
      const r = obj(await call("POST", "/v1/convai/twilio/outbound-call", {
        agent_id: agentId, agent_phone_number_id: lineId, to_number: to,
        ...(extra?.firstName ? { conversation_initiation_client_data: { dynamic_variables: { customer_name: extra.firstName } } } : {}),
      }, { timeoutMs: 25_000 }));
      return { ok: r.success !== false, message: str(r.message), conversationId: str(r.conversation_id) };
    },
  };
}

export const phoneFromEnv = (): PhoneApi | null => (process.env.ELEVENLABS_API_KEY ? createPhoneApi(process.env.ELEVENLABS_API_KEY) : null);
export const phoneFailKey = (tenantId: string) => `phone.fail.${tenantId}`;

/** The Twilio number the first test is built around (set in the app by the admin; shown as the example in the guide). */
export const EXAMPLE_NUMBER = "+12769001901";
