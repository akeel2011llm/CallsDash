"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession, requireAdmin, requireSection } from "./auth";
import * as store from "./data";
import { autoSync } from "./auto-sync";
import { libraryType } from "./service-library";
import { SERVICE_LIMITS, addFromLibrary, newServiceId, readServices, serviceFromForm, servicesKey, type Service } from "./services";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** The admin for any client (Business tab), or a client's manager for their own (Bookings > Services). */
async function who(f: FormData): Promise<{ tenantId: string; actor: string; back: string }> {
  const s = await getSession();
  if (s?.role === "admin" && !s.viewAsTenantId) {
    const { actor } = await requireAdmin();
    const tenantId = str(f, "tenantId");
    if (!(await store.getTenant(tenantId))) redirect("/admin");
    return { tenantId, actor, back: `/admin/clients/${tenantId}/business/services` };
  }
  const c = await requireSection("bookings");
  if (c.staffRole !== "manager") redirect("/app/services?err=manager");
  return { tenantId: c.tenant.id, actor: c.actor, back: "/app/services" };
}

async function save(tenantId: string, actor: string, list: Service[], note: string) {
  await store.setSetting(servicesKey(tenantId), list);
  await store.audit(actor, note, tenantId).catch(() => undefined);
  await autoSync(tenantId, actor).catch(() => undefined);
  revalidatePath("/app", "layout");
  revalidatePath(`/admin/clients/${tenantId}`, "layout");
}
const load = async (tenantId: string) => readServices(await store.getSetting(servicesKey(tenantId)).catch(() => undefined));
const go = (back: string, q: string, hash = "") => redirect(`${back}?${q}${hash}`);

/** Adds a service, or saves the changes to one (`id`). */
export async function saveServiceAction(f: FormData) {
  const { tenantId, actor, back } = await who(f);
  const id = str(f, "id");
  const parsed = serviceFromForm((k) => String(f.get(k) ?? ""));
  if (!parsed.ok) go(back, `err=${parsed.error}`, id ? `#s-${id}` : "#new");
  const value = (parsed as { ok: true; value: Omit<Service, "id" | "from"> }).value;
  const list = await load(tenantId);
  if (id) {
    const old = list.find((s) => s.id === id);
    if (!old) go(back, "err=gone");
    await save(tenantId, actor, list.map((s) => (s.id === id ? { ...s, ...value } : s)), `Edited the service "${value.name}"`);
    go(back, "done=saved", `#s-${id}`);
  }
  if (list.length >= SERVICE_LIMITS.count) go(back, "err=full", "#new");
  if (list.some((s) => s.name.toLowerCase() === value.name.toLowerCase())) go(back, "err=same", "#new");
  await save(tenantId, actor, [...list, { ...value, id: newServiceId(list.map((s) => s.id)) }], `Added the service "${value.name}"`);
  go(back, "done=added");
}

/** Adds the ticked library services of one business type. */
export async function addLibraryServicesAction(f: FormData) {
  const { tenantId, actor, back } = await who(f);
  const type = libraryType(str(f, "type"));
  if (!type) go(back, "err=type", "#library");
  const keys = f.getAll("pick").map(String);
  const picked = type!.services.filter((s) => keys.includes(s.key));
  if (!picked.length) go(back, `err=none&lib=${type!.key}`, "#library");
  const { list, added } = addFromLibrary(await load(tenantId), picked);
  if (added) await save(tenantId, actor, list, `Added ${added} services from the library (${type!.en})`);
  go(back, `done=library&n=${added}`);
}

/** Hides a service from bookings and the assistant, or offers it again. */
export async function toggleServiceAction(f: FormData) {
  const { tenantId, actor, back } = await who(f);
  const id = str(f, "id");
  const list = await load(tenantId);
  const s = list.find((x) => x.id === id);
  if (!s) go(back, "err=gone");
  await save(tenantId, actor, list.map((x) => (x.id === id ? { ...x, active: !x.active } : x)), `${s!.active ? "Hid" : "Showed"} the service "${s!.name}"`);
  go(back, `done=${s!.active ? "hidden" : "shown"}`, `#s-${id}`);
}

/** Deletes a service (tick box). Bookings already made keep the name they were made with. */
export async function deleteServiceAction(f: FormData) {
  const { tenantId, actor, back } = await who(f);
  const id = str(f, "id");
  if (f.get("confirm") !== "on") go(back, "err=confirm", `#s-${id}`);
  const list = await load(tenantId);
  const s = list.find((x) => x.id === id);
  if (!s) go(back, "err=gone");
  await save(tenantId, actor, list.filter((x) => x.id !== id), `Deleted the service "${s!.name}"`);
  go(back, "done=deleted");
}
