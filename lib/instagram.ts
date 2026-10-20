import { createHmac, timingSafeEqual } from "node:crypto";
import { agentVariables } from "./agent-context";
import { verifySignature } from "./elevenlabs";
import type { ElevenLabsApi } from "./elevenlabs-api";
import type { Data } from "./data/demo";
import type { Tenant } from "./types";

/** Meta signs every webhook with the app secret: `X-Hub-Signature-256: sha256=<hex hmac of the raw body>`. */
export function verifyMetaSignature(raw: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=") || !appSecret) return false;
  const a = Buffer.from(header.slice(7), "hex");
  const b = createHmac("sha256", appSecret).update(raw).digest();
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface IncomingDm {
  /** The business's Instagram account id (who received the message). */
  accountId: string;
  /** The person who wrote (Instagram-scoped id). */
  senderId: string;
  mid: string;
  text?: string;
  audioUrl?: string;
  /** Something we cannot read: an image, a sticker, a shared post. */
  unsupported?: boolean;
}

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Pulls the messages people sent out of a Meta webhook. Our own replies (echoes) and non-message events are dropped. */
export function parseMetaPayload(body: J): IncomingDm[] {
  if (body?.object !== "instagram" || !Array.isArray(body.entry)) return [];
  const out: IncomingDm[] = [];
  for (const entry of body.entry) {
    for (const ev of Array.isArray(entry?.messaging) ? entry.messaging : []) {
      const m = ev?.message;
      const senderId = String(ev?.sender?.id ?? ""), accountId = String(entry?.id ?? ev?.recipient?.id ?? "");
      if (!m || m.is_echo || !senderId || !accountId || senderId === accountId || !m.mid) continue;
      const audio = (Array.isArray(m.attachments) ? m.attachments : []).find((a: J) => a?.type === "audio" && typeof a?.payload?.url === "string");
      const text = typeof m.text === "string" && m.text.trim() ? m.text.trim() : undefined;
      out.push({ accountId, senderId, mid: String(m.mid), text, audioUrl: text ? undefined : audio?.payload.url, unsupported: !text && !audio });
    }
  }
  return out;
}

/** Instagram limits a message to 1000 characters; split on paragraph or sentence breaks where possible. */
export function chunkText(text: string, max = 950): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = Math.max(rest.lastIndexOf("\n", max), rest.lastIndexOf(". ", max) + 1, rest.lastIndexOf("؟ ", max) + 1);
    if (cut < max / 2) cut = rest.lastIndexOf(" ", max);
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Only Meta's own media hosts: a voice note's address comes from outside, so it is never fetched blindly. */
export function isMetaMediaUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === "https:" && /(^|\.)(fbcdn\.net|cdninstagram\.com|fbsbx\.com|facebook\.com|instagram\.com)$/.test(url.hostname);
  } catch { return false; }
}

const SESSION_HOURS = 12;
const MAX_AUDIO = 10_000_000;

const UNSUPPORTED = "Sorry, I can read text and voice notes only. Please type your message. | عذراً، أستطيع قراءة الرسائل النصية والصوتية فقط. يرجى كتابة رسالتك.";
const PAUSED = "The assistant is not available right now. Please contact the clinic directly. | المساعد غير متاح حالياً. يرجى التواصل مع العيادة مباشرة.";
const TROUBLE = "Sorry, something went wrong on our side. Please try again in a moment, or contact the clinic directly. | عذراً، حدث خلل من جهتنا. يرجى المحاولة بعد قليل أو التواصل مع العيادة مباشرة.";

export interface BridgeDeps {
  data: Pick<Data, "listTenants" | "getWallet" | "getSecrets" | "getChatSession" | "findChatSession" | "saveChatSession" | "deleteChatSession" | "getTenant" | "audit" | "addAlert">;
  api: ElevenLabsApi | null;
  fetch?: typeof fetch;
  graphBase?: string;
  now?: () => Date;
}
const gb = (d: BridgeDeps) => d.graphBase ?? process.env.META_GRAPH_BASE ?? "https://graph.instagram.com/v21.0";

/** Sends a message to a person on Instagram. Long answers go out as several messages. */
export async function sendInstagram(d: BridgeDeps, token: string, accountId: string, recipientId: string, text: string): Promise<void> {
  const f = d.fetch ?? fetch;
  for (const part of chunkText(text)) {
    const res = await f(`${gb(d)}/${encodeURIComponent(accountId)}/messages`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ recipient: { id: recipientId }, message: { text: part } }),
    });
    if (!res.ok) throw new Error(`Instagram ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

async function tenantForAccount(d: BridgeDeps, accountId: string): Promise<Tenant | undefined> {
  return (await d.data.listTenants()).find((t) => t.integrations.instagram?.accountId === accountId);
}

async function voiceNoteText(d: BridgeDeps, url: string): Promise<string | null> {
  if (!d.api || !isMetaMediaUrl(url)) return null;
  const res = await (d.fetch ?? fetch)(url);
  if (!res.ok) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_AUDIO) return null;
  const { text } = await d.api.transcribe(bytes, "voice-note.mp4", res.headers.get("content-type") ?? "audio/mp4");
  return text.trim() || null;
}

/** A person wrote to the clinic's Instagram: pass it to the ElevenLabs agent. The answer comes back through `handleReply`. */
export async function handleInbound(d: BridgeDeps, dm: IncomingDm): Promise<"forwarded" | "ignored" | "answered_directly"> {
  const tenant = await tenantForAccount(d, dm.accountId);
  const ig = tenant?.integrations.instagram;
  if (!tenant || tenant.channels.instagram !== "connected" || !ig?.inboundUrl) return "ignored";
  const secrets = await d.data.getSecrets(tenant.id);
  if (!secrets.instagramToken || !secrets.instagramInboundSecret) return "ignored";
  const say = (text: string) => sendInstagram(d, secrets.instagramToken!, dm.accountId, dm.senderId, text);
  const wallet = await d.data.getWallet(tenant.id);
  if (tenant.status === "suspended" || (wallet.balance <= 0 && tenant.zeroBalancePolicy === "pause")) { await say(PAUSED); return "answered_directly"; }
  if (dm.unsupported) { await say(UNSUPPORTED); return "answered_directly"; }
  try {
    const text = dm.text ?? (dm.audioUrl ? await voiceNoteText(d, dm.audioUrl) : null);
    if (!text) { await say(UNSUPPORTED); return "answered_directly"; }
    const now = (d.now ?? (() => new Date()))();
    const prior = await d.data.getChatSession(tenant.id, "instagram", dm.senderId);
    const continuing = prior && now.getTime() - Date.parse(prior.lastAt) < SESSION_HOURS * 3_600_000 ? prior.conversationId : undefined;
    const res = await (d.fetch ?? fetch)(ig.inboundUrl, {
      method: "POST", headers: { "X-Webhook-Secret": secrets.instagramInboundSecret, "content-type": "application/json" },
      body: JSON.stringify({
        data: { type: "user_message", text, user_identifier: dm.senderId },
        user_message_id: dm.mid,
        ...(continuing ? { conversation_id: continuing } : {}),
        dynamic_variables: agentVariables(tenant, now, { channel: "instagram" }),
      }),
    });
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const { conversation_id } = (await res.json()) as { conversation_id?: string };
    if (conversation_id) await d.data.saveChatSession({ tenantId: tenant.id, channel: "instagram", externalId: dm.senderId, conversationId: conversation_id, lastAt: now.toISOString() });
    return "forwarded";
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    await d.data.audit("instagram", `Instagram message could not be passed to the agent: ${msg.slice(0, 160)}`, tenant.id);
    await d.data.addAlert(tenant.id, "error", `An Instagram message could not be answered (${msg.slice(0, 120)}). Check the custom channel settings.`);
    await say(TROUBLE).catch(() => undefined);
    return "ignored";
  }
}

/**
 * ElevenLabs posts the agent's answer here (one address per client: /api/webhooks/instagram/reply/<slug>).
 * Checks the signature with that client's own signing secret, then sends the answer to the person on Instagram.
 */
export async function handleReply(d: BridgeDeps, slug: string, raw: string, signatureHeader: string | null): Promise<{ status: number; body: Record<string, unknown> }> {
  const tenant = (await d.data.listTenants()).find((t) => t.slug === slug);
  if (!tenant) return { status: 404, body: { error: "unknown client" } };
  const secrets = await d.data.getSecrets(tenant.id);
  if (!secrets.instagramReplySecret || !verifySignature(raw, signatureHeader, secrets.instagramReplySecret)) return { status: 401, body: { error: "invalid signature" } };
  let body: J;
  try { body = JSON.parse(raw); } catch { return { status: 400, body: { error: "invalid json" } }; }
  const conversationId = String(body.conversation_id ?? "");
  const session = await d.data.findChatSession(conversationId);
  const accountId = tenant.integrations.instagram?.accountId;
  if (!session || session.tenantId !== tenant.id || !accountId || !secrets.instagramToken) return { status: 200, body: { ok: true, ignored: true } };

  const events: J[] = Array.isArray(body.data) ? body.data : [];
  const answer = events.filter((e) => e?.type === "agent_response" && typeof e?.event?.agent_response === "string").map((e) => String(e.event.agent_response).trim()).filter(Boolean).join("\n\n");
  const ended = events.some((e) => e?.type === "agent_tool_response" && e?.event?.tool_name === "end_call" && e?.event?.status === "success");
  try {
    if (body.status === "failed" || (!answer && body.status !== "completed")) {
      await d.data.audit("instagram", `ElevenLabs reported a failed Instagram turn: ${String(body.error ?? "").slice(0, 160)}`, tenant.id);
      await sendInstagram(d, secrets.instagramToken, accountId, session.externalId, TROUBLE);
    } else if (answer) await sendInstagram(d, secrets.instagramToken, accountId, session.externalId, answer);
    if (ended) await d.data.deleteChatSession(conversationId);
    else await d.data.saveChatSession({ ...session, lastAt: (d.now ?? (() => new Date()))().toISOString() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    await d.data.audit("instagram", `Instagram reply could not be sent: ${msg.slice(0, 160)}`, tenant.id);
    await d.data.addAlert(tenant.id, "error", `An Instagram reply could not be sent (${msg.slice(0, 120)}). The access token may have expired: reconnect it in Channels.`);
  }
  return { status: 200, body: { ok: true } };
}
