"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireClient } from "./auth";
import { ItemError, itemImageDataUrl, saveItemByStaff } from "./items";
import { getData } from "./data";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Adds an item (no id) or saves changes to one, with its photo. Anyone who may edit the knowledge base may edit the catalogue. */
export async function saveItemAction(f: FormData) {
  const { tenant, actor } = await requireClient();
  if (!tenant.permissions.editKnowledge) throw new Error("forbidden");
  const id = str(f, "id");
  const back = id ? `/app/catalogue/${id}` : "/app/catalogue";
  let image: string | null | undefined;
  const file = f.get("photo");
  if (file instanceof File && file.size > 0) {
    image = await itemImageDataUrl(file);
    if (!image) redirect(`${back}?err=bad_image`);
  } else if (f.get("removePhoto") === "on") image = null;
  let saved;
  try {
    saved = await saveItemByStaff(await getData(), tenant.id, {
      id: id || undefined, name: str(f, "name"), nameAr: str(f, "nameAr"), details: str(f, "details"), detailsAr: str(f, "detailsAr"),
      price: str(f, "price"), keywords: str(f, "keywords"), active: f.get("active") === "on",
    }, image, actor);
  } catch (e) {
    if (e instanceof ItemError) redirect(`${back}?err=${e.code}`);
    throw e;
  }
  revalidatePath("/app", "layout");
  redirect(`/app/catalogue/${saved.id}?saved=1`);
}

/** Erases an item and its photo. Managers only, with the tick box. */
export async function deleteItemAction(f: FormData) {
  const { tenant, actor, staffRole } = await requireClient();
  const id = str(f, "id");
  if (staffRole !== "manager" || !tenant.permissions.editKnowledge) redirect(`/app/catalogue/${id}`);
  if (f.get("confirm") !== "on") redirect(`/app/catalogue/${id}?err=confirm`);
  await (await getData()).deleteItem(tenant.id, id, actor);
  revalidatePath("/app", "layout");
  redirect("/app/catalogue?deleted=1");
}
