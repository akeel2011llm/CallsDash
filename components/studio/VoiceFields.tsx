"use client";

import { useRef, useState } from "react";
import { OLDER_VOICE_IDS, ttsFor, ttsMeta } from "@/lib/agent-catalog";
import { CHOICES, LIMITS, type OfferedVoice, type VoiceNote } from "@/lib/agent-studio";
import { RangeField } from "./RangeField";
import { VoiceBrowser, type BrowserFor, type VoicePick } from "./VoiceBrowser";
import { text, type Labels } from "./text";

/** One of CallsDash's four own voices (voice_en_f ...), which stands in for a real ElevenLabs voice until another is chosen. */
export interface BuiltinVoice { id: string; name: string; language: "en" | "ar"; gender: string; realId: string }

export interface VoiceValue {
  voiceEn: string; voiceAr: string;
  ttsModelEn: string; ttsModelAr: string;
  stability: number; similarity: number; speed: number; textNormalisation: string; expressive: boolean;
  offered: OfferedVoice[];
  notes: Record<string, VoiceNote>;
}

function pickOf(id: string, notes: Record<string, VoiceNote>, builtins: BuiltinVoice[]): VoicePick {
  const b = builtins.find((x) => x.id === id);
  if (b) return { id, name: b.name, gender: b.gender, language: b.language };
  const n = notes[id];
  if (n) return { id, name: n.name, gender: n.gender, language: n.language, accent: n.accent, previewUrl: n.previewUrl };
  return { id, name: OLDER_VOICE_IDS[id] ?? id };
}

const offeredLanguage = (side: BrowserFor, p: VoicePick): OfferedVoice["language"] =>
  side === "en" ? "en" : side === "ar" ? "ar" : p.language === "ar" ? "ar" : p.language === "en" ? "en" : "both";

/**
 * The voice section of the Assistant studio: the voice for each language, the voice model behind it, how it is tuned, and
 * which voices the client may choose from. Rendered inside the page's form; the choices travel in hidden fields.
 */
export function VoiceFields({ value, builtins, labels }: { value: VoiceValue; builtins: BuiltinVoice[]; labels: Labels }) {
  const T = text(labels);
  const [en, setEn] = useState<VoicePick>(() => pickOf(value.voiceEn, value.notes, builtins));
  const [ar, setAr] = useState<VoicePick>(() => pickOf(value.voiceAr, value.notes, builtins));
  const [modelEn, setModelEn] = useState(value.ttsModelEn);
  const [modelAr, setModelAr] = useState(value.ttsModelAr);
  const [offered, setOffered] = useState<OfferedVoice[]>(value.offered);
  const [open, setOpen] = useState<BrowserFor | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);

  const show = (side: BrowserFor) => {
    setOpen(side);
    setTimeout(() => panel.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 50);
  };
  const expressive = [modelEn, modelAr].some((m) => ttsMeta(m)?.expressive);

  const addOffered = (side: BrowserFor, p: VoicePick) =>
    setOffered((cur) => (cur.some((o) => o.id === p.id) || cur.length >= LIMITS.offeredVoices ? cur : [...cur, {
      id: p.id, name: p.name, language: offeredLanguage(side, p), gender: p.gender, accent: p.accent, previewUrl: p.previewUrl,
    }]));

  const hidden = (key: "voiceEn" | "voiceAr", p: VoicePick) => (
    <>
      <input type="hidden" name={key} value={p.id} />
      <input type="hidden" name={`${key}Name`} value={p.name} />
      <input type="hidden" name={`${key}Preview`} value={p.previewUrl ?? ""} />
      <input type="hidden" name={`${key}Gender`} value={p.gender ?? ""} />
      <input type="hidden" name={`${key}Lang`} value={p.language ?? ""} />
      <input type="hidden" name={`${key}Accent`} value={p.accent ?? ""} />
    </>
  );

  const side = (lang: "en" | "ar") => {
    const p = lang === "en" ? en : ar;
    const model = lang === "en" ? modelEn : modelAr;
    const setModel = lang === "en" ? setModelEn : setModelAr;
    const builtin = builtins.find((b) => b.id === p.id);
    const realId = builtin?.realId ?? p.id;
    const older = OLDER_VOICE_IDS[realId];
    const notArabic = lang === "ar" && !builtin && p.language && p.language !== "ar";
    const models = ttsFor(lang, model);
    const meta = ttsMeta(model);
    return (
      <section className="card stack" key={lang} aria-label={T(`studio.voice.${lang}`)}>
        <h3 style={{ margin: 0 }}>{T(`studio.voice.${lang}`)}</h3>
        <small className="muted">{T(`studio.voice.${lang}.help`)}</small>
        {hidden(lang === "en" ? "voiceEn" : "voiceAr", p)}
        <div className="vb-current">
          <div className="vb-info">
            <div className="row" style={{ gap: ".35rem" }}>
              <strong>{p.name}</strong>
              {builtin && <span className="badge neutral">{T("studio.voice.builtin")}</span>}
              {p.gender && <span className="badge neutral">{["female", "male", "neutral"].includes(p.gender) ? T(`studio.vb.gender.${p.gender}`) : p.gender}</span>}
              {p.accent && <span className="badge neutral">{p.accent}</span>}
            </div>
            <small className="muted" dir="ltr">{builtin ? `${p.id} → ${realId}` : p.id}</small>
          </div>
          {p.previewUrl && <audio controls preload="none" src={p.previewUrl} aria-label={T("studio.voice.sample", { name: p.name })} />}
        </div>
        {older && <div className="notice warn" role="status">{T("studio.voice.older", { name: older })}</div>}
        {notArabic && <div className="notice warn" role="status">{T("studio.voice.notArabic")}</div>}
        <div><button type="button" className="btn small" onClick={() => show(lang)}>{T("studio.voice.change")}</button></div>

        <label>{T(`studio.voice.model.${lang}`)}
          <select name={lang === "en" ? "ttsModelEn" : "ttsModelAr"} value={model} onChange={(e) => setModel(e.target.value)}>
            {models.some((m) => m.id === model) ? null : <option value={model}>{model}</option>}
            {models.map((m) => <option key={m.id} value={m.id}>{m.label}{m.latency ? ` · ${m.latency}` : ""}{m.deprecated ? ` · ${T("studio.voice.model.retired")}` : ""}{m.recordedOnly ? ` · ${T("studio.voice.model.recorded")}` : ""}</option>)}
          </select>
          <small className="muted">{meta ? T(`studio.tts.${meta.id}`) : T("studio.voice.model.unknown")}</small>
        </label>
        {lang === "ar" && <small className="muted">{T("studio.voice.model.arabicOnly")}</small>}
      </section>
    );
  };

  return (
    <div className="stack">
      <div className="grid two">{side("en")}{side("ar")}</div>

      <div ref={panel}>
        {open && (
          <VoiceBrowser
            key={open}
            side={open}
            labels={labels}
            offeredIds={offered.map((o) => o.id)}
            onClose={() => setOpen(null)}
            onUse={(p) => { (open === "en" ? setEn : setAr)(p); setOpen(null); }}
            onOffer={(p) => addOffered(open, p)}
          />
        )}
      </div>

      <div className="grid two">
        <RangeField name="stability" label={T("studio.f.stability")} hint={T("studio.h.stability")} min={LIMITS.stability[0]} max={LIMITS.stability[1]} step={0.05} defaultValue={value.stability} />
        <RangeField name="similarity" label={T("studio.f.similarity")} hint={T("studio.h.similarity")} min={LIMITS.similarity[0]} max={LIMITS.similarity[1]} step={0.05} defaultValue={value.similarity} />
        <RangeField name="speed" label={T("studio.f.speed")} hint={T("studio.h.speed")} min={LIMITS.speed[0]} max={LIMITS.speed[1]} step={0.05} defaultValue={value.speed} suffix="×" />
        <label>{T("studio.f.textNormalisation")}
          <select name="textNormalisation" defaultValue={value.textNormalisation}>
            {CHOICES.textNormalisation.map((c) => <option key={c} value={c}>{T(`studio.opt.textNormalisation.${c}`)}</option>)}
          </select>
          <small className="muted">{T("studio.h.textNormalisation")}</small>
        </label>
      </div>
      <label className="inline">
        <input type="checkbox" name="expressive" defaultChecked={value.expressive && expressive} disabled={!expressive} />
        <span>{T("studio.f.expressive")}<small className="muted" style={{ display: "block" }}>{expressive ? T("studio.h.expressive") : T("studio.h.expressiveOff")}</small></span>
      </label>
      {expressive && <small className="muted">{T("studio.voice.v3Note")}</small>}

      <section className="stack" aria-label={T("studio.voice.offered")}>
        <input type="hidden" name="offered" value={JSON.stringify(offered)} />
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>{T("studio.voice.offered")}</h3>
          <button type="button" className="btn small ghost" disabled={offered.length >= LIMITS.offeredVoices} onClick={() => show("offer")}>{T("studio.voice.offered.add")}</button>
        </div>
        <small className="muted">{T("studio.voice.offered.help")}</small>
        {offered.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>{T("studio.voice.offered.none")}</p>
        ) : (
          <ul className="vb-list">
            {offered.map((o) => (
              <li key={o.id} className="vb-row">
                <div className="vb-info">
                  <div className="row" style={{ gap: ".35rem" }}>
                    <strong>{o.name}</strong>
                    {o.gender && <span className="badge neutral">{["female", "male", "neutral"].includes(o.gender) ? T(`studio.vb.gender.${o.gender}`) : o.gender}</span>}
                    {o.accent && <span className="badge neutral">{o.accent}</span>}
                  </div>
                  <small className="muted" dir="ltr">{o.id}</small>
                </div>
                <div className="vb-actions">
                  {o.previewUrl && <audio controls preload="none" src={o.previewUrl} aria-label={T("studio.voice.sample", { name: o.name })} />}
                  <select
                    aria-label={T("studio.voice.offered.language", { name: o.name })} value={o.language}
                    onChange={(e) => setOffered((cur) => cur.map((x) => (x.id === o.id ? { ...x, language: e.target.value as OfferedVoice["language"] } : x)))}
                  >
                    {(["en", "ar", "both"] as const).map((l) => <option key={l} value={l}>{T(`studio.voice.offered.lang.${l}`)}</option>)}
                  </select>
                  <button type="button" className="btn small danger" onClick={() => setOffered((cur) => cur.filter((x) => x.id !== o.id))}>{T("studio.voice.offered.remove")}</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
