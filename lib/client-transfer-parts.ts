/**
 * The parts of a client settings file (lib/client-transfer.ts), and reading one: no server code, so the browser can use it
 * (components/ClientTransfer.tsx reads the chosen file before anything is sent).
 */
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown, max = 4000) => (typeof v === "string" ? v.slice(0, max) : "");

export const FORMAT = "callsdash-client";
export const FORMAT_VERSION = 1;

export const PART_GROUPS = {
  assistant: ["instructions", "voices", "voiceMode", "studio.model", "studio.voice", "studio.conversation", "studio.hearing", "studio.knowledge", "studio.safety", "studio.analysis", "studio.widget", "tests"],
  content: ["knowledge", "services", "catalogue", "tables"],
  team: ["business", "team"],
  setup: ["hours", "branding", "brandingImages", "contacts", "messages", "rules"],
  people: ["signins", "customers"],
} as const;
export type PartGroup = keyof typeof PART_GROUPS;
export type PartId = (typeof PART_GROUPS)[PartGroup][number];
export const PARTS = Object.values(PART_GROUPS).flat() as PartId[];
export const isPart = (v: unknown): v is PartId => typeof v === "string" && (PARTS as string[]).includes(v);
/** Lists: imported in chunks, merged by name (or replaced when the admin chooses so). */
export const LIST_PARTS = ["team", "services", "knowledge", "catalogue", "tables", "customers"] as const satisfies readonly PartId[];
export type ListPart = (typeof LIST_PARTS)[number];
export const isListPart = (p: string): p is ListPart => (LIST_PARTS as readonly string[]).includes(p);
/** Off unless the admin ticks them. */
export const OFF_BY_DEFAULT: PartId[] = ["customers"];
/** In the file for reference only: an import never applies them. */
export const EXPORT_ONLY: PartId[] = ["signins"];
/** Applied after the assistant was updated in ElevenLabs, straight to the agent (the Voice mode is not kept in CallsDash). */
export const AGENT_PARTS: PartId[] = ["voiceMode"];
/** Parts whose entries can carry photos (a tick of its own on both sides). */
export const PHOTO_PARTS = ["catalogue", "team"] as const;

export interface ExportFile {
  format: typeof FORMAT;
  version: number;
  exportedAt: string;
  from: { id: string; name: string; nameAr: string; displayName: string };
  /** Which list parts carry their photos. */
  photos: Partial<Record<(typeof PHOTO_PARTS)[number], boolean>>;
  parts: Partial<Record<PartId, unknown>>;
  /**
   * Where the assistant settings came from: "live" = read from the agent in ElevenLabs when the file was made (so edits made
   * directly there are included), "stored" = CallsDash's own copy; `liveError` says why reading ElevenLabs failed.
   */
  assistantFrom?: "live" | "stored";
  liveError?: string;
}

/** The names the file's client is known by (English and Arabic), to be replaced by the importing client's names. */
export const fromNames = (f: Pick<ExportFile, "from">): string[] =>
  [...new Set([f.from.displayName, f.from.name, f.from.nameAr].map((x) => x.trim()).filter((x) => x.length >= 3))];
export const isArabic = (s: string) => /[\u0600-\u06FF]/.test(s);

/** Checks a file read in the browser; returns the problem when it is not a CallsDash client file. */
export function readExportFile(v: unknown): { ok: true; file: ExportFile } | { ok: false; error: "format" | "version" } {
  const o = obj(v);
  if (o.format !== FORMAT || !o.parts || typeof o.parts !== "object") return { ok: false, error: "format" };
  if (typeof o.version !== "number" || o.version > FORMAT_VERSION) return { ok: false, error: "version" };
  const parts: ExportFile["parts"] = {};
  for (const [k, x] of Object.entries(obj(o.parts))) if (isPart(k) && x !== undefined && x !== null) parts[k] = x;
  const from = obj(o.from);
  return {
    ok: true,
    file: {
      format: FORMAT, version: o.version, exportedAt: str(o.exportedAt, 40), photos: obj(o.photos) as ExportFile["photos"], parts,
      ...(o.assistantFrom === "live" || o.assistantFrom === "stored" ? { assistantFrom: o.assistantFrom } : {}),
      ...(typeof o.liveError === "string" && o.liveError ? { liveError: str(o.liveError, 400) } : {}),
      from: { id: str(from.id, 64), name: str(from.name, 120), nameAr: str(from.nameAr, 120), displayName: str(from.displayName, 120) },
    },
  };
}

/** How many entries a part holds, for the import screen ("12 items"); null for a settings part. */
export const partCount = (v: unknown): number | null => (Array.isArray(v) ? v.length : null);

/** The names a list is matched by, for `keep` in replace mode. */
export const namesOf = (part: ListPart, entries: unknown[]): string[] =>
  entries.map(obj).map((e) => str(part === "knowledge" ? e.question : e.name, 1000)).filter(Boolean);
