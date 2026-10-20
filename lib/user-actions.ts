"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getSession } from "./auth";
import { authAdmin } from "./auth-admin-supabase";
import * as store from "./data";
import { safePath } from "./format";
import { passwordProblem } from "./passwords";
import { supabaseConfigured, supabaseServer } from "./supabase";
import { demoMode } from "./demo-flag";
import * as users from "./users";
import { UserError, type UserActor, type UserDeps, type UserErrorCode } from "./users";
import type { Role } from "./types";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** What a form that hands out credentials shows after it runs. The password is in memory for this one response only. */
export interface UserActionState {
  error?: UserErrorCode;
  /** A new person, or a reset: show the sign-in details once. */
  credentials?: { email: string; fullName: string; password: string; generated: boolean; kind: "created" | "reset"; clientName?: string; loginPath: string };
}

/** Who is acting. Admins manage everyone; a client manager manages receptionists of their own client; anyone else is refused. */
async function context(): Promise<{ deps: UserDeps; actor: UserActor }> {
  const s = await getSession();
  if (!s || s.mustChangePassword) throw new UserError("forbidden");
  let actor: UserActor;
  if (s.role === "admin") actor = { role: "admin", label: "admin", userId: s.userId };
  else if (s.staffRole !== "receptionist") actor = { role: "manager", tenantId: s.tenantId, label: `staff:${s.tenantId}`, userId: s.userId };
  else throw new UserError("forbidden");
  const auth = authAdmin();
  if (!auth) throw new UserError("not_configured");
  return { deps: { auth, data: store }, actor };
}

const failed = (e: unknown): UserActionState => {
  if (e instanceof UserError) return { error: e.code };
  throw e;
};

const refresh = () => { revalidatePath("/admin/users"); revalidatePath("/app/team"); revalidatePath("/admin/clients", "layout"); };

export async function createUserAction(_prev: UserActionState, f: FormData): Promise<UserActionState> {
  try {
    const { deps, actor } = await context();
    const role = str(f, "role") as Role;
    const r = await users.createUser(deps, actor, { email: str(f, "email"), fullName: str(f, "fullName"), role, tenantId: str(f, "tenantId") || null, password: String(f.get("password") ?? "").trim() || undefined });
    refresh();
    const t = r.profile.tenantId ? await store.getTenant(r.profile.tenantId) : undefined;
    return { credentials: { email: r.profile.email, fullName: r.profile.fullName, password: r.password, generated: r.generated, kind: "created", clientName: t?.name, loginPath: t ? `/login?c=${t.slug}` : "/login" } };
  } catch (e) { return failed(e); }
}

export async function resetPasswordAction(_prev: UserActionState, f: FormData): Promise<UserActionState> {
  try {
    const { deps, actor } = await context();
    const r = await users.resetPassword(deps, actor, str(f, "userId"));
    refresh();
    const t = r.profile.tenantId ? await store.getTenant(r.profile.tenantId) : undefined;
    return { credentials: { email: r.profile.email, fullName: r.profile.fullName, password: r.password, generated: true, kind: "reset", loginPath: t ? `/login?c=${t.slug}` : "/login" } };
  } catch (e) { return failed(e); }
}

/** Runs a change that needs no output, then returns to the page it came from with a result in the address. */
async function change(f: FormData, fallback: string, run: (c: { deps: UserDeps; actor: UserActor }) => Promise<void>): Promise<never> {
  const to = safePath(f.get("returnTo"), fallback);
  const sep = to.includes("?") ? "&" : "?";
  let result = "saved=1";
  try { await run(await context()); } catch (e) { if (e instanceof UserError) result = `error=${e.code}`; else throw e; }
  refresh();
  redirect(`${to}${sep}${result}`);
}

export async function setUserDisabledAction(f: FormData) {
  await change(f, "/admin/users", ({ deps, actor }) => users.setDisabled(deps, actor, str(f, "userId"), f.get("disabled") === "1"));
}

export async function changeUserRoleAction(f: FormData) {
  await change(f, "/admin/users", ({ deps, actor }) => users.changeRole(deps, actor, str(f, "userId"), str(f, "role") as Role));
}

/** The admin must type the person's exact email; checked here, not only in the browser. */
export async function deleteUserAction(f: FormData) {
  await change(f, "/admin/users", async ({ deps, actor }) => {
    const p = await store.getProfile(str(f, "userId"));
    if (!p) throw new UserError("not_found");
    if (str(f, "confirmEmail").toLowerCase() !== p.email.toLowerCase()) throw new UserError("email_invalid");
    await users.deleteUser(deps, actor, p.id);
  });
}

export interface PasswordState { error?: "short" | "weak" | "mismatch" | "failed" | "demo" }

/** Changing your own password: needs only your own sign-in, not the secret key. Clears the "must change" flag. */
export async function changeOwnPasswordAction(_prev: PasswordState, f: FormData): Promise<PasswordState> {
  if (demoMode() || !supabaseConfigured()) return { error: "demo" };
  const s = await getSession();
  if (!s?.userId) return { error: "failed" };
  const pw = String(f.get("password") ?? "");
  if (pw !== String(f.get("confirm") ?? "")) return { error: "mismatch" };
  const problem = passwordProblem(pw);
  if (problem) return { error: problem };
  const { error } = await (await supabaseServer()).auth.updateUser({ password: pw });
  if (error) return { error: "failed" };
  await store.patchProfile(s.userId, { mustChangePassword: false }, s.role === "admin" ? "admin" : `staff:${s.role === "client" ? s.tenantId : ""}`, "Password changed");
  redirect(s.role === "admin" ? "/admin" : "/app");
}

/** Sends the reset email. Always answers the same way, so nobody can use this form to find out which addresses have accounts. */
export async function forgotPasswordAction(f: FormData) {
  const email = str(f, "email").toLowerCase();
  if (supabaseConfigured() && !demoMode() && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const origin = process.env.NEXT_PUBLIC_SITE_URL || (host ? `${h.get("x-forwarded-proto") ?? "https"}://${host}` : "");
    await (await supabaseServer()).auth.resetPasswordForEmail(email, { redirectTo: `${origin}/auth/callback?next=/account` }).catch(() => undefined);
  }
  redirect("/login/forgot?sent=1");
}
