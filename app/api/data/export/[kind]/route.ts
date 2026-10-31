import { dataTenant } from "@/lib/data-access";
import { getData } from "@/lib/data";
import {
  buildFullExport, customersRows, customersTemplateRows, doctorsRows, isExportKind, isImportKind, itemsRows, itemsTemplateRows, knowledgeRows, knowledgeTemplateRows, safeName,
} from "@/lib/data-hub";
import { formatOf, sheetResponse } from "@/lib/sheet";
import { extraFieldsOf } from "@/lib/extra-fields";

export const dynamic = "force-dynamic";

/**
 * Downloads for the Data screen: `catalogue`, `customers`, `knowledge` or `doctors` as a spreadsheet, `all` as one JSON file
 * (`photos=1` adds every photo), and `template=1` for an empty file to fill in and import. `format=xlsx` gives an Excel file
 * instead of CSV. Same access as the screen itself.
 */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const url = new URL(req.url);
  const tenant = await dataTenant(url, "data");
  if (!tenant) return new Response("Not found", { status: 404 });
  const d = await getData();
  const slug = safeName(tenant.slug);
  const format = formatOf(req.url);
  if (url.searchParams.get("template") === "1") {
    if (!isImportKind(kind)) return new Response("Not found", { status: 404 });
    return sheetResponse(kind === "catalogue" ? itemsTemplateRows() : kind === "customers" ? customersTemplateRows(extraFieldsOf(tenant, "customer")) : knowledgeTemplateRows(), `${kind}-template`, format, { sheet: kind });
  }
  if (kind === "all") {
    const full = await buildFullExport(d, tenant, url.searchParams.get("photos") === "1", new Date().toISOString());
    return new Response(JSON.stringify(full, null, 1), {
      headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="${slug}-export.json"`, "cache-control": "no-store" },
    });
  }
  if (!isExportKind(kind)) return new Response("Not found", { status: 404 });
  const rows = kind === "catalogue" ? itemsRows(await d.getItems(tenant.id))
    : kind === "customers" ? customersRows(await d.getCustomers(tenant.id), extraFieldsOf(tenant, "customer"))
      : kind === "knowledge" ? knowledgeRows(await d.getKnowledge(tenant.id))
        : doctorsRows(await d.getDoctors(tenant.id), extraFieldsOf(tenant, "team"));
  return sheetResponse(rows, `${slug}-${kind}`, format, { sheet: kind });
}
