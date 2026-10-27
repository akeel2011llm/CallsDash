"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "./auth";
import { getSetting, setSetting } from "./data";
import { guideOwnerKey, hideGuide, isGuideId, readHidden, showGuide } from "./guides";

const refresh = () => revalidatePath("/", "layout");

/** The x on a guide: hides it for this person only. It can be brought back in the account settings. */
export async function hideGuideAction(f: FormData) {
  const s = await getSession();
  const id = f.get("id");
  if (!s || !isGuideId(id)) return;
  const key = guideOwnerKey(s);
  await setSetting(key, hideGuide(readHidden(await getSetting(key)), id));
  refresh();
}

/** One guide back, or every guide back when no id is given. */
export async function showGuideAction(f: FormData) {
  const s = await getSession();
  if (!s) return;
  const key = guideOwnerKey(s);
  const id = f.get("id");
  await setSetting(key, isGuideId(id) ? showGuide(readHidden(await getSetting(key)), id) : []);
  refresh();
}
