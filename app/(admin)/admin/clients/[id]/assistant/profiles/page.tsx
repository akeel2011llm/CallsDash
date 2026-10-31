import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { dictionaries, getT } from "@/lib/i18n";
import { fmtDateTime } from "@/lib/format";
import * as store from "@/lib/data";
import { SECTIONS, type SectionId } from "@/lib/agent-studio";
import { catalogFromEnv } from "@/lib/elevenlabs-catalog";
import { previewLive } from "@/lib/studio-import";
import { failToShow, profileFailKey } from "@/lib/studio-fail";
import { BUILTIN_IDS, BUILTIN_VALUES, FIELDS, diffValues, fieldOf, loadProfiles, type BuiltinId, type StudioProfile } from "@/lib/studio-profiles";
import { applyProfileAction, deleteProfileAction, importLiveAction, renameProfileAction, saveProfileAction } from "@/lib/studio-profile-actions";
import { ConfirmDelete } from "@/components/Confirm";
import { Fold } from "@/components/Fold";
import { FoldControls } from "@/components/FoldControls";
import { Guide } from "@/components/Guide";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge, Notice, PageHead } from "@/components/ui";
import { text } from "@/components/studio/text";

type Query = {
  done?: string; why?: string; warn?: string; bad?: string; fail?: string; err?: string; need?: string; n?: string; savedAs?: string;
  read?: string; readErr?: string; profile?: string;
};

const FIELD = /^[\w.]{1,40}$/;
const KEY = /^studio\.err\.\w{1,30}$/;
const CODE = /^[a-z_]{3,30}$/;
const GROUP = /^[a-z]{3,20}$/;
const SECONDS = new Set(["cascadeSeconds", "turnTimeout", "silenceEndSeconds", "maxDurationSeconds", "softTimeoutSeconds"]);
const ERRORS = new Set(["name", "nameTaken", "full", "missing"]);
const COUNT = /^\d{1,3}$/;

export default async function ProfilesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const tenant = await store.getTenant(id);
  if (!tenant) notFound();
  const { locale } = await getT(tenant);
  const dict = dictionaries[locale] as Record<string, string>;
  const T = text(dict);
  const has = (key: string) => key in dict;

  const [agent, saved] = await Promise.all([store.getAgent(id), loadProfiles(store)]);
  const clinic = locale === "ar" ? tenant.branding.displayNameAr || tenant.name : tenant.name;
  const base = `/admin/clients/${id}/assistant`;

  /* ----- values shown as words ----- */
  const show = (key: string, v: unknown): string => {
    if (v === undefined || v === null) return "–";
    if (typeof v === "boolean") return T(v ? "studio.live.on" : "studio.live.off");
    if (typeof v === "number") return v === 0 && has(`prof.zero.${key}`) ? T(`prof.zero.${key}`) : SECONDS.has(key) ? `${v} s` : String(v);
    if (Array.isArray(v)) {
      if (key === "offeredVoices") return v.length ? T("prof.voices", { n: v.length }) : "–";
      if (key === "extraKeywords") return v.length ? T("prof.words", { n: v.length }) : "–";
      if (key === "criteriaOff") return v.length ? v.map((x) => (has(`studio.criteria.${x}`) ? T(`studio.criteria.${x}`) : String(x))).join(", ") : "–";
      return v.length ? v.join(", ") : "–";
    }
    if (typeof v === "string") {
      if (v === "") return has(`studio.opt.${key}.default`) ? T(`studio.opt.${key}.default`) : key === "llm" || key === "reasoningEffort" ? T("prof.default") : T("prof.blank");
      const named = [`studio.opt.${key}.${v}`, key === "reasoningEffort" && `studio.effort.${v}`, key === "backupMode" && `studio.model.backup.${v}`, key.startsWith("ttsModel") && `studio.tts.${v}`].find((k): k is string => !!k && has(k));
      if (named) return T(named);
      return v.length > 70 ? `${v.slice(0, 70)}…` : v;
    }
    return JSON.stringify(v).slice(0, 70);
  };
  const label = (key: string) => T(`studio.f.${key === "offeredVoices" ? "offered" : key}`);
  const hint = (key: string) => { const h = fieldOf(key)?.hint; return h && has(`prof.h.${h}`) ? T(`prof.h.${h}`) : null; };

  /* ----- what happened ----- */
  const profile = sp.profile;
  const bad = (sp.bad ?? "").split(",").map((p) => p.split(":")).filter(([field, key]) => FIELD.test(field ?? "") && KEY.test(key ?? ""));
  const warnGroups = (sp.warn ?? "").split(",").filter((g) => GROUP.test(g));
  const refused = sp.fail ? failToShow(await store.getSetting(profileFailKey(id)).catch(() => undefined), "model") : null;
  const err = ERRORS.has(sp.err ?? "") ? sp.err : undefined;
  const notices = (
    <>
      {err && <Notice tone="warn">{T(`prof.err.${err}`)}</Notice>}
      {sp.need && <Notice tone="warn">{T("prof.need")}</Notice>}
      {sp.done === "applied" && <Notice tone="ok">{T("prof.done.applied")} <Link href={`${base}#try`}>{T("prof.preview.test")}</Link></Notice>}
      {sp.done === "saved" && <Notice tone="warn">{T("prof.done.saved")} {CODE.test(sp.why ?? "") ? (sp.why === "no_agent" ? T("studio.done.saved.no_agent") : T(`channels.err.${sp.why}`)) : ""}</Notice>}
      {sp.done === "imported" && <Notice tone="ok">{T("prof.done.imported", { n: COUNT.test(sp.n ?? "") ? Number(sp.n) : 0 })}{sp.savedAs && ` ${T("prof.done.savedAs")}`}</Notice>}
      {sp.done === "nothing" && <Notice tone="ok">{T("prof.done.nothing")}</Notice>}
      {sp.done === "profileSaved" && <Notice tone="ok">{T("prof.done.profileSaved")}</Notice>}
      {sp.done === "renamed" && <Notice tone="ok">{T("prof.done.renamed")}</Notice>}
      {sp.done === "deleted" && <Notice tone="ok">{T("prof.done.deleted")}</Notice>}
      {warnGroups.length > 0 && (
        <Notice tone="warn">
          {T("studio.done.warn", { groups: warnGroups.map((g) => T(`channels.group.${g}`)).join(", ") })}
          <ul className="notes">{(tenant.integrations.elevenlabs?.warnings ?? []).filter((d) => warnGroups.includes(d.group)).map((d) => <li key={d.group}><small>{T(`channels.group.${d.group}`)}: {d.detail}</small></li>)}</ul>
        </Notice>
      )}
      {bad.length > 0 && (
        <Notice tone="warn">
          <strong>{T("prof.bad")}</strong>
          <ul className="notes">{bad.map(([field, key]) => <li key={field}>{has(`studio.f.${field}`) ? label(field) : field}: {T(key)}</li>)}</ul>
        </Notice>
      )}
    </>
  );

  /* ----- read from ElevenLabs ----- */
  const reading = sp.read === "1";
  const live = reading && !sp.fail ? await previewLive({ data: store, catalog: catalogFromEnv() }, id) : null;
  const readCard = (
    <Fold id="read" open={reading || Boolean(sp.readErr) || ["imported", "nothing"].includes(sp.done ?? "")} title={T("prof.read.title")} hint={T("prof.read.help")}>
      {sp.readErr === "no_key" && <Notice tone="warn">{T("prof.read.noKey")}</Notice>}
      {sp.readErr === "no_agent" && <Notice tone="warn">{T("prof.read.noAgent")} <Link href={`/admin/clients/${id}/channels`}>{T("nav.channels")}</Link></Notice>}
      {reading && sp.fail && <Notice tone="warn">{T("prof.read.failed", { detail: refused ?? T("studio.fail.noDetail") })}</Notice>}
      {live?.kind === "no_key" && <Notice tone="warn">{T("prof.read.noKey")}</Notice>}
      {live?.kind === "no_agent" && <Notice tone="warn">{T("prof.read.noAgent")} <Link href={`/admin/clients/${id}/channels`}>{T("nav.channels")}</Link></Notice>}
      {live?.kind === "failed" && <Notice tone="warn">{T("prof.read.failed", { detail: live.detail })}</Notice>}
      {live?.kind === "ok" && (
        <form action={importLiveAction} className="stack">
          <input type="hidden" name="tenantId" value={id} />
          <div className="row">
            {live.agentName && <small className="muted">{T("prof.read.agent", { name: live.agentName })}</small>}
            <Badge tone={live.changes.length ? "info" : "ok"}>{live.changes.length ? T("prof.read.summary", { n: live.changes.length, m: live.same }) : T("prof.read.allSame")}</Badge>
          </div>
          {live.changes.length > 0 && (
            <>
              <div className="table-wrap">
                <table className="live">
                  <thead><tr><th>{T("prof.read.col.take")}</th><th>{T("prof.read.col.setting")}</th><th>{T("prof.read.col.here")}</th><th>{T("prof.read.col.there")}</th></tr></thead>
                  <tbody>
                    {live.changes.map((c) => (
                      <tr key={c.key}>
                        <td data-label={T("prof.read.col.take")}><input type="checkbox" name="take" value={c.key} defaultChecked aria-label={`${T("prof.read.col.take")}: ${label(c.key)}`} /></td>
                        <td>{label(c.key)}<small className="muted" style={{ display: "block" }}>{T(`studio.sec.${c.section}`)}</small></td>
                        <td dir="ltr" data-label={T("prof.read.col.here")} style={{ overflowWrap: "anywhere" }}>{show(c.key, c.here)}</td>
                        <td dir="ltr" data-label={T("prof.read.col.there")} style={{ overflowWrap: "anywhere" }}>{show(c.key, c.next)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <small className="muted">{T("prof.read.keepNote")}</small>
              <label>{T("prof.read.saveAs")}<input type="text" name="saveAs" maxLength={60} /></label>
              <div><SubmitButton className="btn" type="submit">{T("prof.read.apply")}</SubmitButton></div>
            </>
          )}
        </form>
      )}
      {!live && (
        <div><a className="btn" href={`${base}/profiles?read=1#read`}>{T("prof.read.button")}</a></div>
      )}
      {live && <div><Link className="btn small ghost" href={`${base}/profiles#read`}>{T("prof.preview.cancel")}</Link></div>}
      <small className="muted">{T("prof.read.notRead")}</small>
    </Fold>
  );

  /* ----- profiles ----- */
  type Row = { id: string; name: string; values: Record<string, unknown>; builtin?: BuiltinId; saved?: StudioProfile };
  const rows: Row[] = [
    ...BUILTIN_IDS.map((b) => ({ id: b, name: T(`prof.b.${b}.name`), values: BUILTIN_VALUES[b], builtin: b })),
    ...saved.map((p) => ({ id: p.id, name: p.name, values: p.values, saved: p })),
  ];
  const chosen = profile ? rows.find((r) => r.id === profile) : undefined;

  const valuesTable = (r: Row) => (
    <div className="stack" style={{ gap: ".75rem" }}>
      {SECTIONS.map((s: SectionId) => {
        const fields = FIELDS.filter((x) => x.section === s);
        return (
          <div key={s}>
            <strong style={{ fontSize: ".9rem" }}>{T(`studio.sec.${s}`)}</strong>
            <div className="table-wrap">
              <table className="live">
                <thead><tr><th>{T("prof.col.setting")}</th><th>{T("prof.col.value")}</th><th>{T("prof.col.hint")}</th></tr></thead>
                <tbody>
                  {fields.map((x) => (
                    <tr key={x.key}>
                      <td>{label(x.key)}</td>
                      <td dir="ltr" data-label={T("prof.col.value")} style={{ overflowWrap: "anywhere" }}>{x.key in r.values ? show(x.key, r.values[x.key]) : <span className="muted">{T("prof.keep")}</span>}</td>
                      <td data-label={T("prof.col.hint")}><small className="muted">{hint(x.key)}</small></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );

  const profileCard = (r: Row) => {
    const n = diffValues(agent, r.values).changes.length;
    const badge = r.builtin === "recommended" ? <Badge tone="ok">{T("prof.badge.recommended")}</Badge> : r.builtin ? <Badge>{T("prof.badge.builtin")}</Badge> : <Badge tone="info">{T("prof.badge.saved", { date: r.saved?.createdAt ? fmtDateTime(r.saved.createdAt, locale) : "–", by: r.saved?.by || "–" })}</Badge>;
    return (
      <Fold key={r.id} id={`p-${r.id}`} title={r.name} badge={badge} hint={r.builtin ? T(`prof.b.${r.builtin}.who`) : r.saved?.note || undefined}>
        {r.builtin && (
          <>
            <p className="muted" style={{ margin: 0 }}><strong>{T("prof.impact")}:</strong> {T(`prof.b.${r.builtin}.impact`)}</p>
            <details>
              <summary>{T("prof.why")}</summary>
              <ul className="notes">{[1, 2, 3].map((i) => <li key={i}>{T(`prof.b.${r.builtin}.why${i}`)}</li>)}</ul>
            </details>
          </>
        )}
        <div className="row">
          <Badge tone={n === 0 ? "ok" : "neutral"}>{n === 0 ? T("prof.close.same") : T("prof.close.n", { n })}</Badge>
          <Link className="btn small" href={`${base}/profiles?profile=${encodeURIComponent(r.id)}#preview`}>{T("prof.view")}</Link>
        </div>
        <details>
          <summary>{T("prof.all")}</summary>
          <div style={{ marginBlockStart: ".5rem" }}>{valuesTable(r)}</div>
        </details>
        {r.saved && (
          <>
            <details className="confirm">
              <summary className="muted" style={{ cursor: "pointer" }}>{T("prof.rename.summary")}</summary>
              <form action={renameProfileAction} className="stack" style={{ marginBlockStart: ".5rem" }}>
                <input type="hidden" name="tenantId" value={id} />
                <input type="hidden" name="profile" value={r.id} />
                <label>{T("prof.rename.name")}<input type="text" name="name" defaultValue={r.name} maxLength={60} required /></label>
                <label>{T("prof.rename.note")}<input type="text" name="note" defaultValue={r.saved.note} maxLength={240} /></label>
                <div><SubmitButton className="btn small" type="submit">{T("prof.rename.save")}</SubmitButton></div>
              </form>
            </details>
            <ConfirmDelete action={deleteProfileAction} summary={T("prof.delete.summary")} warning={T("prof.delete.warning")} tick={T("prof.delete.tick")} button={T("prof.delete.button")} fields={{ tenantId: id, profile: r.id }} />
          </>
        )}
      </Fold>
    );
  };

  /* ----- the preview of one profile ----- */
  const preview = chosen ? (() => {
    const { changes } = diffValues(agent, chosen.values);
    return (
      <Fold id="preview" open title={T("prof.preview.title", { name: chosen.name })}>
        {refused && <Notice tone="warn">{T("prof.fail", { detail: refused })}</Notice>}
        {changes.length === 0 ? <p className="muted" style={{ margin: 0 }}>{T("prof.preview.none")}</p> : (
          <>
            <p style={{ margin: 0 }}>{T("prof.preview.count", { n: changes.length })}</p>
            <div className="table-wrap">
              <table className="live">
                <thead><tr><th>{T("prof.read.col.setting")}</th><th>{T("prof.preview.col.now")}</th><th>{T("prof.preview.col.next")}</th></tr></thead>
                <tbody>
                  {changes.map((c) => (
                    <tr key={c.key}>
                      <td>{label(c.key)}{hint(c.key) && <small className="muted" style={{ display: "block" }}>{hint(c.key)}</small>}</td>
                      <td dir="ltr" data-label={T("prof.preview.col.now")} style={{ overflowWrap: "anywhere" }}>{show(c.key, c.here)}</td>
                      <td dir="ltr" data-label={T("prof.preview.col.next")} style={{ overflowWrap: "anywhere" }}>{show(c.key, c.next)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <Notice tone="warn">{T("prof.preview.warn")}</Notice>
        <form action={applyProfileAction} className="stack">
          <input type="hidden" name="tenantId" value={id} />
          <input type="hidden" name="profile" value={chosen.id} />
          <label className="inline"><input type="checkbox" name="confirm" required />{T("prof.preview.tick")}</label>
          <div className="row">
            <SubmitButton className="btn" type="submit">{T("prof.preview.button")}</SubmitButton>
            <Link className="btn ghost" href={`${base}/profiles#profiles`}>{T("prof.preview.cancel")}</Link>
          </div>
        </form>
      </Fold>
    );
  })() : null;

  return (
    <>
      <PageHead
        title={`${T("prof.title")}: ${clinic}`}
        subtitle={T("prof.subtitle")}
        actions={<Link className="btn ghost" href={base}>{T("prof.back")}</Link>}
      />
      <Guide id="studioProfiles">
        <ol className="notes">{[1, 2, 3, 4, 5].map((i) => <li key={i}>{T(`prof.guide.${i}`)}</li>)}</ol>
      </Guide>
      {notices}
      <FoldControls openAll={T("fold.openAll")} closeAll={T("fold.closeAll")} />
      {readCard}
      {preview}
      <section className="stack" id="profiles">
        <div>
          <h2 style={{ margin: 0 }}>{T("prof.list.title")}</h2>
          <p className="muted" style={{ margin: 0 }}>{T("prof.list.help")}</p>
        </div>
        {rows.map(profileCard)}
      </section>
      <Fold id="save" open={err === "name" || err === "nameTaken" || err === "full"} title={T("prof.save.title")} hint={T("prof.save.help")}>
        <form action={saveProfileAction} className="stack">
          <input type="hidden" name="tenantId" value={id} />
          <label>{T("prof.save.name")}<input type="text" name="name" maxLength={60} required /></label>
          <label>{T("prof.save.note")}<input type="text" name="note" maxLength={240} /></label>
          <div><SubmitButton className="btn" type="submit">{T("prof.save.button")}</SubmitButton></div>
        </form>
      </Fold>
    </>
  );
}
