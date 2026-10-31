import { getSession } from "@/lib/auth";
import { getConversation, getTenant } from "@/lib/data";
import { fetchRecording, recordingState } from "@/lib/recordings";
import { safeName } from "@/lib/data-hub";

export const dynamic = "force-dynamic";

/**
 * Plays or downloads (`download=1`) one conversation's recording, fetched from ElevenLabs with the server's key (lib/recordings.ts).
 * The client's own staff, or an admin naming the client with `t` (or viewing as it). Nothing is cached or kept here.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const s = await getSession();
  const notFound = () => new Response("Not found", { status: 404 });
  if (!s || s.mustChangePassword || !/^[\w-]{1,64}$/.test(id)) return notFound();
  const tenantId = s.role === "admin" ? url.searchParams.get("t") || s.viewAsTenantId : s.role === "client" ? s.tenantId : undefined;
  const tenant = tenantId && /^[A-Za-z0-9_-]{1,64}$/.test(tenantId) ? await getTenant(tenantId) : undefined;
  if (!tenant) return notFound();
  const c = await getConversation(tenant.id, id);
  if (!c || recordingState(c, tenant.retentionDays) !== "available") return notFound();
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return new Response("ElevenLabs is not connected", { status: 503 });
  let res: Response;
  try { res = await fetchRecording(key, c.elevenLabsConversationId!); }
  catch { return new Response("ElevenLabs did not answer", { status: 504 }); }
  if (!res.ok || !res.body) return new Response("The recording is not available", { status: res.status === 404 ? 404 : 502 });
  const name = `${safeName(tenant.slug)}-${c.startedAt.slice(0, 16).replace(/[:T]/g, "-")}.mp3`;
  return new Response(res.body, {
    headers: {
      "content-type": res.headers.get("content-type") || "audio/mpeg",
      "cache-control": "private, no-store",
      ...(url.searchParams.get("download") === "1" ? { "content-disposition": `attachment; filename="${name}"` } : {}),
    },
  });
}
