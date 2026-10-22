"use client";

import { useState } from "react";
import { PROVIDER_LABEL, rowFor, type ModelRow } from "@/lib/agent-catalog";
import { CHOICES, LIMITS } from "@/lib/agent-studio";
import { costLine, fmtBhd, fmtUsd, marginOf, marginTone, monthlyCostUsd, toBhd, type Fees } from "@/lib/pricing";
import { RangeField } from "./RangeField";
import { text, type Labels } from "./text";

export interface ModelValue {
  llm: string; temperature: number; maxTokens: number; reasoningEffort: string; parallelTools: boolean;
  backupMode: string; backupModels: string[]; cascadeSeconds: number;
}

const FILTERS = ["all", "best", "openai", "google", "anthropic", "elevenlabs"] as const;
type Filter = (typeof FILTERS)[number];

const fmtK = (n?: number) => (n === undefined ? "" : n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));
const daysUntil = (iso: string, today: string) => Math.round((Date.parse(iso) - Date.parse(today)) / 86_400_000);

/**
 * The model section of the Assistant studio: pick the language model with its cost and our margin shown for each, then the
 * settings that depend on it. Rendered inside the page's form; the choices travel in the form's fields.
 */
export function ModelFields({ rows, defaultLlm, value, fees, rate, usage, today, liveInfo, labels }: {
  rows: ModelRow[];
  defaultLlm: string;
  value: ModelValue;
  fees: Fees;
  /** What the client pays for one credit in dinar (their cheapest plan), or null without a plan. */
  rate: number | null;
  /** The last 30 days: voice minutes and chat messages. */
  usage: { voiceMinutes: number; messages: number };
  today: string;
  /** False when ElevenLabs' model list was out of reach, so what each model supports is not known. */
  liveInfo: boolean;
  labels: Labels;
}) {
  const T = text(labels);
  const [sel, setSel] = useState(value.llm); // "" follows the platform default
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [backupMode, setBackupMode] = useState(value.backupMode);
  const [effort, setEffort] = useState(value.reasoningEffort);
  const effective = sel || defaultLlm;
  const find = (id: string) => rowFor(rows, id);
  const row = find(effective);
  const saved = find(value.llm || defaultLlm);

  const costOf = (r: ModelRow) => costLine(r.price, fees);
  const marginFor = (r: ModelRow) => (rate ? marginOf(rate, costOf(r)) : null);
  const cost = costOf(row);
  const margin = marginFor(row);
  const month = monthlyCostUsd(usage, cost);
  const monthSaved = monthlyCostUsd(usage, costOf(saved));

  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => {
    if (filter === "best" && !r.advice) return false;
    if (filter !== "all" && filter !== "best" && r.provider !== filter) return false;
    return !needle || r.label.toLowerCase().includes(needle) || r.id.includes(needle);
  });

  const efforts = row.reasoningEfforts.length ? row.reasoningEfforts : liveInfo ? [] : [...CHOICES.reasoningEffort];
  const effortValue = efforts.includes(effort) ? effort : "";
  const days = row.retires ? daysUntil(row.retires, today) : null;
  const notes: string[] = [];
  if (days !== null && days <= 180) notes.push(T("studio.model.retires", { date: row.retires!, days: Math.max(0, days) }));
  if (row.deprecated?.inWarning || row.deprecated?.isDeprecated) notes.push(row.deprecated.replacement ? T("studio.model.deprecatedTo", { model: row.deprecated.replacement }) : T("studio.model.deprecated"));
  if (!row.temperature) notes.push(T("studio.model.noTemperature"));
  if (row.price.source !== "elevenlabs") notes.push(T(row.price.source === "estimate" ? "studio.model.estimateNote" : "studio.model.unknownNote"));
  notes.push(T("studio.model.arabicNote"));

  const maxTokensCap = Math.min(LIMITS.maxTokens[1], row.maxOutputTokens ?? LIMITS.maxTokens[1]);

  return (
    <div className="stack">
      <input type="hidden" name="llm" value={sel} />
      <div className="stack" style={{ gap: ".5rem" }}>
        <div className="filters">
          <label style={{ flex: 1, minInlineSize: 200 }}>{T("studio.model.search")}
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={T("studio.model.searchHint")} />
          </label>
        </div>
        <div className="radio-cards" role="group" aria-label={T("studio.model.filter")}>
          {FILTERS.map((f) => (
            <label key={f}><input type="radio" name="model-filter" checked={filter === f} onChange={() => setFilter(f)} />{T(`studio.model.filter.${f}`)}</label>
          ))}
        </div>
        <div className="model-row model-head" aria-hidden="true">
          <span />
          <span>{T("studio.model.col.model")}</span>
          <span className="num">{T("studio.model.col.cost")}</span>
          <span className="num">{T("studio.model.col.keep")}</span>
        </div>
        <div className="model-list" role="radiogroup" aria-label={T("studio.model.list")}>
          <label className="model-row">
            <input type="radio" name="model-pick" checked={sel === ""} onChange={() => setSel("")} />
            <span><strong>{T("studio.model.followDefault", { model: find(defaultLlm).label })}</strong></span>
            <span className="num" dir="ltr">{fmtUsd(costOf(find(defaultLlm)).minuteUsd)}</span>
            {marginFor(find(defaultLlm)) ? <span className={`badge ${marginTone(marginFor(find(defaultLlm))!.voicePct)}`} dir="ltr">{marginFor(find(defaultLlm))!.voicePct}%</span> : <span />}
          </label>
          {shown.map((r) => {
            const m = marginFor(r);
            const d = r.retires ? daysUntil(r.retires, today) : null;
            return (
              <label key={r.id} className="model-row">
                <input type="radio" name="model-pick" checked={sel === r.id} onChange={() => setSel(r.id)} />
                <span>
                  <strong>{r.label}</strong> <small className="muted">{PROVIDER_LABEL[r.provider]}</small>
                  {r.advice && <> <span className="badge info">{T(`studio.model.advice.${r.advice}`)}</span></>}
                  {r.id === defaultLlm && <> <span className="badge neutral">{T("studio.model.default")}</span></>}
                  {d !== null && d <= 120 && <> <span className="badge warn">{T("studio.model.retiringBadge")}</span></>}
                  {!r.temperature && <> <span className="badge neutral">{T("studio.model.noTemperatureBadge")}</span></>}
                </span>
                <span className="num" dir="ltr" title={T(`studio.model.price.${r.price.source}`)}>{fmtUsd(costOf(r).minuteUsd)}{r.price.source !== "elevenlabs" && "*"}</span>
                {m ? <span className={`badge ${marginTone(m.voicePct)}`} dir="ltr">{m.voicePct}%</span> : <span />}
              </label>
            );
          })}
          {shown.length === 0 && <p className="muted" style={{ padding: ".7rem" }}>{T("studio.model.none")}</p>}
        </div>
        <small className="muted">{T("studio.model.listHelp")}</small>
      </div>

      <section className="model-sum card" aria-live="polite">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>{row.label} <small className="muted">{PROVIDER_LABEL[row.provider]}</small></h3>
          <span className={`badge ${row.price.source === "elevenlabs" ? "ok" : "warn"}`}>{T(`studio.model.price.${row.price.source}`)}</span>
        </div>
        <div className="grid two" style={{ gap: ".75rem" }}>
          <div>
            <strong>{T("studio.model.sum.voice")}</strong>
            <dl className="scan-grid">
              <dt>{T("studio.model.sum.model")}</dt><dd dir="ltr">{fmtUsd(row.price.perMinute)}</dd>
              <dt>{T("studio.model.sum.fee")}</dt><dd dir="ltr">{fmtUsd(fees.minuteUsd)}</dd>
              <dt>{T("studio.model.sum.total")}</dt><dd dir="ltr"><strong>{fmtUsd(cost.minuteUsd)}</strong> · {fmtBhd(toBhd(cost.minuteUsd))}</dd>
              {margin && <><dt>{T("studio.model.sum.clientPays")}</dt><dd dir="ltr">{fmtBhd(margin.clientMinuteBhd)}</dd>
                <dt>{T("studio.model.sum.keep")}</dt><dd><span className={`badge ${marginTone(margin.voicePct)}`} dir="ltr">{margin.voicePct}%</span></dd></>}
            </dl>
          </div>
          <div>
            <strong>{T("studio.model.sum.chat")}</strong>
            <dl className="scan-grid">
              <dt>{T("studio.model.sum.model")}</dt><dd dir="ltr">{fmtUsd(row.price.perMessage)}</dd>
              <dt>{T("studio.model.sum.fee")}</dt><dd dir="ltr">{fmtUsd(fees.messageUsd)}</dd>
              <dt>{T("studio.model.sum.total")}</dt><dd dir="ltr"><strong>{fmtUsd(cost.messageUsd)}</strong> · {fmtBhd(toBhd(cost.messageUsd))}</dd>
              {margin && <><dt>{T("studio.model.sum.clientPays")}</dt><dd dir="ltr">{fmtBhd(margin.clientMessageBhd)}</dd>
                <dt>{T("studio.model.sum.keep")}</dt><dd><span className={`badge ${marginTone(margin.textPct)}`} dir="ltr">{margin.textPct}%</span></dd></>}
            </dl>
          </div>
        </div>
        {!margin && <small className="muted">{T("studio.model.noPlan")}</small>}
        <dl className="scan-grid">
          <dt>{T("studio.model.sum.month")}</dt>
          <dd dir="ltr">{fmtUsd(month)} · {fmtBhd(toBhd(month))}{effective !== (value.llm || defaultLlm) && <> <small className="muted">({T("studio.model.sum.monthNow", { now: fmtUsd(monthSaved) })})</small></>}</dd>
          {row.tokens && <><dt>{T("studio.model.sum.tokens")}</dt><dd dir="ltr">${row.tokens[0]} / ${row.tokens[1]} / ${row.tokens[2]}</dd></>}
          {(row.contextTokens || row.maxOutputTokens) && <><dt>{T("studio.model.sum.limits")}</dt>
            <dd dir="ltr">{row.contextTokens ? T("studio.model.sum.context", { n: fmtK(row.contextTokens) }) : ""}{row.contextTokens && row.maxOutputTokens ? " · " : ""}{row.maxOutputTokens ? T("studio.model.sum.maxOut", { n: fmtK(row.maxOutputTokens) }) : ""}</dd></>}
        </dl>
        <ul className="notes">{notes.map((n) => <li key={n}><small>{n}</small></li>)}</ul>
        <small className="muted">{T("studio.model.sum.how", { minutes: usage.voiceMinutes, messages: usage.messages })}</small>
      </section>

      <div className="grid two">
        <RangeField name="temperature" label={T("studio.model.temperature")} hint={row.temperature ? T("studio.model.temperatureHelp") : T("studio.model.noTemperature")} min={LIMITS.temperature[0]} max={LIMITS.temperature[1]} step={0.05} defaultValue={value.temperature} disabled={!row.temperature} />
        <label>{T("studio.model.maxTokens")}
          <input type="number" name="maxTokens" min={0} max={maxTokensCap} step={1} defaultValue={value.maxTokens} inputMode="numeric" dir="ltr" />
          <small className="muted">{T("studio.model.maxTokensHelp", { max: maxTokensCap })}</small>
        </label>
        <label>{T("studio.model.effort")}
          <select name="reasoningEffort" value={effortValue} onChange={(e) => setEffort(e.target.value)}>
            <option value="">{T("studio.model.effort.default")}</option>
            {efforts.map((x) => <option key={x} value={x}>{T(`studio.effort.${x}`)}</option>)}
          </select>
          <small className="muted">{efforts.length ? T("studio.model.effortHelp") : T("studio.model.effortNone")}</small>
        </label>
        <label className="inline" style={{ alignSelf: "center" }}>
          <input type="checkbox" name="parallelTools" defaultChecked={value.parallelTools} disabled={row.parallelTools === false} />
          <span>{T("studio.model.parallel")}<small className="muted" style={{ display: "block" }}>{row.parallelTools === false ? T("studio.model.parallelNo") : T("studio.model.parallelHelp")}</small></span>
        </label>
      </div>

      <div className="stack" style={{ gap: ".5rem" }}>
        <div className="grid two">
          <label>{T("studio.model.backup")}
            <select name="backupMode" value={backupMode} onChange={(e) => setBackupMode(e.target.value)}>
              {CHOICES.backupMode.map((m) => <option key={m} value={m}>{T(`studio.model.backup.${m}`)}</option>)}
            </select>
            <small className="muted">{T(`studio.model.backupHelp.${backupMode}`)}</small>
          </label>
          <label>{T("studio.model.cascade")}
            <input type="number" name="cascadeSeconds" min={LIMITS.cascadeSeconds[0]} max={LIMITS.cascadeSeconds[1]} step={0.5} defaultValue={value.cascadeSeconds} inputMode="decimal" dir="ltr" />
            <small className="muted">{T("studio.model.cascadeHelp")}</small>
          </label>
        </div>
        {backupMode === "custom" && (
          <div className="grid">
            {[0, 1, 2].map((i) => (
              <label key={i}>{T("studio.model.backupN", { n: i + 1 })}
                <select name="backupModels" defaultValue={value.backupModels[i] ?? ""}>
                  <option value="">{T("studio.model.backupNone")}</option>
                  {rows.filter((r) => r.id !== effective).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
