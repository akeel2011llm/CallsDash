import Link from "next/link";
import { notFound } from "next/navigation";
import { requireClient } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate, fmtDateTime, fmtDuration, fmtNum } from "@/lib/format";
import { getConversation } from "@/lib/store";
import { Badge, Notice, PageHead } from "@/components/ui";

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { tenant } = await requireClient();
  const { id } = await params;
  const c = getConversation(tenant.id, id);
  if (!c) notFound();
  const { t, locale } = await getT();
  const deleteOn = new Date(new Date(c.startedAt).getTime() + tenant.retentionDays * 86_400_000).toISOString();
  return (
    <>
      <PageHead title={t("conversations.title")} actions={<Link className="btn ghost" href="/app/conversations">{t("common.back")}</Link>} />
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
        {c.recordingUrl ? <audio controls preload="none" src={c.recordingUrl} style={{ width: "100%" }} /> : <Notice>{t("conversations.noRecording")}</Notice>}
        <small className="muted">{t("conversations.deleteOn")} {fmtDate(deleteOn, locale)}</small>
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
    </>
  );
}
