import { decodeDataUrl } from "./brand-image";
import { whatsappUserId } from "./whatsapp";
import { itemImageUrl } from "./items";
import type { Data } from "./data/demo";
import type { Locale } from "./types";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export type PhotoDeps = Pick<Data, "getTenant" | "getItem" | "getItemImage" | "getSecrets" | "getDoctors" | "getDoctorImage">;

export type PhotoResult =
  | { status: "sent" }
  | { status: "skipped"; reason: "no_token" | "no_phone_id" | "no_recipient" | "no_item" | "no_photo" | "format" | "channel_off" }
  | { status: "failed"; error: string };

const GRAPH = "https://graph.facebook.com/v21.0";

/** What goes under the photo: the item's (or doctor's) name in the customer's language and its price, if it has one. */
export function photoCaption(i: { name: string; nameAr?: string; price?: string }, language: Locale): string {
  const name = (language === "ar" && i.nameAr) || i.name;
  return (i.price ? `${name} - ${i.price}` : name).slice(0, 1000);
}

/**
 * Sends an item's photo to a customer in their WhatsApp conversation through Meta's WhatsApp Cloud API, with the clinic's own
 * access token. Meta only allows this inside 24 hours of the customer's last message, which is always true while the assistant
 * is answering them. `origin` is this app's public address: Meta downloads the picture from there.
 * WhatsApp shows only jpeg and png pictures, so a webp photo is skipped (the assistant sends a link instead).
 */
export async function sendItemPhoto(d: PhotoDeps, tenantId: string, input: { itemId: string; to: string; language?: Locale }, origin: string, fetchImpl: FetchLike = fetch): Promise<PhotoResult> {
  const tenant = await d.getTenant(tenantId);
  const w = tenant?.integrations.whatsapp;
  if (!tenant) return { status: "skipped", reason: "channel_off" };
  const token = (await d.getSecrets(tenantId)).whatsappToken;
  if (!token) return { status: "skipped", reason: "no_token" };
  if (!w?.phoneNumberId) return { status: "skipped", reason: "no_phone_id" };
  const to = whatsappUserId(input.to);
  if (!to) return { status: "skipped", reason: "no_recipient" };
  // the id is a catalogue item's, or a doctor's (ids never clash)
  let item: { id: string; name: string; nameAr?: string; price?: string; updatedAt: string } | undefined;
  let stored: string | undefined;
  const found = await d.getItem(tenantId, input.itemId);
  if (found) {
    if (!found.active) return { status: "skipped", reason: "no_item" };
    if (!found.hasImage) return { status: "skipped", reason: "no_photo" };
    item = found;
    stored = await d.getItemImage(tenantId, found.id);
  } else {
    const doctor = (await d.getDoctors(tenantId)).find((x) => x.id === input.itemId);
    if (!doctor || doctor.active === false) return { status: "skipped", reason: "no_item" };
    if (!doctor.photoAt) return { status: "skipped", reason: "no_photo" };
    item = { id: doctor.id, name: doctor.name, updatedAt: doctor.photoAt };
    stored = await d.getDoctorImage(tenantId, doctor.id);
  }
  const img = decodeDataUrl(stored);
  if (!img) return { status: "skipped", reason: "no_photo" };
  if (img.type !== "image/jpeg" && img.type !== "image/png") return { status: "skipped", reason: "format" };
  try {
    const res = await fetchImpl(`${GRAPH}/${encodeURIComponent(w.phoneNumberId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", recipient_type: "individual", to, type: "image",
        image: { link: itemImageUrl(origin, tenant.slug, item), caption: photoCaption(item, input.language ?? "en") },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return { status: "sent" };
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number } };
    return { status: "failed", error: `${body.error?.code ? `(#${body.error.code}) ` : ""}${body.error?.message ?? `HTTP ${res.status}`}`.slice(0, 300) };
  } catch (e) {
    return { status: "failed", error: e instanceof Error ? e.message.slice(0, 200) : "request failed" };
  }
}

/** Plain advice for an admin when Meta refuses a photo, from Meta's error text. Null when it is none of the known ones. */
export function photoFailureHint(error: string | undefined): "token" | "window" | "permission" | null {
  const e = error ?? "";
  if (/\b190\b|access token|session has (expired|been invalidated)|invalid oauth/i.test(e)) return "token";
  if (/\b131047\b|re-?engagement|24 hours|24-hour/i.test(e)) return "window";
  if (/\b(10|200|3)\b[^.]*permission|permission|does not have permission|not authorized/i.test(e)) return "permission";
  return null;
}
