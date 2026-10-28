import { requireClient } from "@/lib/auth";
import { getCustomers } from "@/lib/data";
import { toCsv } from "@/lib/stats";

export const dynamic = "force-dynamic";

/** The clinic's customers as a spreadsheet, for its own records. */
export async function GET() {
  const { tenant } = await requireClient();
  const rows = (await getCustomers(tenant.id)).map((c) => [c.name, c.phone, c.cpr ?? "", c.email ?? "", c.language ?? "", c.notes, c.createdAt, c.lastContactAt ?? "", c.history.length]);
  const csv = toCsv([["name", "phone", "cpr", "email", "language", "notes", "created_at", "last_contact_at", "conversations"], ...rows]);
  return new Response("﻿" + csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${tenant.slug}-customers.csv"`,
      "cache-control": "no-store",
    },
  });
}
