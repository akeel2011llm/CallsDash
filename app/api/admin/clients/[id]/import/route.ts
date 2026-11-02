import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { getData } from "@/lib/data";
import { appUrl } from "@/lib/app-url";
import { SyncError, syncAgent } from "@/lib/agent-sync";
import { elevenLabsFromEnv } from "@/lib/elevenlabs-api";
import { catalogFromEnv } from "@/lib/elevenlabs-catalog";
import { badHeaderSetting } from "@/lib/header-safe";
import { AGENT_PARTS, applyList, applySettings, applyVoiceMode, isListPart, isPart, type ImportOptions, type PartId } from "@/lib/client-transfer";

export const dynamic = "force-dynamic";

/**
 * Admin Clients > Import/Export: applies one step of an import (components/ClientTransfer.tsx sends them in order).
 * `settings` applies every settings part at once, `list` one chunk of a list, `finish` updates the assistant in ElevenLabs.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s || s.role !== "admin" || s.mustChangePassword) return Response.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const d = await getData();
  const tenant = /^[A-Za-z0-9_-]{1,64}$/.test(id) ? await d.getTenant(id) : undefined;
  if (!tenant) return Response.json({ error: "unknown_client" }, { status: 404 });
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return Response.json({ error: "bad_request" }, { status: 400 }); }
  const raw = (body.options ?? {}) as Record<string, unknown>;
  const from = (raw.from ?? {}) as Record<string, unknown>;
  const opts: ImportOptions = {
    mode: raw.mode === "replace" ? "replace" : "merge", rename: raw.rename === true, photos: raw.photos === true,
    from: { id: String(from.id ?? "").slice(0, 64), name: String(from.name ?? "").slice(0, 120), nameAr: String(from.nameAr ?? "").slice(0, 120), displayName: String(from.displayName ?? "").slice(0, 120) },
    ...(Array.isArray(raw.oldNames) ? { oldNames: raw.oldNames.map((x) => String(x).slice(0, 120)).slice(0, 20) } : {}),
    ...(typeof raw.newName === "string" ? { newName: raw.newName.slice(0, 120) } : {}),
    ...(typeof raw.newNameAr === "string" ? { newNameAr: raw.newNameAr.slice(0, 120) } : {}),
  };
  const actor = "admin";
  try {
    if (body.step === "settings") {
      const parts: Partial<Record<PartId, unknown>> = {};
      for (const [k, v] of Object.entries((body.parts ?? {}) as Record<string, unknown>)) if (isPart(k) && !isListPart(k) && !AGENT_PARTS.includes(k)) parts[k] = v;
      return Response.json(await applySettings(d, tenant.id, parts, opts, actor));
    }
    if (body.step === "list") {
      const part = String(body.part ?? "");
      if (!isListPart(part) || !Array.isArray(body.entries)) return Response.json({ error: "bad_request" }, { status: 400 });
      const keep = Array.isArray(body.keep) ? body.keep.map(String) : undefined;
      return Response.json(await applyList(d, tenant.id, part, body.entries.slice(0, 500), opts, actor, keep));
    }
    if (body.step === "finish") {
      // the same as pressing "Update the assistant": the agent in ElevenLabs gets everything just imported, and the answer says how it went
      revalidatePath("/admin", "layout");
      revalidatePath("/app", "layout");
      return Response.json(await updateAgent(tenant.id, actor, body.voiceMode));
    }
    return Response.json({ error: "bad_request" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: "failed", detail: e instanceof Error ? e.message.slice(0, 300) : "unknown" }, { status: 500 });
  }
}

async function updateAgent(tenantId: string, actor: string, voiceMode: unknown): Promise<{ sync: string; detail?: string; voiceMode?: string }> {
  const d = await getData();
  const api = elevenLabsFromEnv();
  const tools = process.env.AGENT_TOOLS_SECRET;
  const url = await appUrl();
  const agentId = (await d.getAgent(tenantId)).elevenLabsAgentId;
  if (!agentId) return { sync: "no_agent" };
  try {
    if (!api) throw new SyncError("no_api_key");
    if (!tools) throw new SyncError("no_secret");
    if (badHeaderSetting()) throw new SyncError("bad_secret", badHeaderSetting());
    if (!url.startsWith("https://")) throw new SyncError("no_app_url");
    await syncAgent({ api, data: d, appUrl: url, toolsSecret: tools, initSecret: process.env.ELEVENLABS_INIT_SECRET || tools }, tenantId, actor);
  } catch (e) {
    return { sync: e instanceof SyncError ? e.code : "failed", detail: e instanceof Error ? e.message.slice(0, 300) : undefined };
  }
  if (voiceMode === undefined || voiceMode === null || !api) return { sync: "ok" };
  try {
    const own = (await catalogFromEnv()?.getAgent(agentId).catch(() => undefined))?.realtime?.path;
    return { sync: "ok", voiceMode: await applyVoiceMode(api, agentId, voiceMode, own) };
  } catch (e) {
    return { sync: "ok", voiceMode: "failed", detail: e instanceof Error ? e.message.slice(0, 300) : undefined };
  }
}
