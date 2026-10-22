"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CatalogVoice } from "@/lib/elevenlabs-catalog";
import { text, type Labels } from "./text";

/** A voice as the studio keeps it: enough to show its name and play a sample without asking ElevenLabs again. */
export interface VoicePick { id: string; name: string; gender?: string; language?: string; accent?: string; previewUrl?: string }

/** Where the browser was opened from: the English voice, the Arabic voice, or the list the client may choose from. */
export type BrowserFor = "en" | "ar" | "offer";

const GENDERS = ["", "female", "male", "neutral"] as const;
const LANGUAGES = ["", "en", "ar"] as const;

/** ElevenLabs writes the gender as free text; the usual values are translated, anything else is shown as it is. */
const genderText = (T: (k: string) => string, g: string) => ((GENDERS as readonly string[]).includes(g) ? T(`studio.vb.gender.${g}`) : g);

const toPick = (v: CatalogVoice): VoicePick => ({ id: v.id, name: v.name, gender: v.gender, language: v.language, accent: v.accent, previewUrl: v.previewUrl });

type Load = { kind: "idle" } | { kind: "loading" } | { kind: "nokey" } | { kind: "error"; message: string };

/**
 * Search for voices in the ElevenLabs account or in its public library, listen to a sample, and pick one. A library voice
 * is copied into the account first, because an assistant can only speak with voices the account holds.
 * Everything here is `type="button"`: the browser sits inside the section's form and must never submit it.
 */
export function VoiceBrowser({ side, offeredIds, onUse, onOffer, onClose, labels }: {
  side: BrowserFor;
  /** Voices already offered to the client, so the list can say so. */
  offeredIds: string[];
  onUse: (v: VoicePick) => void;
  onOffer: (v: VoicePick) => void;
  onClose: () => void;
  labels: Labels;
}) {
  const T = text(labels);
  const [source, setSource] = useState<"account" | "library">("account");
  const [q, setQ] = useState("");
  const [lang, setLang] = useState<string>(side === "offer" ? "" : side);
  const [gender, setGender] = useState("");
  const [accent, setAccent] = useState("");
  const [voices, setVoices] = useState<CatalogVoice[]>([]);
  const [more, setMore] = useState<string | null>(null);
  const [load, setLoad] = useState<Load>({ kind: "idle" });
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [playing, setPlaying] = useState("");
  const [manualId, setManualId] = useState("");
  const [manualName, setManualName] = useState("");
  const audio = useRef<HTMLAudioElement | null>(null);
  const request = useRef(0);

  const search = useCallback(async (next?: string) => {
    const mine = ++request.current;
    setLoad({ kind: "loading" });
    const p = new URLSearchParams({ source });
    if (q.trim()) p.set("q", q.trim());
    if (lang) p.set("lang", lang);
    if (gender) p.set("gender", gender);
    if (accent.trim()) p.set("accent", accent.trim());
    if (next) p.set("next", next);
    try {
      const res = await fetch(`/api/admin/voices?${p}`, { cache: "no-store" });
      const body = await res.json();
      if (mine !== request.current) return; // a newer search replaced this one
      if (body.error === "no_key") { setLoad({ kind: "nokey" }); return; }
      if (!res.ok || body.error) { setLoad({ kind: "error", message: String(body.message ?? "") }); return; }
      setVoices((cur) => (next ? [...cur, ...body.voices] : body.voices));
      setMore(body.hasMore && body.next ? String(body.next) : null);
      setLoad({ kind: "idle" });
    } catch {
      if (mine === request.current) setLoad({ kind: "error", message: "" });
    }
  }, [source, q, lang, gender, accent]);

  // a change of source, language or gender searches at once; typed words wait for Enter or the Search button
  useEffect(() => { void search(); }, [source, lang, gender]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { audio.current?.pause(); }, []);

  function play(v: CatalogVoice) {
    if (!v.previewUrl) return;
    audio.current?.pause();
    if (playing === v.id) { setPlaying(""); return; }
    const a = new Audio(v.previewUrl);
    a.onended = () => setPlaying("");
    a.onerror = () => setPlaying("");
    audio.current = a;
    setPlaying(v.id);
    void a.play().catch(() => setPlaying(""));
  }

  /** Library voices are copied into the account before they are used; account voices are ready as they are. */
  async function ready(v: CatalogVoice): Promise<VoicePick | null> {
    if (v.source === "account") return toPick(v);
    if (!v.publicOwnerId) { setNote(T("studio.vb.addFailed")); return null; }
    setBusy(v.id);
    try {
      const res = await fetch("/api/admin/voices", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicOwnerId: v.publicOwnerId, voiceId: v.id, name: v.name }),
      });
      const body = await res.json();
      if (!res.ok || body.error) { setNote(`${T("studio.vb.addFailed")} ${body.message ?? ""}`.trim()); return null; }
      setNote(T("studio.vb.added", { name: v.name }));
      return { ...toPick(v), id: String(body.voiceId || v.id) };
    } catch {
      setNote(T("studio.vb.addFailed"));
      return null;
    } finally {
      setBusy("");
    }
  }

  async function use(v: CatalogVoice) { const p = await ready(v); if (p) onUse(p); }
  async function offer(v: CatalogVoice) { const p = await ready(v); if (p) onOffer(p); }

  function useManual() {
    const id = manualId.trim();
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) { setNote(T("studio.vb.manualBad")); return; }
    const p: VoicePick = { id, name: manualName.trim().slice(0, 60) || id };
    if (side === "offer") onOffer(p); else onUse(p);
    setManualId(""); setManualName(""); setNote("");
  }

  const title = side === "offer" ? T("studio.vb.title.offer") : T(`studio.vb.title.${side}`);
  const wantLang = side === "offer" ? "" : side;

  return (
    <section className="voice-browser" aria-label={title}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        <button type="button" className="btn small ghost" onClick={onClose}>{T("studio.vb.close")}</button>
      </div>

      <div className="radio-cards" role="group" aria-label={T("studio.vb.source")}>
        <label><input type="radio" name="vb-source" checked={source === "account"} onChange={() => setSource("account")} />{T("studio.vb.source.account")}</label>
        <label><input type="radio" name="vb-source" checked={source === "library"} onChange={() => setSource("library")} />{T("studio.vb.source.library")}</label>
      </div>
      <small className="muted">{T(`studio.vb.source.${source}.help`)}</small>

      <div className="filters" role="search">
        <label style={{ flex: 1, minInlineSize: 180 }}>{T("studio.vb.search")}
          <input
            type="search" value={q} maxLength={80} placeholder={T("studio.vb.searchHint")}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void search(); } }}
          />
        </label>
        <label>{T("studio.vb.language")}
          <select value={lang} onChange={(e) => setLang(e.target.value)}>
            {LANGUAGES.map((l) => <option key={l} value={l}>{T(`studio.vb.language.${l || "any"}`)}</option>)}
          </select>
        </label>
        <label>{T("studio.vb.gender")}
          <select value={gender} onChange={(e) => setGender(e.target.value)}>
            {GENDERS.map((g) => <option key={g} value={g}>{T(`studio.vb.gender.${g || "any"}`)}</option>)}
          </select>
        </label>
        <label>{T("studio.vb.accent")}
          <input
            type="text" value={accent} maxLength={40} placeholder={T("studio.vb.accentHint")}
            onChange={(e) => setAccent(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void search(); } }}
          />
        </label>
        <button type="button" className="btn small" onClick={() => void search()}>{T("studio.vb.go")}</button>
      </div>

      {note && <div className="notice" role="status">{note}</div>}
      {load.kind === "nokey" && <div className="notice warn" role="status">{T("studio.vb.nokey")}</div>}
      {load.kind === "error" && <div className="notice warn" role="alert">{T("studio.vb.failed")} {load.message}</div>}

      <ul className="vb-list" aria-busy={load.kind === "loading"}>
        {voices.map((v) => {
          const verified = wantLang && v.languages.some((l) => l.language === wantLang);
          const isOffered = offeredIds.includes(v.id);
          return (
            <li key={`${v.source}-${v.id}`} className="vb-row">
              <div className="vb-info">
                <div className="row" style={{ gap: ".35rem" }}>
                  <strong>{v.name}</strong>
                  {v.gender && <span className="badge neutral">{genderText(T, v.gender)}</span>}
                  {v.accent && <span className="badge neutral">{v.accent}</span>}
                  {v.category && <span className="badge neutral">{v.category}</span>}
                  {verified && <span className="badge ok">{T(`studio.vb.verified.${wantLang}`)}</span>}
                  {v.source === "library" && <span className="badge info">{T("studio.vb.libraryBadge")}</span>}
                  {isOffered && <span className="badge ok">{T("studio.vb.offered")}</span>}
                </div>
                {(v.descriptive || v.description || v.useCase) && <small className="muted vb-desc">{[v.descriptive, v.useCase, v.description].filter(Boolean).join(" · ")}</small>}
                {v.languages.length > 0 && <small className="muted" dir="ltr">{v.languages.map((l) => l.language).slice(0, 12).join(", ")}</small>}
              </div>
              <div className="vb-actions">
                {v.previewUrl
                  ? <button type="button" className="btn small ghost" onClick={() => play(v)} aria-pressed={playing === v.id}>{playing === v.id ? T("studio.vb.stop") : T("studio.vb.play")}</button>
                  : <small className="muted">{T("studio.vb.noSample")}</small>}
                {side !== "offer" && <button type="button" className="btn small" disabled={busy === v.id} onClick={() => void use(v)}>{busy === v.id ? T("studio.vb.adding") : T(`studio.vb.use.${side}`)}</button>}
                <button type="button" className="btn small ghost" disabled={busy === v.id || isOffered} onClick={() => void offer(v)}>{T("studio.vb.offer")}</button>
              </div>
            </li>
          );
        })}
      </ul>
      {load.kind === "loading" && <p className="muted" role="status">{T("studio.vb.loading")}</p>}
      {load.kind === "idle" && voices.length === 0 && <p className="muted">{T(source === "account" ? "studio.vb.noneAccount" : "studio.vb.noneLibrary")}</p>}
      {more && load.kind !== "loading" && <div><button type="button" className="btn small ghost" onClick={() => void search(more)}>{T("studio.vb.more")}</button></div>}

      <details className="vb-manual">
        <summary className="muted">{T("studio.vb.manual")}</summary>
        <div className="filters">
          <label style={{ flex: 1, minInlineSize: 200 }}>{T("studio.vb.manualId")}
            <input type="text" dir="ltr" value={manualId} maxLength={64} onChange={(e) => setManualId(e.target.value)} placeholder="21m00Tcm4TlvDq8ikWAM" />
          </label>
          <label>{T("studio.vb.manualName")}
            <input type="text" value={manualName} maxLength={60} onChange={(e) => setManualName(e.target.value)} />
          </label>
          <button type="button" className="btn small ghost" onClick={useManual}>{side === "offer" ? T("studio.vb.offer") : T(`studio.vb.use.${side}`)}</button>
        </div>
        <small className="muted">{T("studio.vb.manualHelp")}</small>
      </details>
    </section>
  );
}
