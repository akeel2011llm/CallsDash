import "server-only";
import { getSession } from "./auth";
import { getTenant } from "./data";
import type { Tenant } from "./types";

/**
 * The client whose data the signed-in person may download or look at, or null. The admin names the client with `t`
 * (or is viewing as one); a clinic manager gets their own client, and for the Data screen only when the admin switched it on.
 * Used by the photo and download routes, which cannot redirect to a sign-in page the way a screen does.
 */
export async function dataTenant(url: URL, need: "photo" | "data"): Promise<Tenant | null> {
  const s = await getSession();
  if (!s || s.mustChangePassword) return null;
  if (s.role === "admin") {
    const id = url.searchParams.get("t") || s.viewAsTenantId;
    return (id && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? await getTenant(id) : null) ?? null;
  }
  if (s.role !== "client") return null;
  const tenant = await getTenant(s.tenantId);
  if (!tenant) return null;
  if (need === "photo") return tenant;
  return tenant.permissions.dataManager && (s.staffRole ?? "manager") === "manager" ? tenant : null;
}
