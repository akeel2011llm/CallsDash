import { listTenants } from "@/lib/data";
import { decodeDataUrl } from "@/lib/brand-image";

export const dynamic = "force-dynamic";

/** A client's logo or cover image. Public on purpose: the sign-in page shows it before anyone is signed in. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; kind: string }> }) {
  const { slug, kind } = await params;
  const t = (await listTenants()).find((x) => x.slug === slug);
  const img = kind === "logo" || kind === "cover" ? decodeDataUrl(kind === "logo" ? t?.branding.logoUrl : t?.branding.coverUrl) : null;
  if (!img) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(img.bytes), {
    headers: {
      "content-type": img.type,
      // the URL carries a fingerprint of the image, so a changed image is a new URL
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      // an SVG opened directly must not be able to run script
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
