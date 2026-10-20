import type { MetadataRoute } from "next";
import { getSession } from "@/lib/auth";
import { getTenant } from "@/lib/data";
import { themeVars } from "@/lib/theme";

export const dynamic = "force-dynamic";

/** The installed app carries the signed-in client's name and colour; everyone else gets CallsDash. */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  let name = "CallsDash", color = "#0e7c86";
  try {
    const s = await getSession();
    const t = s?.role === "client" ? await getTenant(s.tenantId) : undefined;
    if (t) {
      name = t.branding.displayName || name;
      color = themeVars(t.branding)["--brand"];
    }
  } catch { /* fall back to the defaults */ }
  return {
    id: "/",
    name,
    short_name: name.length > 14 ? name.slice(0, 13).trimEnd() + "…" : name,
    description: "AI receptionist dashboard",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f3f5f8",
    theme_color: color,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
