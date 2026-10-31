import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { dictionaries, getT } from "@/lib/i18n";
import { fmtDateTime } from "@/lib/format";
import { getAgent, getConversations, getDoctors, getKnowledge, getSetting, getTenant } from "@/lib/data";
import { RECORDING_NOTICE, greeting, knowledgeText, mentionsRecording } from "@/lib/agent-config";
import { agentTags, criteriaFor } from "@/lib/agent-extras";
import { PROVIDER_LABEL, defaultLlm, rowFor } from "@/lib/agent-catalog";
import { CHOICES, LIMITS, audioTagLines, studioOf, type SectionId, type VoiceNote } from "@/lib/agent-studio";
import { EXAMPLE_USAGE, clientRatePerCredit, costLine, fmtBhd, fmtUsd, marginOf, marginTone, toBhd } from "@/lib/pricing";
import { catalogFromEnv, explainCatalogError, type CatalogVoice, type EffectsCatalog } from "@/lib/elevenlabs-catalog";
import { liveRows, liveSummary, liveTexts, type LiveRow, type LiveText, type LiveValue } from "@/lib/studio-live";
import { loadFees, modelBook } from "@/lib/studio-server";
import { failKey, failToShow } from "@/lib/studio-fail";
import { deleteHoldAudioAction, refreshModelsAction, resetStudioSectionAction, saveStudioSectionAction, applyRecommendedAction } from "@/lib/studio-actions";
import { diffValues, fieldOf, recommendedFor } from "@/lib/studio-profiles";
import { businessOf } from "@/lib/business-types";
import { VOICES, resolveVoiceId } from "@/lib/voices";
import type { AgentSettings, Tenant } from "@/lib/types";
import { ConfirmDelete } from "@/components/Confirm";
import { Fold } from "@/components/Fold";
import { FoldControls } from "@/components/FoldControls";
import { SubmitButton } from "@/components/SubmitButton";
import { TryAssistant } from "@/components/TryAssistant";
import { Badge, Notice, PageHead, Stat } from "@/components/ui";
import { ModelFields } from "@/components/studio/ModelFields";
import { RangeField } from "@/components/studio/RangeField";
import { TextDiff } from "@/components/studio/TextDiff";
import { VoiceFields, type BuiltinVoice } from "@/components/studio/VoiceFields";
import { text } from "@/components/studio/text";
import { showValue } from "@/components/studio/show-value";

type Params = { id: string };
type Query = {
  section?: string; done?: string; why?: string; warn?: string; fail?: string; bad?: string;
  refreshed?: string; feesSaved?: string; feesBad?: string; saved?: string; error?: string; hold?: string;
};

const HOLD_OK = ["uploaded", "removed"];
/** Above this much knowledge, searching it (RAG) is suggested instead of giving the assistant all of it on every turn. */
const RAG_ADVICE_CHARS = 30_000;
const HOLD_ERR = ["missing", "too_big", "not_audio", "no_agent", "no_key", "refused", "confirm"];

const SECTION_ORDER: SectionId[] = ["model", "voice", "conversation", "hearing", "knowledge", "safety", "analysis", "widget"];
const FIELD = /^[\w.]{1,40}$/;
const KEY = /^studio\.err\.\w{1,30}$/;
const CODE = /^[a-z_]{3,30}$/;
const GROUP = /^[a-z]{3,20}$/;

/** Names for the voices an assistant uses that the studio has not seen before (set by hand, or before the studio existed). Never slows the page for long. */
async function nameVoices(ids: string[]): Promise<Record<string, VoiceNote>> {
  const api = catalogFromEnv();
  if (!api || !ids.length) return {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const found = await Promise.race<CatalogVoice[]>([api.getVoices(ids), new Promise<CatalogVoice[]>((_, no) => { timer = setTimeout(() => no(new Error("slow")), 3000); })]);
    return Object.fromEntries(found.map((v) => [v.id, { name: v.name, gender: v.gender, language: v.language, accent: v.accent, previewUrl: v.previewUrl }]));
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}

/** A short fingerprint of a text (djb2), to key a form by the values it shows. */
const hashOf = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

/** ElevenLabs' audio-effects catalogue for the voice section's lists. Null when it cannot be had quickly (no key, slow, refused). */
async function loadEffects(): Promise<EffectsCatalog | null> {
  const api = catalogFromEnv();
  if (!api) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race<EffectsCatalog>([api.audioEffects(), new Promise<EffectsCatalog>((_, no) => { timer = setTimeout(() => no(new Error("slow")), 3000); })]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export default async function AssistantStudioPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Query> }) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const tenant = await getTenant(id);
  if (!tenant) notFound();
  const { locale } = await getT(tenant);
  const dict = dictionaries[locale] as Record<string, string>;
  const T = text(dict);
  /** The texts a client component needs, picked by prefix so a page does not ship the whole dictionary. */
  const labelsFor = (...prefixes: string[]) => Object.fromEntries(Object.entries(dict).filter(([k]) => prefixes.some((p) => k.startsWith(p))));

  const [agent, doctors, conversations, fees, effects, knowledge] = await Promise.all([getAgent(id), getDoctors(id), getConversations(id), loadFees(), loadEffects(), getKnowledge(id)]);
  const knowledgeChars = knowledgeText(knowledge).length;
  const st = studioOf(agent);
  // ElevenLabs' reason for the last refusal is read from here, never from the address, so a link cannot put its own words on this screen
  const failed = sp.fail && SECTION_ORDER.includes(sp.section as SectionId)
    ? failToShow(await getSetting(failKey(id)).catch(() => undefined), sp.section as SectionId) ?? T("studio.fail.noDetail")
    : null;
  const fallbackLlm = defaultLlm();
  const effective = st.llm || fallbackLlm;
  const book = await modelBook(id, { keep: [fallbackLlm, effective, ...st.backupModels] });
  const today = new Date().toISOString().slice(0, 10);

  // what the same month would cost with the saved model: real usage when there is enough, an example month otherwise
  const since = Date.now() - 30 * 86_400_000;
  const recent = conversations.filter((c) => Date.parse(c.startedAt) >= since);
  const isExample = recent.length < 5;
  const usage = isExample ? EXAMPLE_USAGE : {
    voiceMinutes: Math.round(recent.filter((c) => c.mode === "voice").reduce((n, c) => n + c.durationSec / 60, 0)),
    messages: recent.filter((c) => c.mode === "text").reduce((n, c) => n + c.messages, 0),
  };
  const rate = clientRatePerCredit(tenant.plans);
  const savedRow = rowFor(book.rows, effective);
  const savedCost = costLine(savedRow.price, fees);
  const margin = rate ? marginOf(rate, savedCost) : null;

  const builtins: BuiltinVoice[] = VOICES.map((v) => ({ id: v.id, name: v.name, language: v.language, gender: v.gender, realId: resolveVoiceId(v.id, v.language) }));
  const offeredNotes: Record<string, VoiceNote> = Object.fromEntries(st.offeredVoices.map((v) => [v.id, { name: v.name, gender: v.gender, accent: v.accent, previewUrl: v.previewUrl }]));
  const known = { ...offeredNotes, ...st.voiceNotes };
  const unnamed = [agent.voiceEn, agent.voiceAr].filter((v, i, a) => a.indexOf(v) === i && !builtins.some((b) => b.id === v) && !known[v]);
  const notes = { ...(await nameVoices(unnamed)), ...known };

  const returnTo = `/admin/clients/${id}/assistant`;
  const touched = (s: SectionId) => st.touched.includes(s);
  const f = (name: string) => T(`studio.f.${name}`);
  const help = (name: string) => (dict[`studio.h.${name}`] ? <small className="muted">{dict[`studio.h.${name}`]}</small> : null);

  /* ----- small field builders: the labels, help and option names all come from the same keys ----- */
  const num = (name: string, value: number, o: { min: number; max: number; step?: number }) => (
    <label>{f(name)}
      <input type="number" name={name} defaultValue={value} min={o.min} max={o.max} step={o.step ?? 1} inputMode="decimal" dir="ltr" />
      {help(name)}
    </label>
  );
  const check = (name: string, value: boolean) => (
    <label className="inline">
      <input type="checkbox" name={name} defaultChecked={value} />
      <span>{f(name)}{dict[`studio.h.${name}`] && <small className="muted" style={{ display: "block" }}>{dict[`studio.h.${name}`]}</small>}</span>
    </label>
  );
  const select = (name: string, value: string, options: readonly string[]) => (
    <label>{f(name)}
      <select name={name} defaultValue={value}>
        {options.map((o) => <option key={o} value={o}>{T(`studio.opt.${name}.${o || "default"}`)}</option>)}
      </select>
      {help(name)}
    </label>
  );
  const radios = (name: string, value: string, options: readonly string[]) => (
    <div className="stack" style={{ gap: ".4rem" }} role="radiogroup" aria-label={f(name)}>
      <strong style={{ fontSize: ".88rem" }}>{f(name)}</strong>
      <div className="radio-cards">
        {options.map((o) => <label key={o}><input type="radio" name={name} value={o} defaultChecked={o === value} />{T(`studio.opt.${name}.${o}`)}</label>)}
      </div>
      {help(name)}
    </div>
  );
  const line = (name: string, value: string, o: { rtl?: boolean; max: number; placeholder?: string }) => (
    <label>{f(name)}
      <input type="text" name={name} defaultValue={value} maxLength={o.max} dir={o.rtl ? "rtl" : undefined} placeholder={o.placeholder} />
      {help(name)}
    </label>
  );
  const area = (name: string, value: string, o: { rtl?: boolean; max: number; placeholder?: string; rows?: number }) => (
    <label>{f(name)}
      <textarea name={name} defaultValue={value} maxLength={o.max} rows={o.rows ?? 4} dir={o.rtl ? "rtl" : undefined} placeholder={o.placeholder} />
      {help(name)}
    </label>
  );
  /** A list from ElevenLabs' effects catalogue, with "None" first; a saved id ElevenLabs no longer lists stays selectable. */
  const effectSelect = (name: string, value: string, options: { id: string; name: string; description?: string }[] | undefined) => {
    const list = [...(options ?? [])];
    if (value && !list.some((o) => o.id === value)) list.push({ id: value, name: value });
    return (
      <label>{f(name)}
        <select name={name} defaultValue={value}>
          <option value="">{T("studio.fx.none")}</option>
          {list.map((o) => <option key={o.id} value={o.id} title={o.description}>{o.name}</option>)}
        </select>
      </label>
    );
  };
  const colour = (name: string, value: string) => (
    <label>{f(name)}<input type="color" name={name} defaultValue={value} /></label>
  );

  /* ----- what happened on the last save ----- */
  const outcome = (section: SectionId) => {
    if (sp.section !== section) return null;
    const bad = (sp.bad ?? "").split(",").map((p) => p.split(":")).filter(([field, key]) => FIELD.test(field ?? "") && KEY.test(key ?? ""));
    const groups = (sp.warn ?? "").split(",").filter((g) => GROUP.test(g));
    const details = tenant.integrations.elevenlabs?.warnings ?? [];
    return (
      <>
        {bad.length > 0 && (
          <Notice tone="warn">
            <strong>{T("studio.bad")}</strong>
            <ul className="notes">{bad.map(([field, key]) => <li key={field}>{f(field)}: {T(key, { min: LIMITS.maxTokens[0] })}</li>)}</ul>
          </Notice>
        )}
        {failed && <Notice tone="warn">{T("studio.fail", { detail: failed })}</Notice>}
        {sp.done === "applied" && <Notice tone="ok">{T("studio.done.applied")} <a href="#try">{T("studio.done.test")}</a></Notice>}
        {sp.done === "saved" && <Notice tone="warn">{T("studio.done.saved")} {sp.why === "no_agent" ? T("studio.done.saved.no_agent") : CODE.test(sp.why ?? "") ? T(`channels.err.${sp.why}`) : ""}</Notice>}
        {groups.length > 0 && (
          <Notice tone="warn">
            {T("studio.done.warn", { groups: groups.map((g) => T(`channels.group.${g}`)).join(", ") })}
            <ul className="notes">{details.filter((d) => groups.includes(d.group)).map((d) => <li key={d.group}><small>{T(`channels.group.${d.group}`)}: {d.detail}</small></li>)}</ul>
          </Notice>
        )}
      </>
    );
  };

  /** One folded card per section, each with its own form: saving one never touches the others. The one just saved opens by itself. */
  const has = (k: string) => k in dict;
  const formKey = hashOf(JSON.stringify([agent.studio ?? null, agent.temperature, agent.voiceEn, agent.voiceAr]));
  /** The section's recommended values, what each does, and the button that puts them on. */
  const recommend = (key: SectionId) => {
    const values = recommendedFor(key);
    const keys = Object.keys(values);
    if (!keys.length) return <small className="muted">{T("studio.rec.none")}</small>;
    const differ = diffValues(agent, values).changes.length;
    return (
      <details className="recommend">
        <summary>{T("studio.rec.summary", { n: keys.length })} · <span className={differ ? "" : "muted"}>{differ ? T("studio.rec.differs", { n: differ }) : T("studio.rec.same")}</span></summary>
        <p className="muted" style={{ margin: ".4rem 0" }}>{T("studio.rec.help")}</p>
        <div className="table-wrap">
          <table className="live">
            <thead><tr><th>{T("studio.rec.col.setting")}</th><th>{T("studio.rec.col.value")}</th><th>{T("studio.rec.col.why")}</th></tr></thead>
            <tbody>
              {keys.map((k) => {
                const hint = fieldOf(k)?.hint;
                return (
                  <tr key={k}>
                    <td>{f(k)}</td>
                    <td dir="auto" data-label={T("studio.rec.col.value")}>{showValue(k, values[k], T, has)}</td>
                    <td data-label={T("studio.rec.col.why")}><small className="muted">{hint && has(`prof.h.${hint}`) ? T(`prof.h.${hint}`) : ""}</small></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {differ > 0 && (
          <form action={applyRecommendedAction} className="stack" style={{ gap: ".5rem", marginBlockStart: ".5rem" }}>
            <input type="hidden" name="tenantId" value={id} /><input type="hidden" name="section" value={key} />
            <label className="inline"><input type="checkbox" name="confirm" required />{T("studio.rec.tick")}</label>
            <div><SubmitButton className="btn small" type="submit">{T("studio.rec.button")}</SubmitButton></div>
          </form>
        )}
      </details>
    );
  };

  const section = (key: SectionId, body: React.ReactNode, before?: React.ReactNode, after?: React.ReactNode) => (
    <Fold
      key={key} id={key} open={sp.section === key} title={T(`studio.sec.${key}`)} hint={T(`studio.sec.${key}.help`)}
      badge={<Badge tone={touched(key) ? "info" : "neutral"}>{T(touched(key) ? "studio.state.custom" : "studio.state.default")}</Badge>}
    >
      {outcome(key)}
      {before}
      {/* keyed by what is saved, so after a save, "Use recommended" or a reset the form shows the new values (a select keeps its old choice otherwise) */}
      <form key={formKey} action={saveStudioSectionAction} className="stack">
        <input type="hidden" name="tenantId" value={id} />
        <input type="hidden" name="section" value={key} />
        <input type="hidden" name="more" value="1" />
        {body}
        <div className="row"><SubmitButton className="btn" type="submit">{T("studio.save")}</SubmitButton><small className="muted">{T("studio.save.help")}</small></div>
      </form>
      {after}
      {recommend(key)}
      <ConfirmDelete action={resetStudioSectionAction} summary={T("studio.reset.summary")} warning={T(key === "voice" ? "studio.reset.warning.voice" : "studio.reset.warning")} tick={T("studio.reset.tick")} button={T("studio.reset.button")} fields={{ tenantId: id, section: key }} />
    </Fold>
  );

  /* ----- the model section's list notice ----- */
  const when = book.at ? fmtDateTime(book.at, locale) : "";
  const listNote = book.source === "live" ? T("studio.model.listLive", { date: when })
    : book.source === "saved" ? T("studio.model.listSaved", { date: when })
    : T("studio.model.listBuiltin");
  const modelBefore = (
    <div className="stack" style={{ gap: ".5rem" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="row"><Badge tone={book.source === "live" ? "ok" : "warn"}>{T(`studio.model.source.${book.source}`)}</Badge><small className="muted">{listNote}</small></span>
        <form action={refreshModelsAction}>
          <input type="hidden" name="tenantId" value={id} />
          <SubmitButton className="btn small ghost" type="submit">{T("studio.model.refresh")}</SubmitButton>
        </form>
      </div>
      {book.noKey && <Notice tone="warn">{T("studio.model.noKey")}</Notice>}
      {book.problem && !book.noKey && <Notice tone="warn">{book.problem}</Notice>}
      {book.priceProblem && <Notice tone="warn">{T("studio.model.pricesLate")} {book.priceProblem}</Notice>}
      {sp.refreshed && <Notice tone="ok">{T("studio.refreshed")}</Notice>}
    </div>
  );

  const modelLabels = { ...labelsFor("studio.model.", "studio.effort.", "studio.err.tokensLow"), "studio.model.sum.how": T(isExample ? "studio.model.sum.howExample" : "studio.model.sum.how") };
  const voiceLabels = labelsFor("studio.vb.", "studio.voice.", "studio.tts.", "studio.opt.textNormalisation.", "studio.f.stability", "studio.f.similarity", "studio.f.speed", "studio.f.textNormalisation", "studio.f.expressive", "studio.h.stability", "studio.h.similarity", "studio.h.speed", "studio.h.textNormalisation", "studio.h.expressive");

  const autoWords = [...new Set([tenant.name, tenant.branding.displayName, tenant.branding.displayNameAr, ...doctors.map((d) => d.name)].map((w) => (w ?? "").trim()).filter(Boolean))];

  return (
    <>
      <PageHead
        title={T("studio.title")}
        subtitle={T("studio.subtitle")}
        actions={
          <>
            <Link className="btn ghost" href={`/admin/clients/${id}/channels`}>{T("nav.channels")}</Link>
            <a className="btn" href="#try">{T("studio.testIt")}</a>
          </>
        }
      />

      {tenant.integrations.elevenlabs?.managed === false && <Notice tone="ok">{T("studio.connected")} <Link href={`/admin/clients/${id}/channels`}>{T("nav.channels")}</Link></Notice>}
      {!agent.elevenLabsAgentId && <Notice tone="warn">{T("studio.noAgent")} <Link href={`/admin/clients/${id}/channels`}>{T("nav.channels")}</Link></Notice>}

      <div className="grid">
        <Stat label={T("studio.glance.model")} value={savedRow.label} hint={`${PROVIDER_LABEL[savedRow.provider]} · ${T(`studio.model.price.${savedRow.price.source}`)}`} />
        <Stat label={T("studio.glance.cost")} value={fmtUsd(savedCost.minuteUsd)} hint={`${fmtBhd(toBhd(savedCost.minuteUsd))} · ${T("studio.glance.costHint", { chat: fmtUsd(savedCost.messageUsd) })}`} />
        <Stat
          label={T("studio.glance.margin")} value={margin ? `${margin.voicePct}%` : "–"}
          tone={margin ? marginTone(margin.voicePct) : undefined}
          hint={margin ? T("studio.glance.marginHint", { pays: fmtBhd(margin.clientMinuteBhd), chat: margin.textPct }) : T("studio.model.noPlan")}
        />
      </div>

      <section className="card row" style={{ justifyContent: "space-between" }}>
        <div>
          <strong>{T("prof.card.title")}</strong>
          <p className="muted" style={{ margin: 0 }}>{T("prof.card.help")}</p>
        </div>
        <Link className="btn" href={`/admin/clients/${id}/assistant/profiles`}>{T("prof.card.button")}</Link>
      </section>
      <section className="card row" style={{ justifyContent: "space-between" }}>
        <div>
          <strong>{T("proc.card.title")}</strong>
          <p className="muted" style={{ margin: 0 }}>{T("proc.card.help")}</p>
        </div>
        <Link className="btn" href={`/admin/clients/${id}/assistant/procedures`}>{T("proc.card.button")}</Link>
      </section>
      <section className="card row" style={{ justifyContent: "space-between" }}>
        <div>
          <strong>{T("tests.card.title")}</strong>
          <p className="muted" style={{ margin: 0 }}>{T("tests.card.help")}</p>
        </div>
        <Link className="btn" href={`/admin/clients/${id}/assistant/tests`}>{T("tests.card.button")}</Link>
      </section>

      <FoldControls openAll={T("fold.openAll")} closeAll={T("fold.closeAll")} />

      <nav className="studio-nav" aria-label={T("studio.title")}>
        {SECTION_ORDER.map((s) => <a key={s} href={`#${s}`}>{T(`studio.sec.${s}`)}</a>)}
        <a href="#live">{T("studio.live.title")}</a>
        <a href="#pricing">{T("studio.fees.title")}</a>
        <a href="#try">{T("try.title")}</a>
      </nav>

      <div className="stack">
        {section("model", (
          <>
          <ModelFields
            rows={book.rows} defaultLlm={fallbackLlm} fees={fees} rate={rate} usage={usage} today={today} liveInfo={book.source !== "builtin"} labels={modelLabels}
            value={{ llm: st.llm, temperature: agent.temperature, maxTokens: st.maxTokens, reasoningEffort: st.reasoningEffort, parallelTools: st.parallelTools, backupMode: st.backupMode, backupModels: st.backupModels, cascadeSeconds: st.cascadeSeconds }}
          />
          {select("serviceTier", st.serviceTier, CHOICES.serviceTier)}
          </>
        ), modelBefore)}

        {section("voice", (
          <>
          <VoiceFields
            builtins={builtins} labels={voiceLabels}
            value={{
              voiceEn: agent.voiceEn, voiceAr: agent.voiceAr, ttsModelEn: st.ttsModelEn, ttsModelAr: st.ttsModelAr,
              stability: st.stability, similarity: st.similarity, speed: st.speed, textNormalisation: st.textNormalisation, expressive: st.expressive,
              offered: st.offeredVoices, notes,
            }}
          />
          <fieldset className="stack">
            <legend style={{ fontWeight: 600 }}>{T("studio.v3.title")}</legend>
            <small className="muted">{T("studio.v3.help")}</small>
            {area("audioTags", audioTagLines(st.audioTags), { max: 3000, rows: 4, placeholder: T("studio.v3.placeholder") })}
          </fieldset>
          <fieldset className="stack">
            <legend style={{ fontWeight: 600 }}>{T("studio.fx.title")}</legend>
            <small className="muted">{T("studio.fx.help")}</small>
            {!effects && <small className="muted">{T("studio.fx.noCatalog")}</small>}
            <div className="grid two">
              {effectSelect("effectFilter", st.effectFilter, effects?.filters)}
              {effectSelect("effectEnvironment", st.effectEnvironment, effects?.environments)}
              {effectSelect("effectNoise", st.effectNoise, effects?.noises)}
              <RangeField name="effectDistance" label={f("effectDistance")} hint={T("studio.h.effectDistance")} min={0} max={1} step={0.05} defaultValue={st.effectDistance} />
            </div>
          </fieldset>
          </>
        ))}

        {section("conversation", (
          <div className="stack">
            {radios("turnEagerness", st.turnEagerness, CHOICES.turnEagerness)}
            <div className="grid two">
              <RangeField name="turnTimeout" label={f("turnTimeout")} hint={T("studio.h.turnTimeout")} min={LIMITS.turnTimeout[0]} max={LIMITS.turnTimeout[1]} step={0.5} defaultValue={st.turnTimeout} suffix="s" />
              <RangeField name="softTimeoutSeconds" label={f("softTimeoutSeconds")} hint={T("studio.h.softTimeoutSeconds")} min={0} max={LIMITS.softTimeoutSeconds[1]} step={0.5} defaultValue={st.softTimeoutSeconds} suffix="s" />
              {num("silenceEndSeconds", st.silenceEndSeconds, { min: 0, max: LIMITS.silenceEndSeconds[1] })}
              {num("maxDurationSeconds", st.maxDurationSeconds, { min: LIMITS.maxDurationSeconds[0], max: LIMITS.maxDurationSeconds[1] })}
              {select("spellingPatience", st.spellingPatience, CHOICES.spellingPatience)}
            </div>
            <div className="grid two">
              {check("speculativeTurn", st.speculativeTurn)}
              {check("protectGreeting", st.protectGreeting)}
            </div>
            {line("maxDurationMessage", st.maxDurationMessage, { max: LIMITS.shortText * 2 })}
            <div className="grid two">
              {line("softTimeoutMessageEn", st.softTimeoutMessageEn, { max: LIMITS.shortText })}
              {line("softTimeoutMessageAr", st.softTimeoutMessageAr, { max: LIMITS.shortText, rtl: true })}
            </div>
            <div className="notice">{T("studio.greeting.help")}</div>
            <div className="grid two">
              {area("greetingEn", st.greetingEn, { max: LIMITS.greeting, placeholder: greeting(tenant, "en", agent.arabicWrittenStyle, "") })}
              {area("greetingAr", st.greetingAr, { max: LIMITS.greeting, rtl: true, placeholder: greeting(tenant, "ar", agent.arabicWrittenStyle, "") })}
            </div>
            {(["greetingEn", "greetingAr"] as const).filter((k) => st[k].trim() && !mentionsRecording(st[k])).map((k) => (
              <Notice key={k} tone="warn">{T("studio.greeting.noRecording", { field: f(k), example: RECORDING_NOTICE[k === "greetingEn" ? "en" : "ar"] })}</Notice>
            ))}
            <fieldset className="stack">
              <legend style={{ fontWeight: 600 }}>{T("studio.conv.more")}</legend>
              <div className="grid two">
                {select("backgroundSound", st.backgroundSound, CHOICES.backgroundSound)}
                <RangeField name="backgroundVolume" label={f("backgroundVolume")} hint={T("studio.h.backgroundVolume")} min={LIMITS.backgroundVolume[0]} max={LIMITS.backgroundVolume[1]} step={0.05} defaultValue={st.backgroundVolume} />
                {num("initialWaitSeconds", st.initialWaitSeconds, { min: 0, max: LIMITS.initialWaitSeconds[1], step: 0.5 })}
                {select("turnModel", st.turnModel, CHOICES.turnModel)}
              </div>
              {area("ignoreTerms", st.ignoreTerms.join("\n"), { max: 1800, rows: 4, placeholder: "okay\naha\nتمام\nزين" })}
              {check("ignoreDefaults", st.ignoreDefaults)}
              <div className="grid two">
                {check("chatFiles", st.chatFiles)}
                {num("chatFilesMax", st.chatFilesMax, { min: LIMITS.chatFilesMax[0], max: LIMITS.chatFilesMax[1] })}
              </div>
            </fieldset>
          </div>
        ))}

        {section("hearing", (
          <div className="stack">
            {select("asrProvider", st.asrProvider, CHOICES.asrProvider)}
            <div className="stack" style={{ gap: ".35rem" }}>
              <strong style={{ fontSize: ".88rem" }}>{T("studio.keywords.auto")}</strong>
              <div className="row">{autoWords.length ? autoWords.map((w) => <span key={w} className="badge neutral">{w}</span>) : <small className="muted">–</small>}</div>
              <small className="muted">{T("studio.keywords.autoHelp")}</small>
            </div>
            {area("extraKeywords", st.extraKeywords.join("\n"), { max: 1200, rows: 5 })}
          </div>
        ))}

        {section("knowledge", (
          <div className="stack">
            <Notice tone={knowledgeChars > RAG_ADVICE_CHARS ? "warn" : "ok"}>
              {T("studio.rag.size", { n: knowledge.length, chars: knowledgeChars.toLocaleString("en") })} {T(knowledgeChars > RAG_ADVICE_CHARS ? "studio.rag.adviceOn" : "studio.rag.adviceOff")}
            </Notice>
            {check("ragEnabled", st.ragEnabled)}
            <div className="grid two">
              {select("ragEmbedding", st.ragEmbedding, CHOICES.ragEmbedding)}
              {num("ragMaxLength", st.ragMaxLength, { min: LIMITS.ragMaxLength[0], max: LIMITS.ragMaxLength[1], step: 500 })}
              {num("ragMaxChunks", st.ragMaxChunks, { min: LIMITS.ragMaxChunks[0], max: LIMITS.ragMaxChunks[1] })}
            </div>
          </div>
        ))}

        {section("safety", (
          <div className="stack">
            <div className="grid two">
              {check("guardFocus", st.guardFocus)}
              {check("guardInjection", st.guardInjection)}
              {check("recordVoice", st.recordVoice)}
              {check("bursting", st.bursting)}
              {num("dailyLimit", st.dailyLimit, { min: LIMITS.dailyLimit[0], max: LIMITS.dailyLimit[1] })}
              {num("concurrencyLimit", st.concurrencyLimit, { min: 0, max: LIMITS.concurrencyLimit[1] })}
              {check("queueEnabled", st.queueEnabled)}
              {num("queueWaitSeconds", st.queueWaitSeconds, { min: LIMITS.queueWaitSeconds[0], max: LIMITS.queueWaitSeconds[1], step: 5 })}
            </div>
            <small className="muted">{T("studio.safety.retention", { days: tenant.retentionDays || 90 })}</small>
          </div>
        ), undefined, (
          <section className="stack hold-audio" aria-labelledby="hold-title">
            <h3 id="hold-title" style={{ margin: 0, fontSize: "1rem" }}>{T("studio.hold.title")}</h3>
            <small className="muted">{T("studio.hold.help")}</small>
            {sp.hold && HOLD_OK.includes(sp.hold) && <Notice tone="ok">{T(`studio.hold.done.${sp.hold}`)}</Notice>}
            {sp.hold && HOLD_ERR.includes(sp.hold) && <Notice tone="warn">{T(`studio.hold.err.${sp.hold}`)}</Notice>}
            <Suspense fallback={<small className="muted" role="status">{T("studio.live.loading")}</small>}>
              <HoldAudioNow settings={agent} T={T} />
            </Suspense>
            <form action="/api/hold-audio" method="post" encType="multipart/form-data" className="row">
              <input type="hidden" name="tenantId" value={id} />
              <label>{T("studio.hold.file")}<input type="file" name="file" accept=".mp3,.wav,audio/mpeg,audio/wav" required /></label>
              <SubmitButton className="btn small" type="submit">{T("studio.hold.upload")}</SubmitButton>
            </form>
            <ConfirmDelete action={deleteHoldAudioAction} summary={T("studio.hold.remove.summary")} warning={T("studio.hold.remove.warning")} tick={T("studio.hold.remove.tick")} button={T("studio.hold.remove.button")} fields={{ tenantId: id }} />
          </section>
        ))}

        {section("analysis", (
          <div className="stack">
            {select("summaryLanguage", st.summaryLanguage, CHOICES.summaryLanguage)}
            <fieldset>
              <legend style={{ fontWeight: 600, fontSize: ".88rem" }}>{T("studio.criteria.title")}</legend>
              <small className="muted">{T("studio.criteria.help")}</small>
              {criteriaFor(tenant).map((c) => (
                <label key={c.id} className="inline">
                  <input type="checkbox" name="criteriaOff" value={c.id} defaultChecked={st.criteriaOff.includes(c.id)} />
                  <span><strong>{T(`studio.criteria.${c.id}`)}</strong><small className="muted" style={{ display: "block" }}>{T(`studio.criteria.${c.id}.help`)}</small></span>
                </label>
              ))}
            </fieldset>
            <div className="stack" style={{ gap: ".35rem" }}>
              <strong style={{ fontSize: ".88rem" }}>{T("studio.tags.auto")}</strong>
              <div className="row">{agentTags(tenant, []).map((w) => <span key={w} className="badge neutral">{w}</span>)}</div>
            </div>
            {area("tags", st.tags.join("\n"), { max: 600, rows: 3, placeholder: businessOf(tenant).type === "clinic" ? "Bahrain\nPilot" : "Bahrain" })}
          </div>
        ))}

        {section("widget", (
          <div className="stack">
            {radios("w.colors", st.widget.colors, CHOICES.widgetColors)}
            <div className="grid w-colours">
              {colour("w.bgColor", st.widget.bgColor)}{colour("w.textColor", st.widget.textColor)}{colour("w.borderColor", st.widget.borderColor)}
              {colour("w.btnColor", st.widget.btnColor)}{colour("w.btnTextColor", st.widget.btnTextColor)}
            </div>
            <div className="grid">
              {select("w.variant", st.widget.variant, CHOICES.widgetVariant)}
              {select("w.placement", st.widget.placement, CHOICES.widgetPlacement)}
              {select("w.expandable", st.widget.expandable, CHOICES.widgetExpandable)}
              {select("w.feedback", st.widget.feedback, CHOICES.widgetFeedback)}
              {num("w.borderRadius", st.widget.borderRadius, { min: LIMITS.widgetRadius[0], max: LIMITS.widgetRadius[1] })}
              {num("w.btnRadius", st.widget.btnRadius, { min: LIMITS.widgetRadius[0], max: LIMITS.widgetRadius[1] })}
            </div>
            <div className="grid two">
              {line("w.actionText", st.widget.actionText, { max: LIMITS.shortText })}
              {line("w.startCallText", st.widget.startCallText, { max: LIMITS.shortText })}
              {line("w.endCallText", st.widget.endCallText, { max: LIMITS.shortText })}
              {line("w.listeningText", st.widget.listeningText, { max: LIMITS.shortText })}
              {line("w.speakingText", st.widget.speakingText, { max: LIMITS.shortText })}
            </div>
            <small className="muted">{T("studio.widget.textsHelp")}</small>
            <div className="grid two">
              {check("w.transcript", st.widget.transcript)}{check("w.textInput", st.widget.textInput)}{check("w.textOnlyMode", st.widget.textOnlyMode)}
              {check("w.languageSelector", st.widget.languageSelector)}{check("w.micMuting", st.widget.micMuting)}{check("w.defaultExpanded", st.widget.defaultExpanded)}
              {check("w.dismissible", st.widget.dismissible)}{check("w.endConfirmation", st.widget.endConfirmation)}{check("w.showConversationId", st.widget.showConversationId)}
              {check("w.hideBanner", st.widget.hideBanner)}
            </div>
          </div>
        ))}

        <Fold id="live" title={T("studio.live.title")} hint={T("studio.live.help")}>
          <Suspense fallback={<p className="muted" role="status">{T("studio.live.loading")}</p>}>
            <LivePanel settings={agent} tenant={tenant} T={T} />
          </Suspense>
        </Fold>

        <Fold id="pricing" title={T("studio.fees.title")} hint={T("studio.fees.help")}>
          <dl className="scan-grid">
            <dt>{T("studio.fees.minute")}</dt><dd dir="ltr">{fees.minuteUsd}</dd>
            <dt>{T("studio.fees.message")}</dt><dd dir="ltr">{fees.messageUsd}</dd>
          </dl>
          <small><Link href="/admin/settings#fees">{T("studio.fees.onPlatform")}</Link></small>
          <dl className="scan-grid">
            <dt>{T("studio.fees.rate")}</dt><dd dir="ltr">{rate ? `${fmtBhd(rate)} ${T("studio.fees.perCredit")}` : T("studio.model.noPlan")}</dd>
            <dt>{T("studio.fees.unit")}</dt><dd>{T("studio.fees.unitText")}</dd>
          </dl>
        </Fold>

        <TryAssistant tenant={tenant} admin returnTo={returnTo} sp={{ saved: sp.saved, error: sp.error }} />
      </div>
    </>
  );
}

/** What ElevenLabs reports for this client's assistant, set beside what CallsDash set. */
async function LivePanel({ settings, tenant, T }: { settings: AgentSettings; tenant: Tenant; T: ReturnType<typeof text> }) {
  const api = catalogFromEnv();
  if (!api) return <Notice tone="warn">{T("studio.live.noKey")}</Notice>;
  if (!settings.elevenLabsAgentId) return <p className="muted">{T("studio.live.noAgent")}</p>;
  let rows: LiveRow[];
  let texts: LiveText[];
  let tools = 0;
  try {
    const [live, doctors] = await Promise.all([api.getAgent(settings.elevenLabsAgentId), getDoctors(tenant.id)]);
    tools = live.toolCount ?? 0;
    rows = liveRows({ settings, tenant, live });
    texts = liveTexts({ settings, tenant, doctors, live });
  } catch (e) {
    return <Notice tone="warn">{T("studio.live.failed")} {explainCatalogError(e)}</Notice>;
  }
  const sum = liveSummary(rows);
  const differs = sum.differs + texts.filter((x) => x.state === "differs").length;
  const show = (r: LiveRow, v: LiveValue) =>
    v === null ? (r.none ? T(`studio.live.none.${r.none}`) : "–")
      : typeof v === "boolean" ? T(v ? "studio.live.on" : "studio.live.off")
      : typeof v === "number" ? `${v}${r.unit ?? ""}`
      : v;
  return (
    <>
      <div className="row">
        <Badge tone={differs ? "bad" : "ok"}>{differs ? T("studio.live.summary.differs", { n: differs }) : T("studio.live.summary.same")}</Badge>
        {sum.unset > 0 && <small className="muted">{T("studio.live.summary.unset", { n: sum.unset })}</small>}
        <small className="muted">{T("studio.live.tools", { n: tools })}</small>
      </div>
      {differs > 0 && <Notice tone="warn">{T("studio.live.overwrite")}</Notice>}
      <div className="table-wrap">
        <table className="live">
          <thead><tr><th>{T("studio.live.col.setting")}</th><th>{T("studio.live.col.here")}</th><th>{T("studio.live.col.there")}</th><th>{T("studio.live.col.state")}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{T(`studio.live.row.${r.id}`)}</td>
                <td dir="ltr" data-label={T("studio.live.col.here")} style={{ overflowWrap: "anywhere" }}>{r.state === "unset" ? <span className="muted">{T("studio.live.notSet")}</span> : show(r, r.here)}</td>
                <td dir="ltr" data-label={T("studio.live.col.there")} style={{ overflowWrap: "anywhere" }}>{show(r, r.there)}</td>
                <td><Badge tone={r.state === "same" ? "ok" : r.state === "differs" ? "bad" : "neutral"}>{T(`studio.live.state.${r.state}`)}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 style={{ margin: ".5rem 0 0" }}>{T("studio.live.texts.title")}</h3>
      <p className="muted" style={{ margin: 0 }}>{T("studio.live.texts.help")}</p>
      <div className="stack" style={{ gap: ".75rem" }}>
        {texts.map((x) => (
          <div key={x.id} className="stack" style={{ gap: ".4rem" }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>{T(`studio.live.text.${x.id}`)}</strong>
              <Badge tone={x.state === "same" ? "ok" : "bad"}>{T(`studio.live.state.${x.state === "same" ? "same" : "differs"}`)}</Badge>
            </div>
            <details className="live-text">
              <summary>{T(x.state === "same" ? "studio.live.texts.showSame" : "studio.live.texts.show")}</summary>
              {x.state === "same" ? <pre className="diff" dir="ltr" tabIndex={0}>{x.here}</pre> : <TextDiff here={x.here} there={x.there} T={T} />}
            </details>
          </div>
        ))}
      </div>
    </>
  );
}

/** The hold audio callers hear now, read from the agent in ElevenLabs. */
async function HoldAudioNow({ settings, T }: { settings: AgentSettings; T: ReturnType<typeof text> }) {
  const api = catalogFromEnv();
  if (!api || !settings.elevenLabsAgentId) return null;
  let hold: Awaited<ReturnType<typeof api.getAgent>>["holdAudio"];
  try {
    hold = (await api.getAgent(settings.elevenLabsAgentId)).holdAudio;
  } catch {
    return <small className="muted">{T("studio.hold.unknown")}</small>;
  }
  if (!hold) return <small className="muted">{T("studio.hold.default")}</small>;
  return (
    <div className="stack" style={{ gap: ".3rem" }}>
      <span>{T("studio.hold.current", { name: hold.name })}{hold.seconds ? ` · ${Math.round(hold.seconds)} s` : ""}</span>
      {hold.url && <audio controls preload="none" src={hold.url} style={{ width: "100%", maxWidth: "26rem" }} />}
    </div>
  );
}
