import type { Item } from "./types";

/** The photo's address on this app (relative), versioned by the item's last change so a replaced photo is never shown from cache. */
export const itemPhotoPath = (slug: string, i: Pick<Item, "id" | "updatedAt">) =>
  `/api/items/${encodeURIComponent(slug)}/${i.id}/image?v=${Date.parse(i.updatedAt) || 0}`;
