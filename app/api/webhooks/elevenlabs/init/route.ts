import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { initiationResponse, type InitBody } from "@/lib/agent-context";
import { findTenantByAgent, getWallet } from "@/lib/data";

export const dynamic = "force-dynamic";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * ElevenLabs asks this before a phone call or WhatsApp chat starts, and we answer with today's date, whether the clinic is open,
 * and the caller's number (or a "paused" message when the client has no credits left). Set it up once in ElevenLabs
 * (Agents > Settings > conversation initiation webhook); the agent sync fills it in per agent.
 * Auth: `Authorization: Bearer $ELEVENLABS_INIT_SECRET` (falls back to AGENT_TOOLS_SECRET).
 */
export async function POST(req: Request) {
  const secret = process.env.ELEVENLABS_INIT_SECRET || process.env.AGENT_TOOLS_SECRET;
  if (!secret) return NextResponse.json({ error: "secret not configured" }, { status: 503 });
  if (!same((req.headers.get("authorization") ?? "").replace(/^Bearer /, ""), secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: InitBody;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const tenant = await findTenantByAgent(String(body.agent_id ?? ""));
  if (!tenant) return NextResponse.json({ error: "unknown agent" }, { status: 404 });
  const wallet = await getWallet(tenant.id);
  return NextResponse.json(initiationResponse({ tenant, balance: wallet.balance, body }));
}
