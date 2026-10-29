import type { Data } from "./data/demo";
import type { Doctor, Item, Locale } from "./types";

export type ItemDeps = Pick<Data, "getItems" | "getItem" | "getItemImage" | "putItem" | "deleteItem">;

export class ItemError extends Error {
  constructor(public code: "no_name" | "bad_image" | "unknown") { super(code); }
}

/** A photo is stored as a data: URL; staff photos are resized in the browser first, so this is a safety limit. */
export const ITEM_IMAGE_MAX_BYTES = 700 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const clip = (s: string | undefined, n: number) => (s ?? "").trim().slice(0, n);

/** The photo as a data: URL, or null when it is not a png, jpeg or webp within the size limit. */
export async function itemImageDataUrl(file: File): Promise<string | null> {
  if (!IMAGE_TYPES.has(file.type) || file.size === 0 || file.size > ITEM_IMAGE_MAX_BYTES) return null;
  return `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`;
}

/** Lower case, Arabic letter variants and vowel marks folded together, so أ/ا/إ and ة/ه do not stop a match. */
export function foldText(s: string): string {
  return s.toLowerCase()
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}
const words = (s: string) => foldText(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);

/** Scores an item against what the customer asked for: a name word counts most, then keywords, then details. 0 means no match. */
export function scoreItem(i: Pick<Item, "name" | "nameAr" | "details" | "detailsAr" | "keywords">, query: string): number {
  const q = words(query);
  if (!q.length) return 0;
  const name = foldText(`${i.name} ${i.nameAr ?? ""}`), keys = foldText(i.keywords), det = foldText(`${i.details} ${i.detailsAr ?? ""}`);
  const nameWords = new Set(words(`${i.name} ${i.nameAr ?? ""}`));
  let score = 0, hit = 0;
  for (const w of q) {
    let s = 0;
    if (nameWords.has(w)) s = 4; else if (name.includes(w)) s = 3;
    else if (keys.includes(w)) s = 2;
    else if (det.includes(w)) s = 1;
    if (s) hit++;
    score += s;
  }
  // a whole-name match beats words that are merely scattered through the text
  if (name.includes(foldText(query.trim())) && query.trim().length >= 3) score += 5;
  return hit === 0 ? 0 : score + (hit / q.length);
}

export interface FoundItem { item_id: string; kind?: "doctor"; name: string; details: string; price?: string; image_url?: string; page_url: string }

const MAX_FOUND = 3;
/** With no query, the assistant is shown a short list of what the clinic offers, items with a photo first. */
const MAX_LISTED = 5;
/** Titles in front of a doctor's name that would otherwise match every doctor. */
const TITLE_WORDS = new Set(["dr", "doctor", "doc", "دكتور", "دكتورة", "د"]);
const withoutTitles = (q: string) => words(q).filter((w) => !TITLE_WORDS.has(w)).join(" ");

type DoctorForFind = Pick<Doctor, "id" | "name" | "specialty" | "active" | "photoAt">;

/** A doctor the customer asked about by name or specialty. Only active doctors; the photo address is there only when a photo was added. */
function doctorEntry(doc: DoctorForFind, tenant: { slug: string }, origin: string, ar: boolean): FoundItem {
  return {
    item_id: doc.id, kind: "doctor", name: doc.name, details: doc.specialty,
    ...(doc.photoAt ? { image_url: itemImageUrl(origin, tenant.slug, { id: doc.id, updatedAt: doc.photoAt }) } : {}),
    page_url: itemPageUrl(origin, tenant.slug, doc.id, ar ? "ar" : "en"),
  };
}

/**
 * What the assistant is told when a customer asks about something the clinic offers or about a doctor. Only active items and
 * doctors are searched; the best few come back with their details in the customer's language and, when there is a photo, a public
 * address for it. An empty query lists what the clinic offers. `origin` is this app's public address (no trailing slash), because
 * the photo address is opened by the customer's browser.
 */
export async function findItems(d: ItemDeps & Pick<Data, "getDoctors">, tenant: { id: string; slug: string }, input: { query: string; language?: Locale }, origin: string) {
  const query = clip(input.query, 200);
  const ar = input.language === "ar";
  const all = (await d.getItems(tenant.id)).filter((i) => i.active);
  const entry = (i: Item): FoundItem => ({
    item_id: i.id,
    name: (ar && i.nameAr) || i.name,
    details: ((ar && i.detailsAr) || i.details).slice(0, 800),
    ...(i.price ? { price: i.price } : {}),
    ...(i.hasImage ? { image_url: itemImageUrl(origin, tenant.slug, i) } : {}),
    page_url: itemPageUrl(origin, tenant.slug, i.id, ar ? "ar" : "en"),
  });
  const USE = "Use only these details. Show the photo the way your instructions say for this channel; page_url is a link to a page with the photo and details, for channels that cannot show a picture.";
  if (!query) {
    if (!all.length) return { found: false, items: [] as FoundItem[], message: "The clinic has no catalogue items. Answer from the knowledge base, or offer to take a message." };
    const listed = [...all].sort((a, b) => Number(b.hasImage) - Number(a.hasImage)).slice(0, MAX_LISTED);
    return { found: true, items: listed.map(entry), message: `${USE} This is part of what the clinic offers: if the customer wants one of them, show its photo.` };
  }
  const best = all.map((i) => ({ i, s: scoreItem(i, query) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, MAX_FOUND);
  const named = withoutTitles(query);
  const docs = named
    ? (await d.getDoctors(tenant.id)).filter((x) => x.active !== false)
      .map((x) => ({ x, s: scoreItem({ name: x.name, details: x.specialty, keywords: "" }, named) })).filter((m) => m.s > 0).sort((a, b) => b.s - a.s).slice(0, MAX_FOUND)
    : [];
  if (!best.length && !docs.length) {
    return {
      found: false, items: [] as FoundItem[],
      message: all.length
        ? "Nothing in the catalogue matches and no doctor has that name. Do not guess; say you do not have it listed and offer to take a message."
        : "The clinic has no catalogue items. Answer from the knowledge base, or offer to take a message.",
    };
  }
  return {
    found: true,
    items: [...best.map(({ i }) => entry(i)), ...docs.map(({ x }) => doctorEntry(x, tenant, origin, ar))],
    message: `${USE} An entry marked kind:doctor is a doctor: describe them from the details, and if it has no image_url say there is no photo of them on file.`,
  };
}

/** The public address of an item's photo; the version changes whenever the item changes, so a replaced photo is never served from cache. */
export const itemImageUrl = (origin: string, slug: string, i: Pick<Item, "id" | "updatedAt">) =>
  `${origin}/api/items/${encodeURIComponent(slug)}/${i.id}/image?v=${Date.parse(i.updatedAt) || 0}`;

/** The public page of an item (photo, details and price). A chat app shows a picture preview for its link. */
export const itemPageUrl = (origin: string, slug: string, itemId: string, language: Locale = "en") =>
  `${origin}/i/${encodeURIComponent(slug)}/${itemId}${language === "ar" ? "?lang=ar" : ""}`;

export interface StaffItemInput { id?: string; name: string; nameAr?: string; details?: string; detailsAr?: string; price?: string; keywords?: string; active: boolean }

/** Adds (no id) or edits an item from the Catalogue screen. `image`: a data: URL to store, null to remove the photo, undefined to keep it. */
export async function saveItemByStaff(d: ItemDeps, tenantId: string, input: StaffItemInput, image: string | null | undefined, actor: string): Promise<Item> {
  const name = clip(input.name, 120);
  if (!name) throw new ItemError("no_name");
  let createdAt = new Date().toISOString();
  if (input.id) {
    const cur = await d.getItem(tenantId, input.id);
    if (!cur) throw new ItemError("unknown");
    createdAt = cur.createdAt;
  }
  return d.putItem(tenantId, {
    id: input.id, name, nameAr: clip(input.nameAr, 120) || undefined, details: clip(input.details, 1500), detailsAr: clip(input.detailsAr, 1500) || undefined,
    price: clip(input.price, 60) || undefined, keywords: clip(input.keywords, 300), active: input.active, createdAt,
  }, image, actor);
}
