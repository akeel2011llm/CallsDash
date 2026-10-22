import { NextResponse } from "next/server";
import { parsePostCall, verifySignature } from "@/lib/elevenlabs";
import { findTenantByAgent, getAgent, getSetting, recordConversation } from "@/lib/data";
import { conversationCostUsd, ratesFor } from "@/lib/costing";
import { FEES_KEY, MODELS_KEY } from "@/lib/pricing";

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
  const tenant = await findTenantByAgent(parsed.agentId);
  if (!tenant) return NextResponse.json({ error: "unknown agent" }, { status: 404 });
  // what it cost us: ElevenLabs' fee plus the share of the AI model this client's assistant uses, the same sums as the Assistant studio
  // (a failure here must never lose the conversation: without a worked-out cost it is recorded at the flat estimate)
  const costUsd = await Promise.all([getAgent(tenant.id), getSetting(FEES_KEY), getSetting(MODELS_KEY)])
    .then(([agent, fees, models]) => conversationCostUsd(parsed.conversation, ratesFor(agent, fees, models)))
    .catch(() => undefined);
  const res = await recordConversation(tenant.id, { ...parsed.conversation, costUsd });
  return NextResponse.json({ ok: true, duplicate: res.duplicate, credits: res.conversation.creditsCharged });
}
