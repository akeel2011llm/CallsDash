import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { dictionaries, getT } from "@/lib/i18n";
import { fmtDateTime } from "@/lib/format";
import { getAgent, getConversations, getDoctors, getSetting, getTenant } from "@/lib/data";
import { RECORDING_NOTICE, greeting, mentionsRecording } from "@/lib/agent-config";
import { EVALUATION_CRITERIA } from "@/lib/agent-extras";
import { PROVIDER_LABEL, defaultLlm, rowFor } from "@/lib/agent-catalog";
import { CHOICES, LIMITS, studioOf, type SectionId, type VoiceNote } from "@/lib/agent-studio";
import { EXAMPLE_USAGE, clientRatePerCredit, costLine, fmtBhd, fmtUsd, marginOf, marginTone, toBhd } from "@/lib/pricing";
import { catalogFromEnv, explainCatalogError, type CatalogVoice } from "@/lib/elevenlabs-catalog";
import { liveRows, liveSummary, type LiveRow, type LiveValue } from "@/lib/studio-live";
import { loadFees, modelBook } from "@/lib/studio-server";
import { failKey, failToShow } from "@/lib/studio-fail";
import { refreshModelsAction, resetStudioSectionAction, saveFeesAction, saveStudioSectionAction } from "@/lib/studio-actions";
import { VOICES, resolveVoiceId } from "@/lib/voices";
import type { AgentSettings, Tenant } from "@/lib/types";
import { ConfirmDelete } from "@/components/Confirm";
import { SubmitButton } from "@/components/SubmitButton";
import { TryAssistant } from "@/components/TryAssistant";
import { Badge, Notice, PageHead, Stat } from "@/components/ui";
import { ModelFields } from "@/components/studio/ModelFields";
import { RangeField } from "@/components/studio/RangeField";
import { VoiceFields, type BuiltinVoice } from "@/components/studio/VoiceFields";
import { text } from "@/components/studio/text";

type Params = { id: string };
type Query = {
  section?: string; done?: string; why?: string; warn?: string; fail?: string; bad?: string;
  refreshed?: string; feesSaved?: string; feesBad?: string; saved?: string; error?: string;
};

const SECTION_ORDER: SectionId[] = ["model", "voice", "conversation", "hearing", "safety", "analysis", "widget"];
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

export default async function AssistantStudioPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Query> }) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const tenant = await getTenant(id);
  if (!tenant) notFound();
  const { locale } = await getT();
  const dict = dictionaries[locale] as Record<string, string>;
  const T = text(dict);
  /** The texts a client component needs, picked by prefix so a page does not ship the whole dictionary. */
  const labelsFor = (...prefixes: string[]) => Object.fromEntries(Object.entries(dict).filter(([k]) => prefixes.some((p) => k.startsWith(p))));

  const [agent, doctors, conversations, fees] = await Promise.all([getAgent(id), getDoctors(id), getConversations(id), loadFees()]);
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

  /** One card per section, each with its own form: saving one never touches the others. */
  const section = (key: SectionId, body: React.ReactNode, before?: React.ReactNode) => (
    <section className="card stack" id={key} key={key}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>{T(`studio.sec.${key}`)}</h2>
        <Badge tone={touched(key) ? "info" : "neutral"}>{T(touched(key) ? "studio.state.custom" : "studio.state.default")}</Badge>
      </div>
      <p className="muted" style={{ margin: 0 }}>{T(`studio.sec.${key}.help`)}</p>
      {outcome(key)}
      {before}
      <form action={saveStudioSectionAction} className="stack">
        <input type="hidden" name="tenantId" value={id} />
        <input type="hidden" name="section" value={key} />
        {body}
        <div className="row"><SubmitButton className="btn" type="submit">{T("studio.save")}</SubmitButton><small className="muted">{T("studio.save.help")}</small></div>
      </form>
      <ConfirmDelete action={resetStudioSectionAction} summary={T("studio.reset.summary")} warning={T(key === "voice" ? "studio.reset.warning.voice" : "studio.reset.warning")} tick={T("studio.reset.tick")} button={T("studio.reset.button")} fields={{ tenantId: id, section: key }} />
    </section>
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
        title={`${T("studio.title")}: ${locale === "ar" ? tenant.branding.displayNameAr || tenant.name : tenant.name}`}
        subtitle={T("studio.subtitle")}
        actions={
          <>
            <Link className="btn ghost" href={`/admin/clients/${id}`}>{T("studio.toClient")}</Link>
            <Link className="btn ghost" href={`/admin/clients/${id}/channels`}>{T("nav.channels")}</Link>
            <a className="btn" href="#try">{T("studio.testIt")}</a>
          </>
        }
      />

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

      <nav className="studio-nav" aria-label={T("studio.title")}>
        {SECTION_ORDER.map((s) => <a key={s} href={`#${s}`}>{T(`studio.sec.${s}`)}</a>)}
        <a href="#live">{T("studio.live.title")}</a>
        <a href="#pricing">{T("studio.fees.title")}</a>
        <a href="#try">{T("try.title")}</a>
      </nav>

      <div className="stack">
        {section("model", (
          <ModelFields
            rows={book.rows} defaultLlm={fallbackLlm} fees={fees} rate={rate} usage={usage} today={today} liveInfo={book.source !== "builtin"} labels={modelLabels}
            value={{ llm: st.llm, temperature: agent.temperature, maxTokens: st.maxTokens, reasoningEffort: st.reasoningEffort, parallelTools: st.parallelTools, backupMode: st.backupMode, backupModels: st.backupModels, cascadeSeconds: st.cascadeSeconds }}
          />
        ), modelBefore)}

        {section("voice", (
          <VoiceFields
            builtins={builtins} labels={voiceLabels}
            value={{
              voiceEn: agent.voiceEn, voiceAr: agent.voiceAr, ttsModelEn: st.ttsModelEn, ttsModelAr: st.ttsModelAr,
              stability: st.stability, similarity: st.similarity, speed: st.speed, textNormalisation: st.textNormalisation, expressive: st.expressive,
              offered: st.offeredVoices, notes,
            }}
          />
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

        {section("safety", (
          <div className="stack">
            <div className="grid two">
              {check("guardFocus", st.guardFocus)}
              {check("guardInjection", st.guardInjection)}
              {check("recordVoice", st.recordVoice)}
              {check("bursting", st.bursting)}
              {num("dailyLimit", st.dailyLimit, { min: LIMITS.dailyLimit[0], max: LIMITS.dailyLimit[1] })}
              {num("concurrencyLimit", st.concurrencyLimit, { min: 0, max: LIMITS.concurrencyLimit[1] })}
            </div>
            <small className="muted">{T("studio.safety.retention", { days: tenant.retentionDays || 90 })}</small>
          </div>
        ))}

        {section("analysis", (
          <div className="stack">
            {select("summaryLanguage", st.summaryLanguage, CHOICES.summaryLanguage)}
            <fieldset>
              <legend style={{ fontWeight: 600, fontSize: ".88rem" }}>{T("studio.criteria.title")}</legend>
              <small className="muted">{T("studio.criteria.help")}</small>
              {EVALUATION_CRITERIA.map((c) => (
                <label key={c.id} className="inline">
                  <input type="checkbox" name="criteriaOff" value={c.id} defaultChecked={st.criteriaOff.includes(c.id)} />
                  <span><strong>{T(`studio.criteria.${c.id}`)}</strong><small className="muted" style={{ display: "block" }}>{T(`studio.criteria.${c.id}.help`)}</small></span>
                </label>
              ))}
            </fieldset>
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

        <section className="card stack" id="live">
          <h2 style={{ margin: 0 }}>{T("studio.live.title")}</h2>
          <p className="muted" style={{ margin: 0 }}>{T("studio.live.help")}</p>
          <Suspense fallback={<p className="muted" role="status">{T("studio.live.loading")}</p>}>
            <LivePanel settings={agent} tenant={tenant} T={T} />
          </Suspense>
        </section>

        <section className="card stack" id="pricing">
          <h2 style={{ margin: 0 }}>{T("studio.fees.title")}</h2>
          <p className="muted" style={{ margin: 0 }}>{T("studio.fees.help")}</p>
          {sp.feesSaved && <Notice tone="ok">{T("studio.fees.saved")}</Notice>}
          {sp.feesBad && <Notice tone="warn">{T("studio.fees.bad")}</Notice>}
          <form action={saveFeesAction} className="stack">
            <input type="hidden" name="tenantId" value={id} />
            <div className="grid two">
              <label>{T("studio.fees.minute")}<input type="number" name="minuteUsd" defaultValue={fees.minuteUsd} min={0} max={9.999} step="any" dir="ltr" inputMode="decimal" /></label>
              <label>{T("studio.fees.message")}<input type="number" name="messageUsd" defaultValue={fees.messageUsd} min={0} max={9.999} step="any" dir="ltr" inputMode="decimal" /></label>
            </div>
            <small className="muted">{T("studio.fees.where")}</small>
            <div><SubmitButton className="btn" type="submit">{T("studio.fees.save")}</SubmitButton></div>
          </form>
          <dl className="scan-grid">
            <dt>{T("studio.fees.rate")}</dt><dd dir="ltr">{rate ? `${fmtBhd(rate)} ${T("studio.fees.perCredit")}` : T("studio.model.noPlan")}</dd>
            <dt>{T("studio.fees.unit")}</dt><dd>{T("studio.fees.unitText")}</dd>
          </dl>
        </section>

        <TryAssistant tenant={tenant} admin returnTo={returnTo} sp={{ saved: sp.saved, error: sp.error }} />
      </div>
    </>
  );
}

/** What ElevenLabs reports for this client's assistant, set beside what CallsDash set. */
async function LivePanel({ settings, tenant, T }: { settings: AgentSettings; tenant: Pick<Tenant, "retentionDays">; T: ReturnType<typeof text> }) {
  const api = catalogFromEnv();
  if (!api) return <Notice tone="warn">{T("studio.live.noKey")}</Notice>;
  if (!settings.elevenLabsAgentId) return <p className="muted">{T("studio.live.noAgent")}</p>;
  let rows: LiveRow[];
  let tools = 0;
  try {
    const live = await api.getAgent(settings.elevenLabsAgentId);
    tools = live.toolCount ?? 0;
    rows = liveRows({ settings, tenant, live });
  } catch (e) {
    return <Notice tone="warn">{T("studio.live.failed")} {explainCatalogError(e)}</Notice>;
  }
  const sum = liveSummary(rows);
  const show = (r: LiveRow, v: LiveValue) =>
    v === null ? (r.none ? T(`studio.live.none.${r.none}`) : "–")
      : typeof v === "boolean" ? T(v ? "studio.live.on" : "studio.live.off")
      : typeof v === "number" ? `${v}${r.unit ?? ""}`
      : v;
  return (
    <>
      <div className="row">
        <Badge tone={sum.differs ? "bad" : "ok"}>{sum.differs ? T("studio.live.summary.differs", { n: sum.differs }) : T("studio.live.summary.same")}</Badge>
        {sum.unset > 0 && <small className="muted">{T("studio.live.summary.unset", { n: sum.unset })}</small>}
        <small className="muted">{T("studio.live.tools", { n: tools })}</small>
      </div>
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
    </>
  );
}
