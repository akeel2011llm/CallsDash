"use client";

import { useMemo, useState } from "react";
import {
  EXPORT_ONLY, LIST_PARTS, OFF_BY_DEFAULT, PART_GROUPS, PHOTO_PARTS, namesOf, partCount, readExportFile,
  type ExportFile, type ListPart, type PartGroup, type PartId,
} from "@/lib/client-transfer-parts";

export type TransferLabels = Record<string, string>;

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));
const GROUPS = Object.keys(PART_GROUPS) as PartGroup[];

/** Ticks grouped like the file: every part of a group can be ticked or unticked at once. */
function PartTicks({ L, available, picked, setPicked, counts }: {
  L: TransferLabels; available: PartId[]; picked: Set<PartId>; setPicked: (s: Set<PartId>) => void; counts: Partial<Record<PartId, number | null>>;
}) {
  const toggle = (p: PartId, on: boolean) => { const n = new Set(picked); if (on) n.add(p); else n.delete(p); setPicked(n); };
  return (
    <div className="xfer-groups">
      {GROUPS.map((g) => {
        const parts = (PART_GROUPS[g] as readonly PartId[]).filter((p) => available.includes(p));
        if (!parts.length) return null;
        const all = parts.every((p) => picked.has(p));
        return (
          <fieldset key={g} className="xfer-group">
            <legend>
              <label className="inline"><input type="checkbox" checked={all} onChange={(e) => { const n = new Set(picked); parts.forEach((p) => (e.target.checked ? n.add(p) : n.delete(p))); setPicked(n); }} /><strong>{L[`group.${g}`]}</strong></label>
            </legend>
            {parts.map((p) => (
              <label key={p} className="inline">
                <input type="checkbox" name="part" value={p} checked={picked.has(p)} onChange={(e) => toggle(p, e.target.checked)} />
                <span>{L[`part.${p}`]}{typeof counts[p] === "number" ? <span className="muted"> ({counts[p]})</span> : null}</span>
              </label>
            ))}
          </fieldset>
        );
      })}
    </div>
  );
}

export function ExportCard({ tenantId, L, counts }: { tenantId: string; L: TransferLabels; counts: Partial<Record<PartId, number>> }) {
  const all = Object.values(PART_GROUPS).flat() as PartId[];
  const [picked, setPicked] = useState(() => new Set(all.filter((p) => !OFF_BY_DEFAULT.includes(p))));
  return (
    <form method="get" action={`/api/admin/clients/${tenantId}/export`} className="card stack" id="export">
      <h2>{L["export.title"]}</h2>
      <p className="muted">{L["export.help"]}</p>
      <div className="row">
        <button type="button" className="btn small ghost" onClick={() => setPicked(new Set(all))}>{L.all}</button>
        <button type="button" className="btn small ghost" onClick={() => setPicked(new Set())}>{L.none}</button>
      </div>
      <PartTicks L={L} available={all} picked={picked} setPicked={setPicked} counts={counts} />
      <label className="inline"><input type="checkbox" name="photos" value="1" />{L.photos}</label>
      {picked.has("customers") && <p className="notice warn">{L.customersWarn}</p>}
      <p className="muted small">{L.never}</p>
      <div><button className="btn" type="submit" disabled={!picked.size}>{L.download}</button></div>
    </form>
  );
}

type Result = { part: string; added: number; updated: number; removed: number; skipped: number };

async function post(tenantId: string, body: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(`/api/admin/clients/${tenantId}/import`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(String(j.detail ?? j.error ?? r.status));
  return j;
}

/** Splits a list so no request is big: entries with a photo go alone, the rest fifty at a time. */
function chunks(entries: unknown[]): unknown[][] {
  const out: unknown[][] = [];
  let cur: unknown[] = [];
  for (const e of entries) {
    const heavy = !!e && typeof e === "object" && typeof (e as { photo?: unknown }).photo === "string";
    if (heavy) { if (cur.length) out.push(cur); out.push([e]); cur = []; continue; }
    cur.push(e);
    if (cur.length >= 50) { out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  return out.length ? out : [[]];
}

export function ImportCard({ tenantId, tenantName, L }: { tenantId: string; tenantName: string; L: TransferLabels }) {
  const [file, setFile] = useState<ExportFile | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<Set<PartId>>(new Set());
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [confirm, setConfirm] = useState(false);
  const [rename, setRename] = useState(true);
  const [photos, setPhotos] = useState(true);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [log, setLog] = useState<string[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [failure, setFailure] = useState("");

  const available = useMemo(() => (file ? (Object.keys(file.parts) as PartId[]) : []), [file]);
  const counts = useMemo(() => Object.fromEntries(available.map((p) => [p, partCount(file?.parts[p])])) as Partial<Record<PartId, number | null>>, [available, file]);
  const other = !!file && file.from.id !== tenantId;
  const hasPhotos = !!file && PHOTO_PARTS.some((p) => file.photos?.[p]);
  const signins = file && Array.isArray(file.parts.signins) ? (file.parts.signins as { fullName?: string; email?: string; role?: string }[]) : [];
  const applying = [...picked].filter((p) => !EXPORT_ONLY.includes(p));
  const listPicked = applying.some((p) => (LIST_PARTS as readonly string[]).includes(p));

  const read = async (f: File | undefined) => {
    setError(""); setFile(null); setStatus("idle"); setResults([]); setLog([]);
    if (!f) return;
    try {
      const r = readExportFile(JSON.parse(await f.text()));
      if (!r.ok) { setError(L[`bad.${r.error}`]); return; }
      setFile(r.file);
      setPicked(new Set((Object.keys(r.file.parts) as PartId[]).filter((p) => !OFF_BY_DEFAULT.includes(p) && !EXPORT_ONLY.includes(p))));
    } catch { setError(L["bad.read"]); }
  };

  const run = async () => {
    if (!file) return;
    setStatus("running"); setFailure(""); setResults([]);
    const options = { mode, rename: other && rename, photos: hasPhotos && photos, from: file.from };
    const lines: string[] = [];
    const say = (s: string) => { lines.push(s); setLog([...lines]); };
    try {
      const settings = Object.fromEntries(applying.filter((p) => !(LIST_PARTS as readonly string[]).includes(p)).map((p) => [p, file.parts[p]]));
      if (Object.keys(settings).length) {
        say(L["step.settings"]);
        await post(tenantId, { step: "settings", parts: settings, options });
      }
      // the team after the business (its roles), the rest in any order
      const order: ListPart[] = ["team", "services", "knowledge", "catalogue", "tables", "customers"];
      const out: Result[] = [];
      for (const part of order) {
        if (!applying.includes(part)) continue;
        const entries = Array.isArray(file.parts[part]) ? (file.parts[part] as unknown[]) : [];
        const sum: Result = { part, added: 0, updated: 0, removed: 0, skipped: 0 };
        const list = chunks(entries);
        for (let i = 0; i < list.length; i++) {
          say(fill(L.stepList, { part: L[`part.${part}`], n: i + 1, of: list.length }));
          const r = await post(tenantId, { step: "list", part, entries: list[i], options, ...(i === 0 && mode === "replace" ? { keep: namesOf(part, entries) } : {}) });
          for (const k of ["added", "updated", "removed", "skipped"] as const) sum[k] += Number(r[k] ?? 0);
        }
        out.push(sum);
        setResults([...out]);
      }
      say(L["step.finish"]);
      await post(tenantId, { step: "finish", options });
      setStatus("done");
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
      setStatus("failed");
    }
  };

  const blocked = !file || !applying.length || (mode === "replace" && listPicked && !confirm) || status === "running";
  return (
    <section className="card stack" id="import">
      <h2>{L["import.title"]}</h2>
      <p className="muted">{fill(L["import.help"], { name: tenantName })}</p>
      <label>{L.file}<input type="file" accept="application/json,.json" onChange={(e) => void read(e.target.files?.[0])} disabled={status === "running"} /></label>
      {error && <p className="notice warn" role="alert">{error}</p>}
      {file && (
        <>
          <p><strong>{fill(L.from, { name: file.from.displayName || file.from.name || "?", date: file.exportedAt.slice(0, 10) })}</strong></p>
          <PartTicks L={L} available={available} picked={picked} setPicked={setPicked} counts={counts} />
          {picked.has("signins") && (
            <div className="notice">
              <p>{L.signinsNote}</p>
              <ul className="notes">{signins.map((s, i) => <li key={i}>{s.fullName} · <span dir="ltr">{s.email}</span> · {s.role}</li>)}</ul>
            </div>
          )}
          {listPicked && (
            <fieldset>
              <legend><strong>{L.mode}</strong></legend>
              <label className="inline"><input type="radio" name="mode" checked={mode === "merge"} onChange={() => setMode("merge")} />{L["mode.merge"]}</label>
              <label className="inline"><input type="radio" name="mode" checked={mode === "replace"} onChange={() => setMode("replace")} />{L["mode.replace"]}</label>
              {mode === "replace" && (
                <div className="notice warn">
                  <p>{L.replaceNote}</p>
                  <label className="inline"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />{L.confirm}</label>
                </div>
              )}
            </fieldset>
          )}
          {other && <label className="inline"><input type="checkbox" checked={rename} onChange={(e) => setRename(e.target.checked)} />{fill(L.rename, { from: file.from.displayName || file.from.name, to: tenantName })}</label>}
          {hasPhotos && <label className="inline"><input type="checkbox" checked={photos} onChange={(e) => setPhotos(e.target.checked)} />{L.photosImport}</label>}
          {picked.has("customers") && <p className="notice warn">{L.customersWarn}</p>}
          <p className="muted small">{L.syncNote}</p>
          <div><button type="button" className="btn" disabled={blocked} onClick={() => void run()}>{status === "running" ? L.running : L.import}</button></div>
          {!applying.length && <p className="muted small">{L.nothing}</p>}
        </>
      )}
      {log.length > 0 && <ul className="notes muted small" aria-live="polite">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>}
      {results.length > 0 && (
        <ul className="notes">{results.map((r) => <li key={r.part}>{fill(L.result, { part: L[`part.${r.part}`], added: r.added, updated: r.updated, removed: r.removed })}{r.skipped ? ` · ${fill(L.skipped, { n: r.skipped })}` : ""}</li>)}</ul>
      )}
      {status === "done" && <p className="notice ok" role="status">{L.done}</p>}
      {status === "failed" && <p className="notice warn" role="alert">{fill(L.failed, { detail: failure })}</p>}
    </section>
  );
}
