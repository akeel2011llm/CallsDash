import type { Branding, Tenant } from "./types";

/** Short fingerprint of an image, used as a cache-busting version in its URL. */
const fingerprint = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};

/**
 * Branding for pages: the stored images (inline data: URLs) are swapped for short, cacheable URLs served by
 * /api/brand, so a 150 KB logo is downloaded once instead of being written into every page.
 */
export function publicBranding(t: Pick<Tenant, "slug" | "branding">): Branding {
  const b = { ...t.branding };
  for (const [field, kind] of [["logoUrl", "logo"], ["coverUrl", "cover"]] as const) {
    const v = b[field];
    b[field] = v ? `/api/brand/${encodeURIComponent(t.slug)}/${kind}?v=${fingerprint(v)}` : undefined;
  }
  return b;
}

/** Splits a stored data: URL into its content type and bytes. */
export function decodeDataUrl(v: string | undefined): { type: string; bytes: Buffer } | null {
  const m = /^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/.exec(v ?? "");
  return m ? { type: m[1], bytes: Buffer.from(m[2], "base64") } : null;
}
