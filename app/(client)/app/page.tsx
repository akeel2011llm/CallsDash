import Link from "next/link";
import { requireClient } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDateTime, fmtNum } from "@/lib/format";
import { getBookings, getConversations, getWallet } from "@/lib/data";
import { checklistFor } from "@/lib/setup-facts";
import type { Key } from "@/lib/i18n";
import { dailyCounts, lastDays, summarize } from "@/lib/stats";
import { flagRank, needsAttention } from "@/lib/flags";
import { Badge, Flag, Notice, PageHead, Stat } from "@/components/ui";
import { DailyBars, HBars, SERIES, SegmentBar } from "@/components/charts";
import { Icon } from "@/components/icons";
import { ReceptionArt } from "@/components/art";
import { publicBranding } from "@/lib/brand-image";
import { patternOf } from "@/lib/theme";

const CHANNELS = ["website", "whatsapp", "instagram", "phone"] as const;

export default async function Home() {
  const { tenant, staffRole } = await requireClient();
  const [{ t, locale }, w, convs, bookings, checklist] = await Promise.all([getT(), getWallet(tenant.id), getConversations(tenant.id), getBookings(tenant.id), checklistFor(tenant)]);
  const todo = staffRole === "manager" ? checklist.filter((i) => i.forClient && !i.done) : [];
  const todoHref: Record<string, string> = { knowledge: "/app/knowledge", hours: "/app/calendar", calendar: "/app/calendar", test: "/app/website" };
  const now = Date.now();
  const week = summarize(lastDays(convs, 7, now));
  const prevWeek = summarize(lastDays(convs, 14, now).filter((c) => !lastDays(convs, 7, now).includes(c)));
  const month = summarize(lastDays(convs, 30, now));
  const trend = dailyCounts(convs, 14, now);
  const upcoming = bookings.filter((b) => new Date(b.startsAt).getTime() > now && b.status !== "cancelled").sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const attention = convs.filter(needsAttention).sort((a, b) => flagRank[a.flags.slice().sort((x, y) => flagRank[x] - flagRank[y])[0]] - flagRank[b.flags.slice().sort((x, y) => flagRank[x] - flagRank[y])[0]] || b.startedAt.localeCompare(a.startedAt));
  const brand = publicBranding(tenant);
  const name = locale === "ar" ? tenant.branding.displayNameAr : tenant.branding.displayName;
  const welcome = (locale === "ar" ? tenant.branding.welcomeAr : tenant.branding.welcome) || "";
  const delta = prevWeek.total > 0 ? Math.round(((week.total - prevWeek.total) / prevWeek.total) * 100) : null;
  return (
    <>
      <section className="hero" data-pattern={patternOf(brand) === "none" ? undefined : patternOf(brand)} data-cover={brand.coverUrl ? "" : undefined} style={brand.coverUrl ? ({ "--cover": `url("${brand.coverUrl}")` } as React.CSSProperties) : undefined}>
        {!brand.coverUrl && <ReceptionArt className="art" />}
        <div>
          <h1>{t("home.greeting")}, {name}</h1>
          {welcome && <p>{welcome}</p>}
        </div>
        <Link className="btn" href="/app/reports"><Icon name="chart" size={18} />{t("nav.reports")}</Link>
      </section>
      {todo.length > 0 && (
        <section className="card stack">
          <h2>{t("home.start.title")}</h2>
          <p className="muted">{t("home.start.help")}</p>
          <ul className="checklist">
            {todo.map((i) => (
              <li key={i.id}>
                <span className="mark" aria-hidden><Icon name="tick" size={16} /></span>
                <div><span className="title">{t(`setup.item.${i.id}` as Key)}</span><small>{t(`setup.item.${i.id}.hint` as Key)}</small></div>
                <Link className="btn small ghost" href={todoHref[i.id] ?? "/app"}>{t("setup.open")}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {w.low && <Notice tone="warn">{t("home.lowBalance")} <Link href="/app/credits">{t("credits.request")}</Link></Notice>}
      <div className="grid">
        <Stat icon="chat" label={t("home.conversations")} value={week.total} trend={trend.slice(-7).map((d) => d.value)}
          delta={delta === null ? undefined : { text: `${delta >= 0 ? "+" : ""}${delta}%`, up: delta >= 0 }} hint={t("home.last7")} />
        <Stat icon="check" label={t("home.bookings")} value={upcoming.length} />
        <Stat icon="inbox" label={t("home.handoffs")} value={week.handoffs} hint={t("home.last7")} />
        <Stat icon="wallet" label={t("home.balance")} value={fmtNum(w.balance, locale, 1)} tone={w.low ? "warn" : undefined} />
      </div>

      <div className="grid wide">
        <section className="card stack">
          <h2>{t("home.trend")}</h2>
          <DailyBars data={trend} label={t("home.trend")} />
        </section>
        <section className="card stack">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>{t("home.attention")}</h2>
            <Link href="/app/attention">{t("home.viewAll")}</Link>
          </div>
          {attention.length === 0 ? <p className="muted">{t("home.attention.none")}</p> : (
            <div className="attn">
              {attention.slice(0, 4).map((c) => {
                const top = c.flags.slice().sort((a, b) => flagRank[a] - flagRank[b])[0];
                return (
                  <Link key={c.id} href={`/app/conversations/${c.id}`} className={`attn-item ${top}`} style={{ color: "inherit", textDecoration: "none" }}>
                    <span className="row">{c.flags.map((f) => <Flag key={f} kind={f}>{t(`flag.${f}` as "flag.lead")}</Flag>)}<small className="muted">{fmtDateTime(c.startedAt, locale)}</small></span>
                    <span dir={c.language === "ar" ? "rtl" : "ltr"}>{c.summary}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <div className="grid two">
        <section className="card stack">
          <h2>{t("home.byChannel")}</h2>
          <HBars rows={CHANNELS.map((c, i) => ({ key: c, label: t(`channel.${c}` as "channel.website"), value: month.byChannel[c], color: SERIES[i] }))} />
        </section>
        <section className="card stack">
          <h2>{t("home.outcomes")}</h2>
          <SegmentBar parts={[
            { key: "booked", label: t("outcome.booked"), value: month.byOutcome.booked, color: SERIES[2] },
            { key: "answered", label: t("outcome.answered"), value: month.byOutcome.answered, color: SERIES[0] },
            { key: "handed_off", label: t("outcome.handed_off"), value: month.byOutcome.handed_off, color: SERIES[1] },
            { key: "abandoned", label: t("outcome.abandoned"), value: month.byOutcome.abandoned, color: SERIES[3] },
          ]} />
        </section>
      </div>

      <div className="grid wide">
        <section className="card stack">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>{t("home.recent")}</h2>
            <Link href="/app/conversations">{t("home.viewAll")}</Link>
          </div>
          <div className="table-wrap">
            <table className="cards">
              <tbody>
                {convs.slice(0, 6).map((c) => (
                  <tr key={c.id}>
                    <td>{fmtDateTime(c.startedAt, locale)}</td>
                    <td>{t(`channel.${c.channel}` as "channel.website")}</td>
                    <td><Badge tone={c.outcome === "booked" ? "ok" : c.outcome === "handed_off" ? "warn" : "neutral"}>{t(`outcome.${c.outcome}` as "outcome.booked")}</Badge></td>
                    <td dir={c.language === "ar" ? "rtl" : "ltr"}><Link href={`/app/conversations/${c.id}`}>{c.summary}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card stack">
          <h2>{t("home.upcoming")}</h2>
          {upcoming.length === 0 ? <p className="muted">{t("home.noUpcoming")}</p> : (
            <div className="table-wrap"><table><tbody>
              {upcoming.slice(0, 5).map((b) => (
                <tr key={b.id}><td>{fmtDateTime(b.startsAt, locale)}</td><td>{b.patientName}</td></tr>
              ))}
            </tbody></table></div>
          )}
        </section>
      </div>
    </>
  );
}
