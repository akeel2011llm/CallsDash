import { describe, expect, it } from "vitest";
import { decodeDataUrl, publicBranding } from "@/lib/brand-image";
import { isCoverUrl, isLogoUrl, patternOf } from "@/lib/theme";
import type { Branding } from "@/lib/types";

const png = "data:image/png;base64,iVBORw0KGgo=";
const base: Branding = { displayName: "A", displayNameAr: "أ", primaryColor: "#0e7c86" };

describe("brand images", () => {
  it("swaps stored data URLs for short cacheable URLs and changes the version when the image changes", () => {
    const a = publicBranding({ slug: "al-noor", branding: { ...base, logoUrl: png } });
    const b = publicBranding({ slug: "al-noor", branding: { ...base, logoUrl: png + "AA" } });
    expect(a.logoUrl).toMatch(/^\/api\/brand\/al-noor\/logo\?v=[a-z0-9]+$/);
    expect(a.logoUrl).not.toBe(b.logoUrl);
    expect(a.coverUrl).toBeUndefined();
  });
  it("decodes only real image data URLs", () => {
    expect(decodeDataUrl(png)?.type).toBe("image/png");
    expect(decodeDataUrl("data:text/html;base64,PGI+")).toBeNull();
    expect(decodeDataUrl("javascript:alert(1)")).toBeNull();
    expect(decodeDataUrl(undefined)).toBeNull();
  });
  it("applies different size limits to logo and cover", () => {
    const big = "data:image/png;base64," + "A".repeat(250 * 1024);
    expect(isLogoUrl(big)).toBe(false);
    expect(isCoverUrl(big)).toBe(true);
  });
  it("defaults the pattern to waves", () => {
    expect(patternOf({})).toBe("waves");
    expect(patternOf({ pattern: "dots" })).toBe("dots");
    expect(patternOf({ pattern: "bogus" as never })).toBe("waves");
  });
});
