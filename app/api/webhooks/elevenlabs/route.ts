import { NextResponse } from "next/server";
import { parsePostCall, verifySignature } from "@/lib/elevenlabs";
import { findTenantByAgent, recordConversation } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "webhook secret not configured" }, { status: 503 });
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("elevenlabs-signature"), secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = parsePostCall(body as Record<string, unknown>);
  if (!parsed) return NextResponse.json({ ok: true, ignored: true }); // other event types are acknowledged and dropped
  const tenant = findTenantByAgent(parsed.agentId);
  if (!tenant) return NextResponse.json({ error: "unknown agent" }, { status: 404 });
  const res = recordConversation(tenant.id, parsed.conversation);
  return NextResponse.json({ ok: true, duplicate: res.duplicate, credits: res.conversation.creditsCharged });
}
