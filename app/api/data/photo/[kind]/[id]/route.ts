import { dataTenant } from "@/lib/data-access";
import { getData } from "@/lib/data";
import { decodeDataUrl } from "@/lib/brand-image";

export const dynamic = "force-dynamic";

/**
 * A stored photo of a catalogue item or a doctor, for the signed-in staff of that client and the admin. Unlike the public item
 * photo route, hidden items are served too, because the Data screen manages them. The address carries `?v=` so a replaced photo is new.
 */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const tenant = await dataTenant(new URL(req.url), "photo");
  const d = await getData();
  const stored = !tenant ? undefined : kind === "item" ? await d.getItemImage(tenant.id, id) : kind === "doctor" ? await d.getDoctorImage(tenant.id, id) : undefined;
  const img = decodeDataUrl(stored);
  if (!img || img.type === "image/svg+xml") return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(img.bytes), {
    headers: {
      "content-type": img.type,
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
