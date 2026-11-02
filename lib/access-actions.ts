"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession, requireAdmin, requireClient } from "./auth";
import * as store from "./data";
import { accessKey, readAccess, sectionsFromForm, withList } from "./access";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/**
 * Saves what receptionists (or one person) may open in the client portal. The admin can do it for any client (People
 * tab); a client's manager for their own team (Team page). `who` is "receptionist" or the person's user id; `reset`
 * removes a person's own list so they follow the receptionist default again.
 */
export async function saveAccessAction(f: FormData) {
  const s = await getSession();
  let tenantId: string;
  let actor: string;
  let back: string;
  if (s?.role === "admin" && !s.viewAsTenantId) {
    ({ actor } = await requireAdmin());
    tenantId = str(f, "tenantId");
    back = `/admin/clients/${tenantId}/people`;
  } else {
    const c = await requireClient();
    if (c.staffRole !== "manager") redirect("/app");
    tenantId = c.tenant.id;
    actor = c.actor;
    back = "/app/team";
  }
  const tenant = await store.getTenant(tenantId);
  if (!tenant) redirect("/admin");
  const who = str(f, "who");
  if (who !== "receptionist") {
    // only a receptionist of this client can get a list of their own
    const person = (await store.listProfiles(tenantId)).find((p) => p.id === who);
    if (!person || person.role !== "receptionist") redirect(`${back}?access=gone#access`);
  }
  const rules = readAccess(await store.getSetting(accessKey(tenantId)).catch(() => undefined));
  const next = withList(rules, who, f.get("reset") === "1" ? null : sectionsFromForm((k) => f.get(k)));
  await store.setSetting(accessKey(tenantId), next);
  await store.audit(actor, who === "receptionist" ? "Changed what receptionists can open" : "Changed what one team member can open", tenantId).catch(() => undefined);
  revalidatePath("/app", "layout");
  revalidatePath(back);
  redirect(`${back}?access=saved#${who === "receptionist" ? "access" : `access-${who}`}`);
}
