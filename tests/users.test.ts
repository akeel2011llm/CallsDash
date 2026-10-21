import { describe, expect, it } from "vitest";
import { createFakeAuthAdmin } from "@/lib/auth-admin";
import { generatePassword, passwordProblem } from "@/lib/passwords";
import { UserError, canManage, changeRole, createUser, deleteUser, listUsers, resetPassword, setDisabled, type UserActor, type UserDeps } from "@/lib/users";
import { createPgData, type Db, type Q } from "@/lib/data/pg";
import { makeDb } from "./helpers/pgdb";

async function setup() {
  const pg = await makeDb();
  const q: Q = async (sql, params) => (await pg.query(sql, params as unknown[])).rows as never;
  const db: Db = { q, tx: (fn) => pg.transaction((tx) => fn(async (sql, params) => (await tx.query(sql, params as unknown[])).rows as never)) };
  const data = createPgData(db);
  // like Supabase, the sign-in row exists before the profile that points at it, and deleting it removes the profile
  const fake = createFakeAuthAdmin();
  const auth: typeof fake = {
    ...fake,
    createUser: async (i) => { const u = await fake.createUser(i); await pg.query(`insert into auth.users (id, email) values ($1,$2)`, [u.id, i.email]); return u; },
    deleteUser: async (id) => { await fake.deleteUser(id); await pg.query(`delete from auth.users where id = $1`, [id]); },
  };
  const a = await data.createTenant({ name: "Clinic A", nameAr: "", color: "#112233", domain: "a.bh", planType: "package", actor: "admin" });
  const b = await data.createTenant({ name: "Clinic B", nameAr: "", color: "#112233", domain: "b.bh", planType: "package", actor: "admin" });
  const deps: UserDeps = { auth, data };
  const admin: UserActor = { role: "admin", label: "admin" };
  return { pg, data, auth, deps, admin, a, b };
}
const fails = (p: Promise<unknown>, code: string) => expect(p).rejects.toMatchObject({ code });

describe("passwords", () => {
  it("generates readable, different, acceptable passwords", () => {
    const a = generatePassword(), b = generatePassword();
    expect(a).toMatch(/^[a-zA-Z2-9]{4}-[a-zA-Z2-9]{4}-[a-zA-Z2-9]{4}$/);
    expect(a).not.toBe(b);
    expect(passwordProblem(a)).toBeNull();
  });
  it("rejects short and obvious ones", () => {
    expect(passwordProblem("short1")).toBe("short");
    expect(passwordProblem("aaaaaaaaaaaa")).toBe("weak");
    expect(passwordProblem("Password12345")).toBe("weak");
    expect(passwordProblem("a good long passphrase")).toBeNull();
  });
});

describe("user management", () => {
  it("creates a client manager with a temporary password that must be changed", async () => {
    const { deps, admin, a, auth, data } = await setup();
    const r = await createUser(deps, admin, { email: " Sara@A.bh ", fullName: "  Sara  Ali ", role: "manager", tenantId: a.id });
    expect(r.generated).toBe(true);
    expect(r.profile).toMatchObject({ email: "sara@a.bh", fullName: "Sara Ali", role: "manager", tenantId: a.id, mustChangePassword: true, disabled: false });
    expect(auth.users.get(r.profile.id)?.password).toBe(r.password);
    expect(await data.getProfile(r.profile.id)).toMatchObject({ email: "sara@a.bh", role: "manager" });
    expect((await data.getAudit(a.id)).some((e) => e.action.includes("User created: sara@a.bh"))).toBe(true);
  });
  it("creates an admin without a client, and refuses a client person without one", async () => {
    const { deps, admin } = await setup();
    const r = await createUser(deps, admin, { email: "boss@x.com", fullName: "Boss", role: "admin", tenantId: "ignored" });
    expect(r.profile.tenantId).toBeNull();
    await fails(createUser(deps, admin, { email: "n@x.com", fullName: "N", role: "manager" }), "unknown_client");
    await fails(createUser(deps, admin, { email: "n@x.com", fullName: "N", role: "manager", tenantId: "00000000-0000-0000-0000-000000000000" }), "unknown_client");
  });
  it("validates input", async () => {
    const { deps, admin, a } = await setup();
    await fails(createUser(deps, admin, { email: "nope", fullName: "N", role: "manager", tenantId: a.id }), "email_invalid");
    await fails(createUser(deps, admin, { email: "n@x.com", fullName: " ", role: "manager", tenantId: a.id }), "name_missing");
    await fails(createUser(deps, admin, { email: "n@x.com", fullName: "N", role: "manager", tenantId: a.id, password: "short" }), "password_short");
    await fails(createUser(deps, admin, { email: "n@x.com", fullName: "N", role: "root" as never, tenantId: a.id }), "role_invalid");
  });
  it("accepts a password the admin chose", async () => {
    const { deps, admin, a, auth } = await setup();
    const r = await createUser(deps, admin, { email: "n@x.com", fullName: "N", role: "receptionist", tenantId: a.id, password: "a good long passphrase" });
    expect(r.generated).toBe(false);
    expect(auth.users.get(r.profile.id)?.password).toBe("a good long passphrase");
  });
  it("refuses a second account for the same email, whatever the capitalisation, and leaves no stray sign-in", async () => {
    const { deps, admin, a, b, auth } = await setup();
    await createUser(deps, admin, { email: "dup@x.com", fullName: "One", role: "manager", tenantId: a.id });
    await fails(createUser(deps, admin, { email: "DUP@x.com", fullName: "Two", role: "manager", tenantId: b.id }), "email_taken");
    expect(auth.users.size).toBe(1);
  });
  it("removes the sign-in again if the profile cannot be saved", async () => {
    const { deps, admin, a, auth } = await setup();
    const broken: UserDeps = { auth, data: { ...deps.data, saveProfile: async () => { throw new Error("db down"); } } };
    await expect(createUser(broken, admin, { email: "x@x.com", fullName: "X", role: "manager", tenantId: a.id })).rejects.toThrow("db down");
    expect(auth.users.size).toBe(0);
  });

  it("lets a client manager add receptionists to their own client only", async () => {
    const { deps, admin, a, b } = await setup();
    const mgr = await createUser(deps, admin, { email: "m@a.bh", fullName: "M", role: "manager", tenantId: a.id });
    const actor: UserActor = { role: "manager", tenantId: a.id, label: "staff", userId: mgr.profile.id };
    const r = await createUser(deps, actor, { email: "r@a.bh", fullName: "R", role: "receptionist", tenantId: b.id }); // tenantId from the form is ignored
    expect(r.profile.tenantId).toBe(a.id);
    await fails(createUser(deps, actor, { email: "m2@a.bh", fullName: "M2", role: "manager" }), "forbidden");
    await fails(createUser(deps, actor, { email: "a2@a.bh", fullName: "A2", role: "admin" }), "forbidden");
  });
  it("keeps managers away from other clients, other managers and themselves", async () => {
    const { deps, admin, a, b } = await setup();
    const mgr = await createUser(deps, admin, { email: "m@a.bh", fullName: "M", role: "manager", tenantId: a.id });
    const mgr2 = await createUser(deps, admin, { email: "m2@a.bh", fullName: "M2", role: "manager", tenantId: a.id });
    const other = await createUser(deps, admin, { email: "r@b.bh", fullName: "R", role: "receptionist", tenantId: b.id });
    const mine = await createUser(deps, admin, { email: "r@a.bh", fullName: "R", role: "receptionist", tenantId: a.id });
    const actor: UserActor = { role: "manager", tenantId: a.id, label: "staff", userId: mgr.profile.id };
    await fails(resetPassword(deps, actor, other.profile.id), "forbidden");
    await fails(resetPassword(deps, actor, mgr2.profile.id), "forbidden");
    await fails(setDisabled(deps, actor, mgr.profile.id, true), "forbidden");
    await fails(deleteUser(deps, actor, other.profile.id), "forbidden");
    await fails(changeRole(deps, actor, mine.profile.id, "manager"), "forbidden");
    expect(canManage(actor, (await deps.data.getProfile(mine.profile.id))!)).toBe(true);
    await resetPassword(deps, actor, mine.profile.id);
  });

  it("resets a password and forces a change", async () => {
    const { deps, admin, a, auth, data } = await setup();
    const u = await createUser(deps, admin, { email: "u@a.bh", fullName: "U", role: "manager", tenantId: a.id });
    await data.patchProfile(u.profile.id, { mustChangePassword: false }, "u", "Password changed");
    const r = await resetPassword(deps, admin, u.profile.id);
    expect(r.password).not.toBe(u.password);
    expect(auth.users.get(u.profile.id)?.password).toBe(r.password);
    expect((await data.getProfile(u.profile.id))?.mustChangePassword).toBe(true);
    await fails(resetPassword(deps, admin, "00000000-0000-0000-0000-000000000000"), "not_found");
  });
  it("disables and re-enables, banning the sign-in as well", async () => {
    const { deps, admin, a, auth, data } = await setup();
    const u = await createUser(deps, admin, { email: "u@a.bh", fullName: "U", role: "receptionist", tenantId: a.id });
    await setDisabled(deps, admin, u.profile.id, true);
    expect((await data.getProfile(u.profile.id))?.disabled).toBe(true);
    expect(auth.users.get(u.profile.id)?.banned).toBe(true);
    await setDisabled(deps, admin, u.profile.id, false);
    expect((await data.getProfile(u.profile.id))?.disabled).toBe(false);
    expect(auth.users.get(u.profile.id)?.banned).toBe(false);
  });
  it("never lets the last admin be disabled or deleted, and never yourself", async () => {
    const { deps, admin } = await setup();
    const one = await createUser(deps, admin, { email: "one@x.com", fullName: "One", role: "admin" });
    await fails(setDisabled(deps, admin, one.profile.id, true), "last_admin");
    await fails(deleteUser(deps, admin, one.profile.id), "last_admin");
    const two = await createUser(deps, admin, { email: "two@x.com", fullName: "Two", role: "admin" });
    const me: UserActor = { role: "admin", label: "one", userId: one.profile.id };
    await fails(setDisabled(deps, me, one.profile.id, true), "self");
    await fails(deleteUser(deps, me, one.profile.id), "self");
    await setDisabled(deps, me, two.profile.id, true);
    await fails(setDisabled(deps, { ...me, userId: two.profile.id }, one.profile.id, true), "last_admin"); // two is disabled, so one is the only working admin
  });
  it("changes a client person's role, but not an admin's", async () => {
    const { deps, admin, a, data } = await setup();
    const u = await createUser(deps, admin, { email: "u@a.bh", fullName: "U", role: "receptionist", tenantId: a.id });
    await changeRole(deps, admin, u.profile.id, "manager");
    expect((await data.getProfile(u.profile.id))?.role).toBe("manager");
    const boss = await createUser(deps, admin, { email: "boss@x.com", fullName: "B", role: "admin" });
    await fails(changeRole(deps, admin, boss.profile.id, "manager"), "role_invalid");
    await fails(changeRole(deps, admin, u.profile.id, "admin"), "role_invalid");
  });
  it("deletes the sign-in and the profile", async () => {
    const { deps, admin, a, auth, data } = await setup();
    const u = await createUser(deps, admin, { email: "u@a.bh", fullName: "U", role: "receptionist", tenantId: a.id });
    await deleteUser(deps, admin, u.profile.id);
    expect(auth.users.size).toBe(0);
    expect(await data.getProfile(u.profile.id)).toBeUndefined();
  });
  it("lists people with their last sign-in, per client or for everyone", async () => {
    const { deps, admin, a, b } = await setup();
    await createUser(deps, admin, { email: "a@a.bh", fullName: "A", role: "manager", tenantId: a.id });
    await createUser(deps, admin, { email: "b@b.bh", fullName: "B", role: "manager", tenantId: b.id });
    expect((await listUsers(deps)).length).toBe(2);
    expect((await listUsers(deps, a.id)).map((p) => p.email)).toEqual(["a@a.bh"]);
  });
  it("disabling a client's profile is enough to lock them out through the data layer", async () => {
    const { deps, admin, a, data } = await setup();
    const u = await createUser(deps, admin, { email: "u@a.bh", fullName: "U", role: "manager", tenantId: a.id });
    await setDisabled(deps, admin, u.profile.id, true);
    expect((await data.getProfile(u.profile.id))?.disabled).toBe(true); // lib/auth.ts getSession returns null for this
  });
  it("creates a doctor sign-in tied to one doctor of the client, and a manager may do it for their own client", async () => {
    const { deps, admin, a, b, data, pg } = await setup();
    const docA = (await data.addDoctor(a.id, { name: "Dr. A", specialty: "" }, "admin")).id;
    const docB = (await data.addDoctor(b.id, { name: "Dr. B", specialty: "" }, "admin")).id;
    const r = await createUser(deps, admin, { email: "dr.a@a.bh", fullName: "Dr A", role: "doctor", tenantId: a.id, doctorId: docA });
    expect(await data.getProfile(r.profile.id)).toMatchObject({ role: "doctor", tenantId: a.id, doctorId: docA });
    await fails(createUser(deps, admin, { email: "x@a.bh", fullName: "X", role: "doctor", tenantId: a.id }), "doctor_missing");
    await fails(createUser(deps, admin, { email: "x@a.bh", fullName: "X", role: "doctor", tenantId: a.id, doctorId: docB }), "doctor_missing"); // another client's doctor
    await fails(createUser(deps, admin, { email: "y@a.bh", fullName: "Y", role: "doctor", tenantId: a.id, doctorId: docA }), "doctor_taken");
    const manager: UserActor = { role: "manager", tenantId: a.id, label: "staff" };
    const docA2 = (await data.addDoctor(a.id, { name: "Dr. A2", specialty: "" }, "admin")).id;
    const m = await createUser(deps, manager, { email: "dr.a2@a.bh", fullName: "Dr A2", role: "doctor", doctorId: docA2 });
    expect(m.profile.tenantId).toBe(a.id);
    expect(canManage(manager, m.profile)).toBe(true);
    await fails(changeRole(deps, admin, m.profile.id, "manager"), "role_invalid");
    // removing the doctor leaves the sign-in without a doctor, which the session check refuses
    await pg.query(`delete from doctors where id = $1`, [docA2]);
    expect((await data.getProfile(m.profile.id))?.doctorId).toBeNull();
  });
});
