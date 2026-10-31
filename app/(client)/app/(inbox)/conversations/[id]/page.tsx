import Link from "next/link";
import { notFound } from "next/navigation";
import { requireClient } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate, fmtDateTime, fmtDuration, fmtNum } from "@/lib/format";
import { getConversation } from "@/lib/data";
import { recordingState } from "@/lib/recordings";
import { reviewConversationAction } from "@/lib/actions";
import { deleteConversationAction } from "@/lib/manage-actions";
import { ConfirmDelete } from "@/components/Confirm";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge, Flag, Notice, PageHead } from "@/components/ui";

export default async function ConversationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string }> }) {
  const { tenant, staffRole } = await requireClient();
  const { err } = await searchParams;
  const { id } = await params;
  const c = await getConversation(tenant.id, id);
  if (!c) notFound();
  const { t, locale } = await getT(tenant);
  const deleteOn = new Date(new Date(c.startedAt).getTime() + tenant.retentionDays * 86_400_000).toISOString();
  const rec = recordingState(c, tenant.retentionDays);
  return (
    <>
      <PageHead title={t("conversations.title")} actions={<Link className="btn ghost" href="/app/conversations">{t("common.back")}</Link>} />
      {err === "confirm" && <Notice tone="warn">{t("doctors.n.confirm")}</Notice>}
      {c.flags.length > 0 && (
        <section className="card attn-item" style={{ gap: ".6rem" }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="row">
              {c.flags.map((f) => <Flag key={f} kind={f}>{t(`flag.${f}` as "flag.lead")}</Flag>)}
              <small className="muted">{c.flags.map((f) => t(`flag.${f}.help` as "flag.lead.help")).join(" ")}</small>
            </span>
            <form action={reviewConversationAction}>
              <input type="hidden" name="id" value={c.id} />
              <input type="hidden" name="reviewed" value={c.reviewed ? "0" : "1"} />
              <input type="hidden" name="returnTo" value={`/app/conversations/${c.id}`} />
              <SubmitButton className="btn small" type="submit">{c.reviewed ? t("attn.reopen") : t("attn.markReviewed")}</SubmitButton>
            </form>
          </div>
        </section>
      )}
      <section className="card stack">
        <div className="row">
          <Badge>{t(`channel.${c.channel}` as "channel.website")}</Badge>
          <Badge tone={c.outcome === "booked" ? "ok" : c.outcome === "handed_off" ? "warn" : "neutral"}>{t(`outcome.${c.outcome}` as "outcome.booked")}</Badge>
          <Badge tone={c.sentiment === "negative" ? "bad" : c.sentiment === "positive" ? "ok" : "neutral"}>{t(`sentiment.${c.sentiment}` as "sentiment.neutral")}</Badge>
          <span className="muted">{fmtDateTime(c.startedAt, locale)}</span>
          <span className="muted">{c.mode === "voice" ? fmtDuration(c.durationSec) : `${c.messages} ${t("conversations.messages")}`}</span>
          <span className="muted">{t("conversations.cost")}: {fmtNum(c.creditsCharged, locale, 2)}</span>
        </div>
        <div dir={c.language === "ar" ? "rtl" : "ltr"}><strong>{t("conversations.summary")}:</strong> {c.summary}</div>
      </section>
      <section className="card stack">
        <h2>{t("conversations.recording")}</h2>
        {rec === "available" && process.env.ELEVENLABS_API_KEY ? <>
          <audio controls preload="none" src={`/api/recordings/${c.id}`} style={{ width: "100%" }} />
          <a href={`/api/recordings/${c.id}?download=1`}>{t("rec.download")}</a>
        </> : <Notice>{rec === "deleted" ? t("rec.state.deleted") : rec === "available" ? t("rec.noKey") : t("conversations.noRecording")}</Notice>}
        <small className="muted">{t("conversations.deleteOn")} {fmtDate(deleteOn, locale)} · <Link href="/app/recordings">{t("nav.recordings")}</Link></small>
      </section>
      <section className="card stack">
        <h2>{t("conversations.transcript")}</h2>
        {c.transcript.length === 0 && <span className="muted">{t("common.none")}</span>}
        <div className="chat" dir={c.language === "ar" ? "rtl" : "ltr"}>
          {c.transcript.map((l, i) => (
            <div key={i} className={`bubble ${l.role}`}>{l.text}<small>{fmtDuration(l.atSec)}</small></div>
          ))}
        </div>
      </section>
      {staffRole === "manager" && (
        <section className="card danger-zone">
          <ConfirmDelete action={deleteConversationAction} summary={t("conversations.delete")} warning={t("conversations.delete.warn")}
            tick={t("common.confirmTick")} button={t("conversations.delete")} fields={{ id: c.id }} />
        </section>
      )}
    </>
  );
}
