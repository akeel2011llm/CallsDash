import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTenant } from "./store";
import type { Session, Tenant } from "./types";

/**
 * Demo sign-in: a plain cookie, only honoured while DEMO_MODE=true. Production auth is Supabase Auth
 * with the role and tenant read from the users table (see supabase/migrations/0001_init.sql).
 */
export const demoMode = () => process.env.DEMO_MODE === "true";

export async function getSession(): Promise<Session | null> {
  if (!demoMode()) return null;
  const jar = await cookies();
  const v = jar.get("cd_session")?.value;
  if (v === "admin") return { role: "admin", viewAsTenantId: jar.get("cd_view")?.value };
  if (v?.startsWith("client:")) {
    const tenantId = v.slice(7);
    return getTenant(tenantId) ? { role: "client", tenantId } : null;
  }
  return null;
}

export async function requireAdmin() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.role !== "admin") redirect("/app");
  return { session: s, actor: "admin" };
}

export async function requireClient(): Promise<{ tenant: Tenant; actor: string; viewingAsAdmin: boolean }> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.role === "client") return { tenant: getTenant(s.tenantId)!, actor: `staff:${s.tenantId}`, viewingAsAdmin: false };
  const t = s.viewAsTenantId ? getTenant(s.viewAsTenantId) : undefined;
  if (!t) redirect("/admin");
  return { tenant: t, actor: "admin (view as client)", viewingAsAdmin: true };
}
