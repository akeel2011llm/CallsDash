import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { demoMode } from "./demo-flag";
import { getProfile, getTenant } from "./data";
import { supabaseConfigured, supabaseServer } from "./supabase";
import type { Session, Tenant } from "./types";

/**
 * Demo sign-in: a plain cookie, only honoured while DEMO_MODE=true. Production auth is Supabase Auth
 * with the role and tenant read from the users table (see supabase/migrations/0001_init.sql).
 */
export { demoMode };

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  if (!demoMode()) {
    if (!supabaseConfigured()) return null;
    // Verified locally against Supabase's published signing keys: no extra network call per page.
    const { data } = await (await supabaseServer()).auth.getClaims();
    const userId = data?.claims?.sub;
    const profile = userId ? await getProfile(userId) : undefined;
    // A disabled person is locked out at once, even while their sign-in is still valid.
    if (!profile || profile.disabled) return null;
    const mustChangePassword = profile.mustChangePassword || undefined;
    if (profile.role === "admin") return { role: "admin", viewAsTenantId: jar.get("cd_view")?.value, userId: profile.id, mustChangePassword };
    return profile.tenantId ? { role: "client", tenantId: profile.tenantId, userId: profile.id, staffRole: profile.role, mustChangePassword } : null;
  }
  const v = jar.get("cd_session")?.value;
  if (v === "admin") return { role: "admin", viewAsTenantId: jar.get("cd_view")?.value };
  if (v?.startsWith("client:")) {
    const tenantId = v.slice(7);
    return (await getTenant(tenantId)) ? { role: "client", tenantId } : null;
  }
  return null;
}

/** Someone with a temporary password sees nothing but the change-password page until they have chosen their own. */
const FORCE_CHANGE = "/account?force=1";

export async function requireAdmin() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.role !== "admin") redirect("/app");
  if (s.mustChangePassword) redirect(FORCE_CHANGE);
  return { session: s, actor: "admin" };
}

export async function requireClient(): Promise<{ tenant: Tenant; actor: string; viewingAsAdmin: boolean; staffRole: "manager" | "receptionist"; userId?: string }> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.mustChangePassword) redirect(FORCE_CHANGE);
  if (s.role === "client") {
    const tenant = await getTenant(s.tenantId);
    if (!tenant) redirect("/login");
    // Demo sign-in has no profile; treat it as the clinic's manager so every page can be tried.
    return { tenant, actor: `staff:${s.tenantId}`, viewingAsAdmin: false, staffRole: s.staffRole ?? "manager", userId: s.userId };
  }
  const t = s.viewAsTenantId ? await getTenant(s.viewAsTenantId) : undefined;
  if (!t) redirect("/admin");
  return { tenant: t, actor: "admin (view as client)", viewingAsAdmin: true, staffRole: "manager" };
}
