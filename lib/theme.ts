import type { Branding, FontStyle, PatternStyle, RadiusStyle, SidebarStyle } from "./types";

const HEX = /^#[0-9a-fA-F]{6}$/;
export const isHex = (v: unknown): v is string => typeof v === "string" && HEX.test(v);

export const SIDEBAR_STYLES: SidebarStyle[] = ["light", "dark", "brand"];
export const RADIUS_STYLES: RadiusStyle[] = ["sharp", "soft", "round"];
export const FONT_STYLES: FontStyle[] = ["modern", "classic", "friendly"];
export const PATTERN_STYLES: PatternStyle[] = ["waves", "dots", "mesh", "none"];
export const patternOf = (b: Pick<Branding, "pattern">): PatternStyle => (PATTERN_STYLES.includes(b.pattern as PatternStyle) ? (b.pattern as PatternStyle) : "waves");

const RADIUS: Record<RadiusStyle, string> = { sharp: "4px", soft: "10px", round: "18px" };

// System font stacks only: nothing to download, and Arabic always has a good fallback.
const ARABIC = `"Noto Sans Arabic", "Segoe UI", Tahoma, "Geeza Pro", sans-serif`;
const BODY: Record<FontStyle, string> = {
  modern: `system-ui, -apple-system, "Segoe UI", Roboto, ${ARABIC}`,
  classic: `"Iowan Old Style", Georgia, "Times New Roman", ${ARABIC}`,
  friendly: `ui-rounded, "Trebuchet MS", "Segoe UI", ${ARABIC}`,
};
const HEAD: Record<FontStyle, string> = {
  modern: BODY.modern,
  classic: `"Iowan Old Style", Georgia, "Times New Roman", ${ARABIC}`,
  friendly: BODY.friendly,
};

/** Black or white, whichever reads better on `hex`. */
export function onColor(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.4 ? "#10202b" : "#ffffff";
}

/** CSS custom properties for a client's look. Unset or invalid values fall back to the CallsDash defaults. */
export function themeVars(b: Pick<Branding, "primaryColor" | "accentColor" | "radius" | "font">): Record<string, string> {
  const brand = isHex(b.primaryColor) ? b.primaryColor : "#0e7c86";
  const accent = isHex(b.accentColor) ? b.accentColor : brand;
  const font = FONT_STYLES.includes(b.font as FontStyle) ? (b.font as FontStyle) : "modern";
  return {
    "--brand": brand,
    "--on-brand": onColor(brand),
    "--accent": accent,
    "--on-accent": onColor(accent),
    "--radius": RADIUS[RADIUS_STYLES.includes(b.radius as RadiusStyle) ? (b.radius as RadiusStyle) : "soft"],
    "--font-body": BODY[font],
    "--font-head": HEAD[font],
  };
}

export const sidebarOf = (b: Pick<Branding, "sidebar">): SidebarStyle => (SIDEBAR_STYLES.includes(b.sidebar as SidebarStyle) ? (b.sidebar as SidebarStyle) : "light");

/** Accepts a small raster or SVG image and returns it as a data: URL, or null when it is not acceptable. */
export const LOGO_MAX_BYTES = 150 * 1024;
export const COVER_MAX_BYTES = 300 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);
export async function imageDataUrl(file: File, maxBytes: number): Promise<string | null> {
  if (!IMAGE_TYPES.has(file.type) || file.size === 0 || file.size > maxBytes) return null;
  return `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`;
}
export const logoDataUrl = (file: File) => imageDataUrl(file, LOGO_MAX_BYTES);
export const coverDataUrl = (file: File) => imageDataUrl(file, COVER_MAX_BYTES);
const isImageUrl = (v: unknown, maxBytes: number): v is string =>
  typeof v === "string" && /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length < maxBytes * 1.4;
export const isLogoUrl = (v: unknown): v is string => isImageUrl(v, LOGO_MAX_BYTES);
export const isCoverUrl = (v: unknown): v is string => isImageUrl(v, COVER_MAX_BYTES);
