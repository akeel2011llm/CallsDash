import { dataTenant } from "@/lib/data-access";
import { getData } from "@/lib/data";
import {
  buildFullExport, customersCsv, customersTemplate, doctorsCsv, isExportKind, isImportKind, itemsCsv, itemsTemplate, knowledgeCsv, knowledgeTemplate, safeName,
} from "@/lib/data-hub";

export const dynamic = "force-dynamic";

const csv = (body: string, name: string) =>
  new Response("﻿" + body, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, "cache-control": "no-store" },
  });

/**
 * Downloads for the Data screen: `catalogue`, `customers`, `knowledge` or `doctors` as a spreadsheet, `all` as one JSON file
 * (`photos=1` adds every photo), and `template=1` for an empty file to fill in and import. Same access as the screen itself.
 */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const url = new URL(req.url);
  const tenant = await dataTenant(url, "data");
  if (!tenant) return new Response("Not found", { status: 404 });
  const d = await getData();
  const slug = safeName(tenant.slug);
  if (url.searchParams.get("template") === "1") {
    if (!isImportKind(kind)) return new Response("Not found", { status: 404 });
    return csv(kind === "catalogue" ? itemsTemplate() : kind === "customers" ? customersTemplate() : knowledgeTemplate(), `${kind}-template`);
  }
  if (kind === "all") {
    const full = await buildFullExport(d, tenant, url.searchParams.get("photos") === "1", new Date().toISOString());
    return new Response(JSON.stringify(full, null, 1), {
      headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${slug}-export.json"`, "cache-control": "no-store" },
    });
  }
  if (!isExportKind(kind)) return new Response("Not found", { status: 404 });
  const body = kind === "catalogue" ? itemsCsv(await d.getItems(tenant.id))
    : kind === "customers" ? customersCsv(await d.getCustomers(tenant.id))
      : kind === "knowledge" ? knowledgeCsv(await d.getKnowledge(tenant.id))
        : doctorsCsv(await d.getDoctors(tenant.id));
  return csv(body, `${slug}-${kind}`);
}
