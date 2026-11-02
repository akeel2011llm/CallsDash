import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { getData } from "@/lib/data";
import { autoSync } from "@/lib/auto-sync";
import { applyList, applySettings, isListPart, isPart, type ImportOptions, type PartId } from "@/lib/client-transfer";

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
  };
  const actor = "admin";
  try {
    if (body.step === "settings") {
      const parts: Partial<Record<PartId, unknown>> = {};
      for (const [k, v] of Object.entries((body.parts ?? {}) as Record<string, unknown>)) if (isPart(k) && !isListPart(k)) parts[k] = v;
      return Response.json({ done: await applySettings(d, tenant.id, parts, opts, actor) });
    }
    if (body.step === "list") {
      const part = String(body.part ?? "");
      if (!isListPart(part) || !Array.isArray(body.entries)) return Response.json({ error: "bad_request" }, { status: 400 });
      const keep = Array.isArray(body.keep) ? body.keep.map(String) : undefined;
      return Response.json(await applyList(d, tenant.id, part, body.entries.slice(0, 500), opts, actor, keep));
    }
    if (body.step === "finish") {
      // the assistant's instructions and knowledge come from what was just imported
      await autoSync(tenant.id, actor).catch(() => undefined);
      revalidatePath("/admin", "layout");
      revalidatePath("/app", "layout");
      return Response.json({ ok: true });
    }
    return Response.json({ error: "bad_request" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: "failed", detail: e instanceof Error ? e.message.slice(0, 300) : "unknown" }, { status: 500 });
  }
}
