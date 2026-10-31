/**
 * Excel (.xlsx) files without a library (milestone 6b of docs/reorganization.md): one sheet written from rows, and the first
 * sheet of an uploaded workbook read back into rows. An .xlsx file is a ZIP of XML files; this module writes and reads only
 * the parts a plain table needs. Every value is written as text or a number, never as a formula, so a cell that starts with
 * "=" cannot run anything when the file is opened.
 */
import { deflateRawSync, inflateRawSync } from "node:zlib";

export type Cell = string | number;

/* ---------- ZIP ---------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const packed = deflateRawSync(f.data);
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, name, packed);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x0800, 8); dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(0, 12); dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(packed.length, 20); dir.writeUInt32LE(f.data.length, 24);
    dir.writeUInt16LE(name.length, 28); dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += local.length + name.length + packed.length;
  }
  const dirSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dirSize, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, ...central, end]));
}

export class XlsxError extends Error {
  constructor(readonly code: "not_xlsx" | "too_big" | "no_sheet") { super(code); }
}

/** Most an unpacked file may grow to: an uploaded workbook is at most 1 MB, and a table that size unpacks to far less. */
const MAX_UNPACKED = 25 * 1024 * 1024;

function unzip(input: Uint8Array): Map<string, () => Buffer> {
  const b = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (b.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new XlsxError("not_xlsx");
  const count = b.readUInt16LE(end + 10);
  let p = b.readUInt32LE(end + 16);
  const out = new Map<string, () => Buffer>();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== 0x02014b50) throw new XlsxError("not_xlsx");
    const method = b.readUInt16LE(p + 10), size = b.readUInt32LE(p + 20), full = b.readUInt32LE(p + 24);
    const nameLen = b.readUInt16LE(p + 28), extra = b.readUInt16LE(p + 30), comment = b.readUInt16LE(p + 32), at = b.readUInt32LE(p + 42);
    const name = b.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extra + comment;
    total += full;
    if (total > MAX_UNPACKED) throw new XlsxError("too_big");
    out.set(name, () => {
      if (at + 30 > b.length || b.readUInt32LE(at) !== 0x04034b50) throw new XlsxError("not_xlsx");
      const start = at + 30 + b.readUInt16LE(at + 26) + b.readUInt16LE(at + 28);
      const raw = b.subarray(start, start + size);
      if (method === 0) return raw;
      if (method === 8) return inflateRawSync(raw, { maxOutputLength: MAX_UNPACKED });
      throw new XlsxError("not_xlsx");
    });
  }
  return out;
}

/* ---------- XML ---------- */

const esc = (s: string) =>
  // characters XML does not allow (control codes) are dropped
  s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const unesc = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const k = e.toLowerCase();
    if (k[0] === "#") return String.fromCodePoint(k[1] === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[k];
  }).replace(/_x([0-9a-f]{4})_/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));

/** "A" -> 0, "AB" -> 27. */
export const colIndex = (letters: string) => [...letters.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
/** 0 -> "A", 27 -> "AB". */
export function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/* ---------- write ---------- */

/**
 * One sheet from rows. The first row is the header: bold, frozen while scrolling, with a filter. Columns are sized to their
 * text. `rtl` shows the sheet right to left (for an Arabic table).
 */
export function toXlsx(rows: Cell[][], o: { sheet?: string; rtl?: boolean } = {}): Uint8Array {
  const sheetName = esc((o.sheet || "Sheet1").replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
  const width = Math.max(1, ...rows.map((r) => r.length));
  const widths = Array.from({ length: width }, (_, c) => Math.min(60, Math.max(8, ...rows.slice(0, 200).map((r) => String(r[c] ?? "").length + 2))));
  const body = rows.map((r, i) => {
    const cells = r.map((v, c) => {
      const ref = `${colName(c)}${i + 1}`;
      const style = i === 0 ? ' s="1"' : "";
      if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
      const s = String(v ?? "");
      return s === "" ? "" : `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(s)}</t></is></c>`;
    }).join("");
    return `<row r="${i + 1}">${cells}</row>`;
  }).join("");
  const last = `${colName(width - 1)}${Math.max(1, rows.length)}`;
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"${o.rtl ? ' rightToLeft="1"' : ""}><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>${body}</sheetData>${rows.length > 1 ? `<autoFilter ref="A1:${last}"/>` : ""}</worksheet>`;
  const enc = (s: string) => new Uint8Array(Buffer.from(s, "utf8"));
  return zip([
    { name: "[Content_Types].xml", data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`) },
    { name: "_rels/.rels", data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: "xl/workbook.xml", data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets>${rows.length > 1 ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${sheetName.replace(/'/g, "''")}'!$A$1:$${colName(width - 1)}$${rows.length}</definedName></definedNames>` : ""}</workbook>`) },
    { name: "xl/_rels/workbook.xml.rels", data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    { name: "xl/styles.xml", data: enc(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`) },
    { name: "xl/worksheets/sheet1.xml", data: enc(sheet) },
  ]);
}

/* ---------- read ---------- */

/** A ZIP file starts with "PK". */
export const looksLikeXlsx = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4;

const textOf = (xml: string) => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g)].map((m) => unesc(m[1] ?? "")).join("");

/**
 * The first sheet of a workbook as rows of text (empty cells are ""). Shared and inline strings, numbers and true/false are
 * read; formulas give their last calculated value. Fully empty rows are left out.
 */
export function readXlsx(input: Uint8Array): string[][] {
  if (!looksLikeXlsx(input)) throw new XlsxError("not_xlsx");
  const files = unzip(input);
  const get = (n: string) => files.get(n)?.().toString("utf8");
  const wb = get("xl/workbook.xml");
  if (!wb) throw new XlsxError("not_xlsx");
  // the first sheet's file, through the workbook's relationships
  const rid = wb.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1]?.replace(/[^\w-]/g, "");
  const rels = get("xl/_rels/workbook.xml.rels") ?? "";
  const rel = rid ? [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => r.includes(`Id="${rid}"`)) : undefined;
  const target = rel?.match(/\bTarget="([^"]+)"/)?.[1];
  const path = target ? (target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`) : "xl/worksheets/sheet1.xml";
  const sheet = get(path) ?? get("xl/worksheets/sheet1.xml");
  if (!sheet) throw new XlsxError("no_sheet");
  const shared = [...(get("xl/sharedStrings.xml") ?? "").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)].map((m) => textOf(m[1] ?? ""));
  const rows: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row: string[] = [];
    let next = 0;
    for (const cm of (rm[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], inner = cm[2] ?? "";
      const ref = attrs.match(/\br="([A-Z]+)\d+"/i)?.[1];
      const col = ref ? colIndex(ref) : next;
      next = col + 1;
      const type = attrs.match(/\bt="(\w+)"/)?.[1] ?? "n";
      const v = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
      let value = "";
      if (type === "s") value = shared[Number(v)] ?? "";
      else if (type === "inlineStr") value = textOf(inner.match(/<is\b[^>]*>([\s\S]*?)<\/is>/)?.[1] ?? "");
      else if (type === "b") value = v === "1" ? "yes" : "no";
      else if (v != null) value = unesc(v);
      if (col < 0 || col > 200) continue;
      while (row.length < col) row.push("");
      row[col] = value;
    }
    if (row.some((x) => x.trim() !== "")) rows.push(row);
  }
  return rows;
}
