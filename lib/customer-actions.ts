"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireClient } from "./auth";
import { CustomerError, saveCustomerByStaff } from "./customers";
import { getData } from "./data";
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
