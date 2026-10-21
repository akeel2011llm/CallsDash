import "server-only";
import { createClient } from "@supabase/supabase-js";
import { demoMode } from "./demo-flag";
import { createFakeAuthAdmin, EmailTakenError, type AuthAdmin } from "./auth-admin";
import { supabaseUrl } from "./supabase-env";

/** The secret key from Supabase (Settings, API Keys). Never sent to the browser. The older name "service_role" works too. */
const secretKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

export const authAdminConfigured = () => Boolean(supabaseUrl() && secretKey());

const BAN_FOREVER = "876000h"; // 100 years: Supabase has no "banned" flag, only a duration

function supabaseAuthAdmin(): AuthAdmin {
  const sb = createClient(supabaseUrl()!, secretKey()!, { auth: { autoRefreshToken: false, persistSession: false } });
  const fail = (e: { message: string } | null) => { if (e) throw new Error(e.message); };
  return {
    async createUser({ email, password, fullName }) {
      const { data, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
      if (error) {
        if (/already|registered|exists/i.test(error.message)) throw new EmailTakenError();
        throw new Error(error.message);
      }
      return { id: data.user.id };
    },
    async updateUser(id, { email, fullName }) {
      const { error } = await sb.auth.admin.updateUserById(id, {
        ...(email ? { email, email_confirm: true } : {}),
        ...(fullName ? { user_metadata: { full_name: fullName } } : {}),
      });
      if (error) {
        if (/already|registered|exists/i.test(error.message)) throw new EmailTakenError();
        throw new Error(error.message);
      }
    },
    async setPassword(id, password) { fail((await sb.auth.admin.updateUserById(id, { password })).error); },
    async setBanned(id, banned) { fail((await sb.auth.admin.updateUserById(id, { ban_duration: banned ? BAN_FOREVER : "none" })).error); },
    async deleteUser(id) { fail((await sb.auth.admin.deleteUser(id)).error); },
    async lastSignIns(ids) {
      const out: Record<string, string | undefined> = {};
      await Promise.all(ids.map(async (id) => {
        const { data } = await sb.auth.admin.getUserById(id);
        out[id] = data.user?.last_sign_in_at ?? undefined;
      }));
      return out;
    },
  };
}

const g = globalThis as unknown as { __callsdashFakeAuth?: AuthAdmin };

/** Real Supabase when the secret key is set; an in-memory stand-in in demo mode; otherwise null (the pages say what is missing). */
export function authAdmin(): AuthAdmin | null {
  if (demoMode()) return (g.__callsdashFakeAuth ??= createFakeAuthAdmin({ lenient: true }));
  return authAdminConfigured() ? supabaseAuthAdmin() : null;
}
