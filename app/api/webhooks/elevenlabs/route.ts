import { NextResponse } from "next/server";
import { parsePostCall, unansweredConfirmation, verifySignature } from "@/lib/elevenlabs";
import { findTenantByAgent, getAgent, getData, getSetting, recordConversation } from "@/lib/data";
import { conversationCostUsd, ratesFor } from "@/lib/costing";
import { FEES_KEY, pricesKey } from "@/lib/pricing";
import { recordVisit } from "@/lib/customers";

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
  if (unansweredConfirmation(parsed.conversation)) return NextResponse.json({ ok: true, ignored: "confirmation without a reply" });
  const tenant = await findTenantByAgent(parsed.agentId);
  if (!tenant) return NextResponse.json({ error: "unknown agent" }, { status: 404 });
  // what it cost us: ElevenLabs' fee plus the share of the AI model this client's assistant uses, the same sums as the Assistant studio
  // (a failure here must never lose the conversation: without a worked-out cost it is recorded at the flat estimate)
  const costUsd = await Promise.all([getAgent(tenant.id), getSetting(FEES_KEY), getSetting(pricesKey(tenant.id))])
    .then(([agent, fees, prices]) => conversationCostUsd(parsed.conversation, ratesFor(agent, fees, prices)))
    .catch(() => undefined);
  const res = await recordConversation(tenant.id, { ...parsed.conversation, costUsd });
  // the customer's record gets this conversation (a failure here must never lose or fail the conversation that is already stored)
  if (!res.duplicate) {
    const c = parsed.conversation;
    await recordVisit(await getData(), tenant.id, {
      conversationId: parsed.externalId, phone: parsed.callerPhone, channel: c.channel, language: c.language, summary: c.summary || c.transcript.find((l) => l.role === "patient")?.text || "", at: c.startedAt,
    }).catch((e) => console.error("could not save the customer's conversation", e));
  }
  return NextResponse.json({ ok: true, duplicate: res.duplicate, credits: res.conversation.creditsCharged });
}
