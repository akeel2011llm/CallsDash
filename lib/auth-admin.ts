import { randomUUID } from "node:crypto";

/**
 * The part of Supabase Auth that creates and manages people. Passwords exist only inside it; CallsDash stores the
 * profile (role, client, name) next to it. Behind an interface so tests and demo mode can use the in-memory version.
 */
export interface AuthAdmin {
  /** Creates the sign-in. Throws EmailTakenError when the address already has one. */
  createUser(i: { email: string; password: string; fullName: string }): Promise<{ id: string }>;
  setPassword(userId: string, password: string): Promise<void>;
  /** Changes the sign-in email (confirmed at once: the admin vouches for it) and the name kept with it. Throws EmailTakenError. */
  updateUser(userId: string, i: { email?: string; fullName?: string }): Promise<void>;
  /** A banned person cannot sign in or refresh a session; their existing access token still expires on its own. */
  setBanned(userId: string, banned: boolean): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  /** When each person last signed in (ISO), keyed by user id. Missing = never. */
  lastSignIns(userIds: string[]): Promise<Record<string, string | undefined>>;
}

export class EmailTakenError extends Error {
  constructor() { super("email_taken"); }
}

/** `lenient` ignores people it never created, which is what demo mode needs (its sample users have no sign-in). */
export function createFakeAuthAdmin(opts: { lenient?: boolean } = {}): AuthAdmin & { users: Map<string, { email: string; password: string; banned: boolean }> } {
  const users = new Map<string, { email: string; password: string; banned: boolean }>();
  return {
    users,
    async createUser({ email, password }) {
      if ([...users.values()].some((u) => u.email.toLowerCase() === email.toLowerCase())) throw new EmailTakenError();
      const id = randomUUID();
      users.set(id, { email, password, banned: false });
      return { id };
    },
    async updateUser(id, { email }) {
      const u = users.get(id);
      if (email && [...users.entries()].some(([k, x]) => k !== id && x.email.toLowerCase() === email.toLowerCase())) throw new EmailTakenError();
      if (u) { if (email) u.email = email; } else if (!opts.lenient) throw new Error("no such user");
    },
    async setPassword(id, password) { const u = users.get(id); if (u) u.password = password; else if (!opts.lenient) throw new Error("no such user"); },
    async setBanned(id, banned) { const u = users.get(id); if (u) u.banned = banned; else if (!opts.lenient) throw new Error("no such user"); },
    async deleteUser(id) { users.delete(id); },
    async lastSignIns() { return {}; },
  };
}
