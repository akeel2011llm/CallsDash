import { getDoctorImage, getDoctors, getItem, getItemImage, listTenants } from "@/lib/data";
import { decodeDataUrl } from "@/lib/brand-image";

export const dynamic = "force-dynamic";

/**
 * The photo of a catalogue item, or of a doctor (ids never clash). Public on purpose: the website chat and WhatsApp show it to customers who are not signed in.
 * Only photos of active items and doctors are served, and the address carries the item's version (`?v=`), so a replaced photo is a new address.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const tenant = (await listTenants()).find((x) => x.slug === slug);
  const item = tenant ? await getItem(tenant.id, id) : undefined;
  let stored: string | undefined;
  if (tenant && item?.active) stored = await getItemImage(tenant.id, id);
  else if (tenant && !item) {
    const doctor = (await getDoctors(tenant.id)).find((x) => x.id === id);
    if (doctor && doctor.active !== false) stored = await getDoctorImage(tenant.id, id);
  }
  const img = decodeDataUrl(stored);
  if (!img || img.type === "image/svg+xml") return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(img.bytes), {
    headers: {
      "content-type": img.type,
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      // the widget on a clinic's own website draws this picture
      "cross-origin-resource-policy": "cross-origin",
    },
  });
}
