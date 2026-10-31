/**
 * One way to hand a table to the person, as CSV or Excel (milestone 6b of docs/reorganization.md), and one way to read an
 * uploaded table back, whichever of the two it is. Used by every download and import of the app.
 */
import { toCsv } from "./stats";
import { looksLikeXlsx, readXlsx, toXlsx, type Cell } from "./xlsx";

export type SheetFormat = "csv" | "xlsx";

/** `?format=xlsx` asks for Excel; anything else is CSV (the format every download had before). */
export const formatOf = (url: URL | string): SheetFormat => (new URL(String(url), "http://x").searchParams.get("format") === "xlsx" ? "xlsx" : "csv");

/** A download of `rows`: CSV with a byte-order mark (so Excel reads Arabic), or an .xlsx workbook. Never cached. */
export function sheetResponse(rows: Cell[][], name: string, format: SheetFormat, o: { sheet?: string } = {}): Response {
  const headers = { "cache-control": "no-store" };
  if (format === "xlsx")
    return new Response(Buffer.from(toXlsx(rows, { sheet: o.sheet ?? name })), {
      headers: { ...headers, "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${name}.xlsx"` },
    });
  return new Response("﻿" + toCsv(rows), { headers: { ...headers, "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"` } });
}

/** An uploaded table as CSV text or Excel rows, decided by the file's own bytes (not its name). Throws XlsxError for a broken workbook. */
export async function sheetFromFile(file: Blob): Promise<string | string[][]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return looksLikeXlsx(bytes) ? readXlsx(bytes) : new TextDecoder("utf-8").decode(bytes);
}
