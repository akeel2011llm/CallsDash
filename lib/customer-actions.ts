"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireClient } from "./auth";
import { CustomerError, saveCustomerByStaff } from "./customers";
import { getData } from "./data";
import { autoSync } from "./auto-sync";
import { lookupModeOf } from "./customers";
import type { Locale } from "./types";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Adds a customer (no id) or saves the changes to one. Any member of the clinic's staff may do this. */
export async function saveCustomerAction(f: FormData) {
  const { tenant, actor } = await requireClient();
  const id = str(f, "id");
  const back = id ? `/app/customers/${id}` : "/app/customers";
  const lang = str(f, "language");
  let saved;
  try {
    saved = await saveCustomerByStaff(await getData(), tenant.id, {
      id: id || undefined, name: str(f, "name"), phone: str(f, "phone"), cpr: str(f, "cpr"), email: str(f, "email"),
      language: lang === "ar" || lang === "en" ? (lang as Locale) : undefined, notes: str(f, "notes"),
    }, actor);
  } catch (e) {
    if (e instanceof CustomerError) redirect(`${back}?err=${e.code}`);
    throw e;
  }
  revalidatePath("/app", "layout");
  redirect(`/app/customers/${saved.id}?saved=1`);
}

/** Erases a customer's record (a customer's request, or a mistake). Their conversations and bookings stay. Managers only, with the tick box. */
export async function deleteCustomerAction(f: FormData) {
  const { tenant, actor, staffRole } = await requireClient();
  const id = str(f, "id");
  if (staffRole !== "manager") redirect(`/app/customers/${id}`);
  if (f.get("confirm") !== "on") redirect(`/app/customers/${id}?err=confirm`);
  await (await getData()).deleteCustomer(tenant.id, id, actor);
  revalidatePath("/app", "layout");
  redirect("/app/customers?deleted=1");
}

/** Chooses how the assistant finds a returning customer: by phone number or by CPR number. Managers only; the assistant is updated on its own. */
export async function saveLookupModeAction(f: FormData) {
  const { tenant, actor, staffRole } = await requireClient();
  if (staffRole !== "manager") redirect("/app/customers");
  const mode = str(f, "mode") === "cpr" ? "cpr" : "phone";
  const data = await getData();
  const cur = await data.getAgent(tenant.id);
  if (lookupModeOf(cur) !== mode) {
    await data.saveAgent(tenant.id, { ...cur, customerLookup: mode }, actor, `Customers are found by ${mode === "cpr" ? "CPR number" : "phone number"}`);
    await autoSync(tenant.id, actor);
  }
  revalidatePath("/app", "layout");
  redirect("/app/customers?mode=1");
}
