import { requireClient } from "@/lib/auth";
import { getCustomers } from "@/lib/data";
import { customersRows } from "@/lib/data-hub";
import { formatOf, sheetResponse } from "@/lib/sheet";

export const dynamic = "force-dynamic";

/** The clinic's customers as a spreadsheet (CSV, or Excel with ?format=xlsx), for its own records. */
export async function GET(req: Request) {
  const { tenant } = await requireClient();
  return sheetResponse(customersRows(await getCustomers(tenant.id)), `${tenant.slug}-customers`, formatOf(req.url), { sheet: "customers" });
}
