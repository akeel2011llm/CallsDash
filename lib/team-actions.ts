"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession, requireAdmin, requireSection } from "./auth";
import * as store from "./data";
import { autoSync } from "./auto-sync";
import { MAX_DEPARTMENTS, MAX_ROLES, businessOf, departmentsOf, roleKey, rolesOf, type Department, type Role } from "./business-types";
import { findDepartmentByName, findRoleByName, libraryDepartment, libraryRole } from "./team-library";
import type { Tenant } from "./types";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").replace(/\s+/g, " ").trim();
const cut = (s: string, n = 40) => s.slice(0, n);
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The admin for any client (Business > Roles and departments), or a client's manager for their own (Bookings > Roles). */
async function who(f: FormData): Promise<{ tenant: Tenant; actor: string; back: string }> {
  const s = await getSession();
  if (s?.role === "admin" && !s.viewAsTenantId) {
    const { actor } = await requireAdmin();
    const tenant = await store.getTenant(str(f, "tenantId"));
    if (!tenant) redirect("/admin");
    return { tenant, actor, back: `/admin/clients/${tenant.id}/business/team` };
  }
  const c = await requireSection("bookings");
  if (c.staffRole !== "manager") redirect("/app/roles?err=manager");
  return { tenant: c.tenant, actor: c.actor, back: "/app/roles" };
}

const go = (back: string, q: string, hash = ""): never => redirect(`${back}?${q}${hash}`);

async function saveBusiness(tenant: Tenant, actor: string, patch: { roles?: Role[]; departments?: Department[] }, note: string) {
  await store.setBusiness(tenant.id, { ...businessOf(tenant), ...patch }, actor, note);
  await autoSync(tenant.id, actor).catch(() => undefined); // the assistant's instructions name the roles and departments
  revalidatePath("/app", "layout");
  revalidatePath(`/admin/clients/${tenant.id}`, "layout");
}

/* ---------- roles ---------- */

/** The four names of a role from the form; blanks are filled from the library when the name is known there. */
function roleNames(f: FormData): Omit<Role, "key"> | null {
  let one = cut(str(f, "one")), many = cut(str(f, "many")), oneAr = cut(str(f, "oneAr")), manyAr = cut(str(f, "manyAr"));
  const known = findRoleByName(one) ?? findRoleByName(oneAr);
  if (known) {
    one ||= known.one;
    oneAr ||= known.oneAr;
    if (!many && same(one, known.one)) many = known.many;
    if (!manyAr && oneAr === known.oneAr) manyAr = known.manyAr;
  }
  if (!one) one = oneAr;
  if (!one) return null;
  return { one, many: many || `${one}s`, oneAr: oneAr || one, manyAr: manyAr || oneAr || many || `${one}s` };
}

/** Adds a role (no `key`), or saves the names of one. */
export async function saveRoleAction(f: FormData) {
  const { tenant, actor, back } = await who(f);
  const key = str(f, "key");
  const names = roleNames(f);
  if (!names) go(back, "err=name", key ? `#role-${key}` : "#role-new");
  const roles = rolesOf(tenant);
  const clash = roles.find((r) => r.key !== key && (same(r.one, names!.one) || (names!.oneAr && same(r.oneAr, names!.oneAr))));
  if (clash) go(back, `err=same&who=${encodeURIComponent(names!.one)}`, key ? `#role-${key}` : "#role-new");
  if (key) {
    if (!roles.some((r) => r.key === key)) go(back, "err=gone", "#roles");
    await saveBusiness(tenant, actor, { roles: roles.map((r) => (r.key === key ? { ...r, ...names! } : r)) }, `Edited the role "${names!.one}"`);
    go(back, "done=saved", `#role-${key}`);
  }
  if (roles.length >= MAX_ROLES) go(back, "err=full", "#role-new");
  const newKey = roleKey(names!.one, roles.map((r) => r.key));
  await saveBusiness(tenant, actor, { roles: [...roles, { key: newKey, ...names! }] }, `Added the role "${names!.one}"`);
  go(back, "done=added", `#role-${newKey}`);
}

/** Adds the ticked library roles; names the client already has are skipped. */
export async function addLibraryRolesAction(f: FormData) {
  const { tenant, actor, back } = await who(f);
  const picked = f.getAll("pick").map(String).map(libraryRole).filter((r) => r !== undefined);
  if (!picked.length) go(back, "err=none", "#roles-library");
  const roles = rolesOf(tenant);
  let added = 0;
  for (const r of picked) {
    if (roles.length >= MAX_ROLES) break;
    if (roles.some((x) => same(x.one, r.one) || same(x.oneAr, r.oneAr))) continue;
    roles.push({ key: roleKey(r.one, roles.map((x) => x.key)), one: r.one, many: r.many, oneAr: r.oneAr, manyAr: r.manyAr });
    added++;
  }
  if (added) await saveBusiness(tenant, actor, { roles }, `Added ${added} roles from the library`);
  go(back, `done=library&n=${added}`, "#roles");
}

/** Makes a role the first one: people saved without a role, and new people by default, get it. */
export async function firstRoleAction(f: FormData) {
  const { tenant, actor, back } = await who(f);
  const key = str(f, "key");
  const roles = rolesOf(tenant);
  const r = roles.find((x) => x.key === key);
  if (!r) go(back, "err=gone", "#roles");
  // people with no stored role followed the old first role: keep them on it
  const old = roles[0].key;
  for (const d of (await store.getDoctors(tenant.id)).filter((x) => !x.role)) await store.updateDoctor(tenant.id, d.id, { role: old }, actor);
  await saveBusiness(tenant, actor, { roles: [r!, ...roles.filter((x) => x.key !== key)] }, `Made "${r!.one}" the main role`);
  go(back, "done=first", `#role-${key}`);
}

/** Deletes a role nobody has (tick box). The last role cannot go: every team member needs one. */
export async function deleteRoleAction(f: FormData) {
  const { tenant, actor, back } = await who(f);
  const key = str(f, "key");
  if (f.get("confirm") !== "on") go(back, "err=confirm", `#role-${key}`);
  const roles = rolesOf(tenant);
  const r = roles.find((x) => x.key === key);
  if (!r) go(back, "err=gone", "#roles");
  if (roles.length === 1) go(back, "err=last", `#role-${key}`);
  const user = (await store.getDoctors(tenant.id)).find((d) => (d.role ?? roles[0].key) === key);
  if (user) go(back, `err=in_use&who=${encodeURIComponent(user.name.slice(0, 60))}`, `#role-${key}`);
  await saveBusiness(tenant, actor, { roles: roles.filter((x) => x.key !== key) }, `Deleted the role "${r!.one}"`);
  go(back, "done=deleted", "#roles");
}

/* ---------- departments ---------- */

function departmentNames(f: FormData): Omit<Department, "key"> | null {
  let en = cut(str(f, "en"), 60), ar = cut(str(f, "ar"), 60);
  const known = findDepartmentByName(en) ?? findDepartmentByName(ar);
  if (known) { en = en || known.en; ar = ar || known.ar; }
  if (!en) en = ar;
  if (!en) return null;
  const about = String(f.get("about") ?? "").trim().slice(0, 300);
  return { en, ar: ar || en, ...(about ? { about } : {}) };
}

/** Adds a department (no `key`), or saves one: its names, what it does, and who works in it (ticked team members). */
export async function saveDepartmentAction(f: FormData) {
  const { tenant, actor, back } = await who(f);
  const key = str(f, "key");
  const names = departmentNames(f);
  if (!names) go(back, "err=dname", key ? `#dept-${key}` : "#dept-new");
  const list = departmentsOf(tenant);
  if (list.some((d) => d.key !== key && (same(d.en, names!.en) || same(d.ar, names!.ar)))) go(back, `err=dsame&who=${encodeURIComponent(names!.en)}`, key ? `#dept-${key}` : "#dept-new");
  let target = key;
  if (key) {
    if (!list.some((d) => d.key === key)) go(back, "err=gone", "#departments");
    await saveBusiness(tenant, actor, { departments: list.map((d) => (d.key === key ? { key, ...names! } : d)) }, `Edited the department "${names!.en}"`);
  } else {
    if (list.length >= MAX_DEPARTMENTS) go(back, "err=dfull", "#dept-new");
    target = roleKey(names!.en, list.map((d) => d.key));
    await saveBusiness(tenant, actor, { departments: [...list, { key: target, ...names! }] }, `Added the department "${names!.en}"`);
  }
  if (f.has("membersShown")) {
    const ticked = new Set(f.getAll("member").map(String));
    for (const d of await store.getDoctors(tenant.id)) {
      if (ticked.has(d.id) && d.department !== target) await store.updateDoctor(tenant.id, d.id, { department: target }, actor);
      else if (!ticked.has(d.id) && d.department === target) await store.updateDoctor(tenant.id, d.id, { department: undefined }, actor);
    }
  }
  go(back, key ? "done=dsaved" : "done=dadded", `#dept-${target}`);
}

/** Adds the ticked library departments; names the client already has are skipped. */
export async function addLibraryDepartmentsAction(f: FormData) {
  const { tenant, actor, back } = await who(f);
  const picked = f.getAll("pick").map(String).map(libraryDepartment).filter((d) => d !== undefined);
  if (!picked.length) go(back, "err=dnone", "#departments-library");
  const list = departmentsOf(tenant);
  let added = 0;
  for (const d of picked) {
    if (list.length >= MAX_DEPARTMENTS) break;
    if (list.some((x) => same(x.en, d.en) || same(x.ar, d.ar))) continue;
    list.push({ key: roleKey(d.en, list.map((x) => x.key)), en: d.en, ar: d.ar });
    added++;
  }
  if (added) await saveBusiness(tenant, actor, { departments: list }, `Added ${added} departments from the library`);
  go(back, `done=dlibrary&n=${added}`, "#departments");
}

/** Deletes a department (tick box). Its people stay, with no department. */
export async function deleteDepartmentAction(f: FormData) {
  const { tenant, actor, back } = await who(f);
  const key = str(f, "key");
  if (f.get("confirm") !== "on") go(back, "err=confirm", `#dept-${key}`);
  const list = departmentsOf(tenant);
  const d = list.find((x) => x.key === key);
  if (!d) go(back, "err=gone", "#departments");
  for (const doc of (await store.getDoctors(tenant.id)).filter((x) => x.department === key)) await store.updateDoctor(tenant.id, doc.id, { department: undefined }, actor);
  await saveBusiness(tenant, actor, { departments: list.filter((x) => x.key !== key) }, `Deleted the department "${d!.en}"`);
  go(back, "done=ddeleted", "#departments");
}
