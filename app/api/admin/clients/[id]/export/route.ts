import { getSession } from "@/lib/auth";
import { getData } from "@/lib/data";
import { buildClientExport, isPart } from "@/lib/client-transfer";
import { safeName } from "@/lib/data-hub";

export const dynamic = "force-dynamic";

/** Admin Clients > Import/Export: the ticked parts of one client's settings as a JSON file (lib/client-transfer.ts). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s || s.role !== "admin" || s.mustChangePassword) return new Response("Not found", { status: 404 });
  const { id } = await params;
  const d = await getData();
  const tenant = /^[A-Za-z0-9_-]{1,64}$/.test(id) ? await d.getTenant(id) : undefined;
  if (!tenant) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const parts = url.searchParams.getAll("part").filter(isPart);
  if (!parts.length) return new Response("Nothing ticked", { status: 400 });
  const at = new Date().toISOString();
  const file = await buildClientExport(d, tenant, parts, url.searchParams.get("photos") === "1", at);
  await d.audit("admin", `Settings exported to a file: ${parts.join(", ")}`.slice(0, 480), tenant.id);
  return new Response(JSON.stringify(file, null, 1), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${safeName(tenant.slug)}-settings-${at.slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
}
