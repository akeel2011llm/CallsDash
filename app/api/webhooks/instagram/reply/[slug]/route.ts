import { NextResponse } from "next/server";
import { getData } from "@/lib/data";
import { elevenLabsFromEnv } from "@/lib/elevenlabs-api";
import { handleReply } from "@/lib/instagram";

export const dynamic = "force-dynamic";

/**
 * ElevenLabs' "reply webhook" for a client's Instagram custom channel: paste
 * `https://<our address>/api/webhooks/instagram/reply/<client slug>` into the custom channel trigger.
 * The signature is checked with that client's own signing secret.
 */
export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const raw = await req.text();
  const r = await handleReply({ data: await getData(), api: elevenLabsFromEnv() }, slug, raw, req.headers.get("elevenlabs-signature"));
  return NextResponse.json(r.body, { status: r.status });
}
