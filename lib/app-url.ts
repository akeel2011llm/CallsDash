import "server-only";
import { headers } from "next/headers";

/** This app's public address, without a trailing slash. ElevenLabs and Meta call back here. */
export async function appUrl(): Promise<string> {
  const fixed = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  if (fixed) return fixed;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}`;
}
