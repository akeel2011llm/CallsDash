import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { validVoiceId } from "@/lib/agent-studio";
import { catalogFromEnv, explainCatalogError, type VoiceQuery } from "@/lib/elevenlabs-catalog";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

async function admin() {
  const s = await getSession();
  return s?.role === "admin" && !s.mustChangePassword;
}

/** A write must come from this app's own pages: a cross-site page cannot make the admin's browser add voices. */
function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host")); } catch { return false; }
}

const clip = (v: string | null, max: number) => (v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const word = (v: string | null, max = 40) => clip(v, max).replace(/[^\p{L}\p{N} _\-.]/gu, "");

/** Voice search for the Assistant studio: the account's own voices, or ElevenLabs' public voice library. Admin only. */
export async function GET(req: Request) {
  if (!(await admin())) return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  const api = catalogFromEnv();
  if (!api) return NextResponse.json({ error: "no_key" }, { status: 200, headers: NO_STORE });
  const p = new URL(req.url).searchParams;
  const next = clip(p.get("next"), 200);
  const q: VoiceQuery = {
    search: clip(p.get("q"), 80), language: word(p.get("lang"), 8), gender: word(p.get("gender"), 12).toLowerCase(), accent: word(p.get("accent")),
    pageSize: 24, next: next || undefined,
  };
  try {
    const page = p.get("source") === "library" ? await api.searchLibrary(q) : await api.searchVoices(q);
    return NextResponse.json({ ok: true, ...page }, { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json({ error: "failed", message: explainCatalogError(e) }, { status: 200, headers: NO_STORE });
  }
}

/** Copies a library voice into the ElevenLabs account, which is what lets an assistant speak with it. Admin only. */
export async function POST(req: Request) {
  if (!(await admin()) || !sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  const api = catalogFromEnv();
  if (!api) return NextResponse.json({ error: "no_key" }, { status: 200, headers: NO_STORE });
  let body: { publicOwnerId?: unknown; voiceId?: unknown; name?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400, headers: NO_STORE }); }
  const owner = typeof body.publicOwnerId === "string" ? body.publicOwnerId : "";
  const voice = typeof body.voiceId === "string" ? body.voiceId : "";
  const name = typeof body.name === "string" ? clip(body.name, 100) : "";
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(owner) || !validVoiceId(voice) || !name) return NextResponse.json({ error: "bad_request" }, { status: 400, headers: NO_STORE });
  try {
    return NextResponse.json({ ok: true, ...(await api.addLibraryVoice({ publicOwnerId: owner, voiceId: voice, name })) }, { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json({ error: "failed", message: explainCatalogError(e) }, { status: 200, headers: NO_STORE });
  }
}
