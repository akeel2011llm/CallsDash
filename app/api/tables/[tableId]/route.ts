import { getSession } from "@/lib/auth";
import { getData, getTenant } from "@/lib/data";
import { safeName } from "@/lib/data-hub";
import { tableSheet, tableTemplate } from "@/lib/custom-tables";
import { formatOf, sheetResponse } from "@/lib/sheet";

export const dynamic = "force-dynamic";

/**
 * Downloads one custom table (milestone 6c) as CSV, or Excel with `format=xlsx`; `template=1` gives the column names and one example
 * row to fill in and import. The admin names the client with `t` (or is viewing as it); the client's staff get their own tables.
 */
export async function GET(req: Request, { params }: { params: Promise<{ tableId: string }> }) {
  const { tableId } = await params;
  const url = new URL(req.url);
  const s = await getSession();
  if (!s || s.mustChangePassword || !/^[\w-]{1,64}$/.test(tableId)) return new Response("Not found", { status: 404 });
  const tenantId = s.role === "admin" ? url.searchParams.get("t") || s.viewAsTenantId : s.role === "client" ? s.tenantId : undefined;
  const tenant = tenantId && /^[A-Za-z0-9_-]{1,64}$/.test(tenantId) ? await getTenant(tenantId) : undefined;
  if (!tenant) return new Response("Not found", { status: 404 });
  const d = await getData();
  const table = await d.getDataTable(tenant.id, tableId);
  if (!table) return new Response("Not found", { status: 404 });
  const tn = safeName(table.name);
  const name = `${safeName(tenant.slug)}-${tn === "client" ? "table" : tn}`;
  const sheet = table.name.slice(0, 31);
  if (url.searchParams.get("template") === "1") return sheetResponse(tableTemplate(table), `${name}-template`, formatOf(req.url), { sheet });
  return sheetResponse(tableSheet(table, await d.getDataRows(tenant.id, table.id)), name, formatOf(req.url), { sheet });
}
