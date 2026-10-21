import "server-only";
import { headers } from "next/headers";

/** This app's public address, without a trailing slash. ElevenLabs and Meta call back here. NEXT_PUBLIC_SITE_URL wins. */
export async function appUrl(): Promise<string> {
  const fixed = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  if (fixed) return fixed;
  // On Vercel production, the project's production domain: a per-deployment address can sit behind Vercel's login
  // wall, and ElevenLabs would then be refused when it calls the booking tools.
  const prod = process.env.VERCEL_ENV === "production" ? process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim().replace(/\/+$/, "") : "";
  if (prod) return prod.startsWith("http") ? prod : `https://${prod}`;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}`;
}
