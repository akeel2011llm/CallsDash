import { getSession } from "@/lib/auth";
import { audit, getAgent, getTenant } from "@/lib/data";
import { checkHoldAudio, uploadHoldAudio } from "@/lib/hold-audio";

export const dynamic = "force-dynamic";

/**
 * Uploads a client's hold audio to its ElevenLabs agent (lib/hold-audio.ts). A plain form post rather than a server action,
 * because a server action takes at most 1 MB and a clip is often bigger. Admins only; the answer is a redirect back to the studio.
 */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s || s.role !== "admin" || s.mustChangePassword) return new Response("Not found", { status: 404 });
  // a form on another site must not be able to post here with the admin's cookie
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(req.url).host) return new Response("Forbidden", { status: 403 });
  const f = await req.formData().catch(() => null);
  const tenantId = String(f?.get("tenantId") ?? "");
  const tenant = /^[A-Za-z0-9_-]{1,64}$/.test(tenantId) ? await getTenant(tenantId) : undefined;
  if (!f || !tenant) return new Response("Not found", { status: 404 });
  const back = (q: string) => Response.redirect(new URL(`/admin/clients/${tenant.id}/assistant?section=safety&hold=${q}#safety`, req.url), 303);
  const file = f.get("file");
  const problem = checkHoldAudio(file instanceof File ? file : null);
  if (problem) return back(problem);
  const agent = await getAgent(tenant.id);
  const key = process.env.ELEVENLABS_API_KEY;
  if (!agent.elevenLabsAgentId) return back("no_agent");
  if (!key) return back("no_key");
  try {
    await uploadHoldAudio(key, agent.elevenLabsAgentId, file as File, (file as File).name);
  } catch {
    return back("refused");
  }
  await audit("admin", `Uploaded hold audio "${(file as File).name.slice(0, 80)}" to the assistant`, tenant.id).catch(() => undefined);
  return back("uploaded");
}
