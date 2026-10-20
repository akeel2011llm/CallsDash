import Link from "next/link";
import { requireClient } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDateTime, fmtDuration, fmtNum } from "@/lib/format";
import { getConversations } from "@/lib/data";
import { dailyCounts, lastDays, localDay, summarize } from "@/lib/stats";
import { FLAG_KINDS } from "@/lib/flags";
import { Flag, PageHead, Stat } from "@/components/ui";
import { DailyBars, HBars, SERIES, SegmentBar } from "@/components/charts";
import { Icon } from "@/components/icons";
import { PrintButton } from "@/components/PrintButton";

const CHANNELS = ["website", "whatsapp", "instagram", "phone"] as const;
const RANGES = [7, 30, 90] as const;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { tenant } = await requireClient();
  const sp = await searchParams;
  const days = RANGES.find((d) => String(d) === sp.days) ?? 30;
  const { t, locale } = await getT();
  const now = Date.now();
  const convs = lastDays(await getConversations(tenant.id), days, now);
  const s = summarize(convs);
  const perDay = dailyCounts(convs, days, now);
  const name = locale === "ar" ? tenant.branding.displayNameAr : tenant.branding.displayName;
  const from = perDay[0].key, to = perDay[perDay.length - 1].key;
  return (
    <>
      <PageHead
        title={t("reports.title")}
        subtitle={t("reports.help")}
        actions={
          <>
            <nav className="seg no-print">
              {RANGES.map((d) => <Link key={d} href={`/app/reports?days=${d}`} className={d === days ? "on" : ""}>{t(`reports.range.${d}` as "reports.range.7")}</Link>)}
            </nav>
            <a className="btn ghost no-print" href={`/app/reports/csv?days=${days}`}><Icon name="download" size={18} />{t("reports.csv")}</a>
            <PrintButton><Icon name="print" size={18} />{t("reports.print")}</PrintButton>
          </>
        }
      />
      <div className="print-head">
        {tenant.branding.logoUrl && <img src={tenant.branding.logoUrl} alt="" />}
        <div>
          <strong>{name}</strong>
          <div>{t("reports.title")} · {t("reports.period")}: {from} → {to}</div>
          <small>{t("reports.generated")} {fmtDateTime(new Date(now).toISOString(), locale)}</small>
        </div>
      </div>

      <div className="grid">
        <Stat icon="chat" label={t("reports.total")} value={s.total} />
        <Stat icon="check" label={t("reports.bookings")} value={s.bookings} />
        <Stat icon="shield" label={t("reports.resolution")} value={`${Math.round(s.handledRate * 100)}%`} hint={`${s.handoffs} ${t("reports.handoffs")}`} />
        <Stat icon="phone" label={t("reports.minutes")} value={fmtNum(s.voiceMinutes, locale, 1)} hint={`${t("reports.avgDuration")}: ${fmtDuration(s.avgDurationSec)}`} />
        <Stat icon="wallet" label={t("reports.credits")} value={fmtNum(s.credits, locale, 1)} />
      </div>

      <section className="card stack">
        <h2>{t("reports.byDay")}</h2>
        <DailyBars data={perDay} label={t("reports.byDay")} />
      </section>

      <div className="grid two">
        <section className="card stack">
          <h2>{t("reports.byChannel")}</h2>
          <HBars rows={CHANNELS.map((c, i) => ({ key: c, label: t(`channel.${c}` as "channel.website"), value: s.byChannel[c], color: SERIES[i] }))} />
        </section>
        <section className="card stack">
          <h2>{t("reports.outcomes")}</h2>
          <SegmentBar parts={[
            { key: "booked", label: t("outcome.booked"), value: s.byOutcome.booked, color: SERIES[2] },
            { key: "answered", label: t("outcome.answered"), value: s.byOutcome.answered, color: SERIES[0] },
            { key: "handed_off", label: t("outcome.handed_off"), value: s.byOutcome.handed_off, color: SERIES[1] },
            { key: "abandoned", label: t("outcome.abandoned"), value: s.byOutcome.abandoned, color: SERIES[3] },
          ]} />
        </section>
        <section className="card stack">
          <h2>{t("reports.flags")}</h2>
          <div className="stack">
            {FLAG_KINDS.map((k) => (
              <div key={k} className="row" style={{ justifyContent: "space-between" }}>
                <Flag kind={k}>{t(`flag.${k}` as "flag.lead")}</Flag><strong>{s.flags[k]}</strong>
              </div>
            ))}
          </div>
        </section>
        <section className="card stack">
          <h2>{t("reports.sentiment")}</h2>
          <SegmentBar parts={[
            { key: "positive", label: t("sentiment.positive"), value: s.bySentiment.positive, color: SERIES[2] },
            { key: "neutral", label: t("sentiment.neutral"), value: s.bySentiment.neutral, color: SERIES[0] },
            { key: "negative", label: t("sentiment.negative"), value: s.bySentiment.negative, color: SERIES[1] },
          ]} />
        </section>
      </div>

      <section className="card stack">
        <h2>{t("reports.table")}</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t("common.date")}</th><th>{t("reports.total")}</th><th>{t("reports.bookings")}</th><th>{t("reports.handoffs")}</th></tr></thead>
            <tbody>
              {perDay.slice().reverse().filter((d) => d.value > 0).map((d) => {
                const day = convs.filter((c) => localDay(Date.parse(c.startedAt)) === d.key);
                return <tr key={d.key}><td>{d.key}</td><td>{d.value}</td><td>{day.filter((c) => c.outcome === "booked").length}</td><td>{day.filter((c) => c.outcome === "handed_off").length}</td></tr>;
              })}
            </tbody>
          </table>
        </div>
      </section>
      {tenant.branding.reportFooter && <p className="print-foot muted">{tenant.branding.reportFooter}</p>}
    </>
  );
}
