import { timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { getData } from "@/lib/data";
import { elevenLabsFromEnv } from "@/lib/elevenlabs-api";
import { handleInbound, parseMetaPayload, verifyMetaSignature } from "@/lib/instagram";

export const dynamic = "force-dynamic";

/** Meta's one-time check when the webhook is added: echo `hub.challenge` if the verify token matches. */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const token = process.env.META_VERIFY_TOKEN ?? "";
  const given = p.get("hub.verify_token") ?? "";
  const ok = token.length > 0 && given.length === token.length && timingSafeEqual(Buffer.from(given), Buffer.from(token));
  if (p.get("hub.mode") === "subscribe" && ok) return new Response(p.get("hub.challenge") ?? "", { status: 200 });
  return new Response("forbidden", { status: 403 });
}

/**
 * Instagram direct messages arrive here (one webhook for every client's account; the account id says which client).
 * We answer 200 at once and do the work after, because Meta retries slow or failed deliveries.
 */
export async function POST(req: Request) {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) return NextResponse.json({ error: "META_APP_SECRET is not configured" }, { status: 503 });
  const raw = await req.text();
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), appSecret)) return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const messages = parseMetaPayload(body);
  if (messages.length) after(async () => {
    const deps = { data: await getData(), api: elevenLabsFromEnv() };
    for (const dm of messages) await handleInbound(deps, dm).catch((e) => console.error("instagram inbound failed", e));
  });
  return NextResponse.json({ ok: true });
}
