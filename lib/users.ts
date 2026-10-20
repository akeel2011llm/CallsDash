import { EmailTakenError, type AuthAdmin } from "./auth-admin";
import { DuplicateError } from "./errors";
import { generatePassword, passwordProblem } from "./passwords";
import type { Profile, Role } from "./types";
import type { Data } from "./data/demo";

/** Why a user action was refused. Pages turn these into messages. */
export type UserErrorCode =
  | "email_invalid" | "email_taken" | "name_missing" | "password_short" | "password_weak" | "forbidden"
  | "unknown_client" | "role_invalid" | "last_admin" | "self" | "not_found" | "not_configured";

export class UserError extends Error {
  constructor(public code: UserErrorCode) { super(code); }
}

/** Who is doing it. An admin can manage everyone; a client manager can manage receptionists of their own client. */
export interface UserActor {
  role: "admin" | "manager";
  /** Required for a manager. */
  tenantId?: string;
  /** Written in the activity log. */
  label: string;
  /** The actor's own user id when they are a real signed-in person. */
  userId?: string;
}

export interface UserDeps {
  auth: AuthAdmin;
  data: Pick<Data, "getProfile" | "listProfiles" | "saveProfile" | "patchProfile" | "removeProfile" | "getTenant">;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const normalizeEmail = (s: string) => s.trim().toLowerCase();

/** Admin: anyone. Manager: receptionists of their own client, never themselves and never other managers. */
export function canManage(actor: UserActor, target: Profile): boolean {
  if (actor.role === "admin") return true;
  return actor.tenantId != null && target.tenantId === actor.tenantId && target.role === "receptionist" && target.id !== actor.userId;
}

async function target(d: UserDeps, actor: UserActor, userId: string): Promise<Profile> {
  const p = await d.data.getProfile(userId);
  if (!p) throw new UserError("not_found");
  if (!canManage(actor, p)) throw new UserError("forbidden");
  return p;
}

/** Stops the last working admin from being disabled or deleted, which would lock everyone out of the admin portal. */
async function assertNotLastAdmin(d: UserDeps, p: Profile) {
  if (p.role !== "admin") return;
  const others = (await d.data.listProfiles()).filter((x) => x.role === "admin" && !x.disabled && x.id !== p.id);
  if (others.length === 0) throw new UserError("last_admin");
}

export interface CreateUserInput { email: string; fullName: string; role: Role; tenantId?: string | null; password?: string }

/**
 * Creates the sign-in and the profile. Without a password a temporary one is generated; either way the person must
 * choose their own at first sign-in. The password is returned once so the admin can pass it on; it is never stored here.
 */
export async function createUser(d: UserDeps, actor: UserActor, input: CreateUserInput): Promise<{ profile: Profile; password: string; generated: boolean }> {
  const email = normalizeEmail(input.email);
  if (!EMAIL.test(email)) throw new UserError("email_invalid");
  const fullName = input.fullName.trim().replace(/\s+/g, " ").slice(0, 120);
  if (!fullName) throw new UserError("name_missing");
  if (!(["admin", "manager", "receptionist"] as const).includes(input.role)) throw new UserError("role_invalid");
  let tenantId: string | null = input.role === "admin" ? null : (input.tenantId ?? null);
  if (actor.role === "manager") {
    if (input.role !== "receptionist" || !actor.tenantId) throw new UserError("forbidden");
    tenantId = actor.tenantId;
  }
  if (input.role !== "admin" && (!tenantId || !(await d.data.getTenant(tenantId)))) throw new UserError("unknown_client");
  const generated = !input.password;
  const password = input.password || generatePassword();
  if (!generated) { const problem = passwordProblem(password); if (problem) throw new UserError(problem === "short" ? "password_short" : "password_weak"); }
  if ((await d.data.listProfiles()).some((p) => p.email.toLowerCase() === email)) throw new UserError("email_taken");

  let id: string;
  try { id = (await d.auth.createUser({ email, password, fullName })).id; }
  catch (e) { if (e instanceof EmailTakenError) throw new UserError("email_taken"); throw e; }
  const profile: Profile = { id, tenantId, role: input.role, fullName, email, disabled: false, mustChangePassword: true, createdAt: new Date().toISOString() };
  try { await d.data.saveProfile(profile, actor.label); }
  catch (e) {
    await d.auth.deleteUser(id).catch(() => undefined); // do not leave a sign-in nobody can use
    if (e instanceof DuplicateError) throw new UserError("email_taken");
    throw e;
  }
  return { profile, password, generated };
}

/** A fresh temporary password. The person must change it at next sign-in. */
export async function resetPassword(d: UserDeps, actor: UserActor, userId: string): Promise<{ profile: Profile; password: string }> {
  const p = await target(d, actor, userId);
  const password = generatePassword();
  await d.auth.setPassword(p.id, password);
  await d.data.patchProfile(p.id, { mustChangePassword: true }, actor.label, "Password reset");
  return { profile: { ...p, mustChangePassword: true }, password };
}

export async function setDisabled(d: UserDeps, actor: UserActor, userId: string, disabled: boolean) {
  const p = await target(d, actor, userId);
  if (p.id === actor.userId) throw new UserError("self");
  if (disabled) await assertNotLastAdmin(d, p);
  await d.auth.setBanned(p.id, disabled);
  await d.data.patchProfile(p.id, { disabled }, actor.label, disabled ? "User disabled" : "User enabled");
}

/** Switches a client person between manager and receptionist. Admin only; admins keep their role. */
export async function changeRole(d: UserDeps, actor: UserActor, userId: string, role: Role) {
  if (actor.role !== "admin") throw new UserError("forbidden");
  const p = await target(d, actor, userId);
  if (p.role === "admin" || role === "admin") throw new UserError("role_invalid");
  if (role !== "manager" && role !== "receptionist") throw new UserError("role_invalid");
  await d.data.patchProfile(p.id, { role }, actor.label, `Role changed to ${role}`);
}

export async function deleteUser(d: UserDeps, actor: UserActor, userId: string) {
  const p = await target(d, actor, userId);
  if (p.id === actor.userId) throw new UserError("self");
  await assertNotLastAdmin(d, p);
  await d.auth.deleteUser(p.id);
  await d.data.removeProfile(p.id, actor.label);
}

/** What the manager's Team page and the admin Users page list: people plus when each last signed in. */
export async function listUsers(d: UserDeps, tenantId?: string): Promise<(Profile & { lastSignIn?: string })[]> {
  const people = await d.data.listProfiles(tenantId);
  const seen = await d.auth.lastSignIns(people.map((p) => p.id)).catch(() => ({} as Record<string, string | undefined>));
  return people.map((p) => ({ ...p, lastSignIn: seen[p.id] }));
}
