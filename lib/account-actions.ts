"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "./auth";
import { audit } from "./data";
import { accountApiFromEnv } from "./elevenlabs-account";
import { backfillRealCosts, loadAccount } from "./account-server";
import { safePath } from "./format";

/** Refresh: reads the ElevenLabs balance, plan and usage again, and asks for the real cost of recent conversations. */
export async function refreshAccountAction(f: FormData) {
  const { actor } = await requireAdmin();
  await loadAccount(true);
  const api = accountApiFromEnv();
  const asked = api ? await backfillRealCosts(api).catch(() => 0) : 0;
  await audit(actor, `Read the ElevenLabs balance and usage again${asked ? ` (and the real cost of ${asked} conversations)` : ""}`).catch(() => undefined);
  revalidatePath("/admin", "layout");
  const back = safePath(f.get("returnTo"), "/admin/billing/elevenlabs");
  redirect(`${back}${back.includes("?") ? "&" : "?"}refreshed=1#elevenlabs`);
}
