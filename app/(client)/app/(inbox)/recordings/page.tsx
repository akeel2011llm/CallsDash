import Link from "next/link";
import { requireClient } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fill, fmtDate, fmtDateTime, fmtDuration } from "@/lib/format";
import { getConversations } from "@/lib/data";
import { recordingState, removedOn, type RecordingState } from "@/lib/recordings";
import { deleteRecordingsAction } from "@/lib/manage-actions";
import { Badge, Empty, Notice, PageHead } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { SelectAll } from "@/components/SelectAll";

type SP = { q?: string; state?: string; channel?: string; deleted?: string; failed?: string; err?: string };
const SHOWN = 100;
const STATES: RecordingState[] = ["available", "deleted", "expired"];
const ERRORS = ["confirm", "none", "manager", "no_key"];

/**
 * Recordings (step 3 of the any-business plan): every voice conversation, to play, download or delete. The audio comes from
 * ElevenLabs through /api/recordings/<id>; deleting removes ElevenLabs' copy and keeps the transcript here.
 */
export default async function RecordingsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { tenant, staffRole } = await requireClient();
  const sp = await searchParams;
  const { t, locale } = await getT(tenant);
  const now = Date.now();
  const days = tenant.retentionDays;
  const q = (sp.q ?? "").trim().toLowerCase();
  const voice = (await getConversations(tenant.id))
    .map((c) => ({ c, state: recordingState(c, days, now) }))
    .filter((x) => x.state !== "none");
  const rows = voice.filter(({ c, state }) => (!sp.state || state === sp.state) && (!sp.channel || c.channel === sp.channel)
    && (!q || c.summary.toLowerCase().includes(q) || c.transcript.some((l) => l.text.toLowerCase().includes(q))));
  const connected = Boolean(process.env.ELEVENLABS_API_KEY);
  const manager = staffRole === "manager";
  const canDelete = manager && connected;
  const stateLabel = (s: RecordingState) => (s === "expired" ? fill(t("rec.state.expired"), { n: days }) : t(`rec.state.${s}` as "rec.state.available"));
  return (
    <>
      <PageHead title={t("rec.title")} />
      <p className="muted">{t("rec.help")}</p>
      {sp.deleted && <Notice tone="ok">{fill(t("rec.deleted"), { n: Number(sp.deleted) || 0 })}</Notice>}
      {sp.failed && <Notice tone="warn">{fill(t("rec.failed"), { n: Number(sp.failed) || 0 })}</Notice>}
      {sp.err && ERRORS.includes(sp.err) && <Notice tone="warn">{t(`rec.err.${sp.err}` as "rec.err.confirm")}</Notice>}
      {!connected && <Notice tone="warn">{t("rec.noKey")}</Notice>}
      <Notice>{fill(t("rec.keep"), { n: days })}</Notice>
      <form className="filters card" method="get">
        <label style={{ flex: 1, minWidth: 200 }}>{t("common.search")}<input name="q" defaultValue={sp.q ?? ""} placeholder={t("rec.search")} maxLength={80} /></label>
        <label>{t("rec.state")}
          <select name="state" defaultValue={sp.state ?? ""}>
            <option value="">{t("common.all")}</option>
            {STATES.map((s) => <option key={s} value={s}>{stateLabel(s)}</option>)}
          </select>
        </label>
        <label>{t("common.channel")}
          <select name="channel" defaultValue={sp.channel ?? ""}>
            <option value="">{t("common.all")}</option>
            {(["website", "whatsapp", "phone"] as const).map((c) => <option key={c} value={c}>{t(`channel.${c}` as "channel.website")}</option>)}
          </select>
        </label>
        <SubmitButton className="btn" type="submit">{t("common.search")}</SubmitButton>
      </form>
      {voice.length === 0 ? <Empty>{t("rec.empty")}</Empty> : (
        <section className="card stack">
          {canDelete && (
            <form id="bulk-rec" action={deleteRecordingsAction} className="stack bulk-bar">
              <small className="muted">{t("rec.deleteHelp")}</small>
              <div className="row">
                <label className="inline"><input type="checkbox" name="confirm" />{t("rec.confirm")}</label>
                <SubmitButton className="btn small danger" type="submit">{t("rec.delete")}</SubmitButton>
              </div>
            </form>
          )}
          {canDelete && rows.some((x) => x.state === "available") && <SelectAll form="bulk-rec" label={t("rec.selectAll")} />}
          {rows.length === 0 && <span className="muted">{t("common.none")}</span>}
          {rows.slice(0, SHOWN).map(({ c, state }) => (
            <article key={c.id} className="data-row">
              <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
                {canDelete && state === "available" && (
                  <input type="checkbox" name="ids" value={c.id} form="bulk-rec" aria-label={fill(t("rec.select"), { date: fmtDateTime(c.startedAt, locale) })} />
                )}
                <div className="stack" style={{ flex: 1, minInlineSize: 0, gap: ".35rem" }}>
                  <div className="row">
                    <strong>{fmtDateTime(c.startedAt, locale)}</strong>
                    <Badge>{t(`channel.${c.channel}` as "channel.website")}</Badge>
                    <span className="muted">{fmtDuration(c.durationSec)}</span>
                    <Badge tone={state === "available" ? "ok" : "neutral"}>{stateLabel(state)}</Badge>
                  </div>
                  <div dir={c.language === "ar" ? "rtl" : "ltr"} className="muted">{c.summary}</div>
                  {state === "available" && connected && (
                    <audio controls preload="none" src={`/api/recordings/${c.id}`} style={{ width: "100%" }} aria-label={fill(t("rec.player"), { date: fmtDateTime(c.startedAt, locale) })} />
                  )}
                  <div className="row">
                    <Link href={`/app/conversations/${c.id}`}>{t("rec.open")}</Link>
                    {state === "available" && connected && <a href={`/api/recordings/${c.id}?download=1`}>{t("rec.download")}</a>}
                    {state === "available" && <small className="muted">{fill(t("rec.removedOn"), { date: fmtDate(removedOn(c, days), locale) })}</small>}
                  </div>
                </div>
              </div>
            </article>
          ))}
          {rows.length > SHOWN && <small className="muted">{fill(t("rec.shown"), { shown: SHOWN, total: rows.length })}</small>}
        </section>
      )}
    </>
  );
}
