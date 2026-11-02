import Link from "next/link";
import { clientSections, requireClient } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { dayKey, fill, fmtDateTime, fmtNum, fmtTime } from "@/lib/format";
import { getBookings, getConversations, getDoctors, getStaffRequests, getWallet } from "@/lib/data";
import { checklistFor } from "@/lib/setup-facts";
import { rulesOf } from "@/lib/business-types";
import type { Key } from "@/lib/i18n";
import { dailyCounts, lastDays, summarize } from "@/lib/stats";
import { flagRank, needsAttention } from "@/lib/flags";
import { Badge, Flag, Notice, Stat } from "@/components/ui";
import { DailyBars } from "@/components/charts";
import { Icon } from "@/components/icons";
import { ReceptionArt } from "@/components/art";
import { publicBranding } from "@/lib/brand-image";
import { patternOf } from "@/lib/theme";
import { BuildBadge } from "@/components/BuildBadge";
import type { BookingStatus } from "@/lib/types";

const TONE: Record<BookingStatus, "ok" | "warn" | "bad" | "neutral" | "info"> = { confirmed: "ok", rescheduled: "info", completed: "neutral", cancelled: "neutral", no_show: "bad" };

/**
 * "Today": what the front desk needs first thing (2026-11-02 rearrangement). Today's appointments, callbacks to make and
 * conversations that need a person come first; the week's numbers come after; charts by channel and outcome live in Reports.
 * Each part shows only when the person may open that section (lib/access.ts).
 */
export default async function Home({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const c = await requireClient();
  const { tenant, staffRole, viewingAsAdmin } = c;
  const { denied } = await searchParams;
  const [{ t, locale }, w, convs, bookings, requests, doctors, checklist, sections] = await Promise.all([
    getT(tenant), getWallet(tenant.id), getConversations(tenant.id), getBookings(tenant.id), getStaffRequests(tenant.id), getDoctors(tenant.id), checklistFor(tenant), clientSections(c),
  ]);
  const can = (s: (typeof sections)[number]) => sections.includes(s);
  // staff calendars are left out for a business that does not book time with people (lib/business-types.ts)
  const todo = staffRole === "manager" ? checklist.filter((i) => i.forClient && !i.done && (i.id !== "calendar" || rulesOf(tenant).needsStaff)) : [];
  const todoHref: Record<string, string> = { knowledge: "/app/knowledge", hours: "/app/calendar", calendar: "/app/calendar", test: "/app/assistant" };
  const now = Date.now();
  const today = dayKey(new Date(now).toISOString());
  const todays = bookings.filter((b) => dayKey(b.startsAt) === today && b.status !== "cancelled").sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const nextUp = todays.find((b) => new Date(b.startsAt).getTime() > now);
  const upcoming = bookings.filter((b) => new Date(b.startsAt).getTime() > now && b.status !== "cancelled" && dayKey(b.startsAt) !== today).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const callbacks = requests.filter((r) => r.status === "open").sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.createdAt.localeCompare(a.createdAt));
  const top = (fl: string[]) => fl.slice().sort((x, y) => flagRank[x as "lead"] - flagRank[y as "lead"])[0] as "lead";
  const attention = convs.filter(needsAttention).sort((a, b) => flagRank[top(a.flags)] - flagRank[top(b.flags)] || b.startedAt.localeCompare(a.startedAt));
  const week = summarize(lastDays(convs, 7, now));
  const trend = dailyCounts(convs, 14, now);
  const docName = new Map(doctors.map((d) => [d.id, d.name]));
  const brand = publicBranding(tenant);
  const name = locale === "ar" ? tenant.branding.displayNameAr : tenant.branding.displayName;
  const welcome = (locale === "ar" ? tenant.branding.welcomeAr : tenant.branding.welcome) || "";
  const dateLine = new Intl.DateTimeFormat(locale === "ar" ? "ar-BH" : "en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Bahrain" }).format(new Date(now));
  const quick = [
    can("bookings") && { href: "/app/bookings/new", icon: "plus", label: t("today.newBooking") },
    can("customers") && { href: "/app/customers", icon: "search", label: t("today.findCustomer") },
    can("inbox") && { href: "/app/messages", icon: "inbox", label: t("today.callbacks") },
    can("assistant") && { href: "/app/assistant", icon: "chat", label: t("today.tryAssistant") },
  ].filter(Boolean) as { href: string; icon: string; label: string }[];

  return (
    <>
      {viewingAsAdmin && <BuildBadge />}
      {denied && <Notice tone="warn">{t("access.denied")}</Notice>}
      <section className="hero today" data-pattern={patternOf(brand) === "none" ? undefined : patternOf(brand)} data-cover={brand.coverUrl ? "" : undefined} style={brand.coverUrl ? ({ "--cover": `url("${brand.coverUrl}")` } as React.CSSProperties) : undefined}>
        {!brand.coverUrl && <ReceptionArt className="art" />}
        <div>
          <small className="hero-date">{dateLine}</small>
          <h1>{t("home.greeting")}, {name}</h1>
          {welcome && <p>{welcome}</p>}
        </div>
      </section>
      {quick.length > 0 && (
        <nav className="quick" aria-label={t("today.quick")}>
          {quick.map((q) => <Link key={q.href} className="quick-btn" href={q.href}><Icon name={q.icon} size={20} /><span>{q.label}</span></Link>)}
        </nav>
      )}

      {w.low && can("billing") && <Notice tone="warn">{t("home.lowBalance")} <Link href="/app/credits">{t("credits.request")}</Link></Notice>}
      {todo.length > 0 && (
        <details className="card fold" open={todo.length > 2}>
          <summary><span className="fold-head"><strong>{t("home.start.title")}</strong><small className="muted">{t("home.start.help")}</small></span><Badge tone="warn">{todo.length}</Badge></summary>
          <ul className="checklist">
            {todo.map((i) => (
              <li key={i.id}>
                <span className="mark" aria-hidden><Icon name="tick" size={16} /></span>
                <div><span className="title">{t(`setup.item.${i.id}` as Key)}</span><small>{t(`setup.item.${i.id}.hint` as Key)}</small></div>
                <Link className="btn small ghost" href={todoHref[i.id] ?? "/app"}>{t("setup.open")}</Link>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="grid">
        {can("bookings") && <Stat icon="check" label={t("today.appointments")} value={todays.length} hint={nextUp ? fill(t("today.next"), { time: fmtTime(nextUp.startsAt, locale) }) : undefined} />}
        {can("inbox") && <Stat icon="inbox" label={t("today.callbacksWaiting")} value={callbacks.length} tone={callbacks.some((r) => r.urgent) ? "bad" : callbacks.length ? "warn" : undefined} />}
        {can("inbox") && <Stat icon="alert" label={t("nav.attention")} value={attention.length} tone={attention.length ? "warn" : undefined} />}
        {can("billing") ? <Stat icon="wallet" label={t("home.balance")} value={fmtNum(w.balance, locale, 1)} tone={w.low ? "warn" : undefined} />
          : <Stat icon="chat" label={t("home.conversations")} value={week.total} hint={t("home.last7")} />}
      </div>

      <div className="grid two">
        {can("bookings") && (
          <section className="card stack">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2 style={{ margin: 0 }}>{t("today.appointments")}</h2>
              <Link className="btn small ghost" href="/app/bookings?view=today">{t("home.viewAll")}</Link>
            </div>
            {todays.length === 0 ? <p className="muted" style={{ margin: 0 }}>{t("today.noAppointments")}</p> : (
              <ul className="day-list">
                {todays.slice(0, 8).map((b) => (
                  <li key={b.id} className={new Date(b.startsAt).getTime() < now ? "past" : undefined}>
                    <Link href={`/app/bookings/${b.id}`}>
                      <strong className="time" dir="ltr">{fmtTime(b.startsAt, locale)}</strong>
                      <span className="who"><span dir="auto">{b.patientName}</span><small className="muted" dir="auto">{[docName.get(b.doctorId), b.service].filter(Boolean).join(" · ")}</small></span>
                      <Badge tone={TONE[b.status] ?? "neutral"}>{t(`booking.${b.status}` as "booking.confirmed")}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {upcoming.length > 0 && <small className="muted">{fill(t("today.later"), { n: upcoming.length, when: fmtDateTime(upcoming[0].startsAt, locale) })}</small>}
          </section>
        )}

        {can("inbox") && (
          <section className="card stack">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2 style={{ margin: 0 }}>{t("today.toDo")}</h2>
              <Link className="btn small ghost" href="/app/messages">{t("home.viewAll")}</Link>
            </div>
            {callbacks.length === 0 && attention.length === 0 && <p className="muted" style={{ margin: 0 }}>{t("today.nothing")}</p>}
            {callbacks.length > 0 && (
              <ul className="day-list">
                {callbacks.slice(0, 4).map((r) => (
                  <li key={r.id}>
                    <Link href="/app/messages">
                      <span className="time"><Icon name="phone" size={18} /></span>
                      <span className="who"><span dir="auto">{r.name || r.phone}</span><small className="muted" dir="auto">{r.text}</small></span>
                      {r.urgent ? <Badge tone="bad">{t("today.urgent")}</Badge> : <Badge tone="warn">{t("today.callBack")}</Badge>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {attention.length > 0 && (
              <div className="attn">
                {attention.slice(0, 3).map((cv) => (
                  <Link key={cv.id} href={`/app/conversations/${cv.id}`} className={`attn-item ${top(cv.flags)}`} style={{ color: "inherit", textDecoration: "none" }}>
                    <span className="row">{cv.flags.map((f) => <Flag key={f} kind={f}>{t(`flag.${f}` as "flag.lead")}</Flag>)}<small className="muted">{fmtDateTime(cv.startedAt, locale)}</small></span>
                    <span dir={cv.language === "ar" ? "rtl" : "ltr"}>{cv.summary}</span>
                  </Link>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      {can("inbox") && (
        <div className="grid wide">
          <section className="card stack">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2 style={{ margin: 0 }}>{t("home.trend")}</h2>
              {can("reports") && <Link className="btn small ghost" href="/app/reports">{t("nav.reports")}</Link>}
            </div>
            <DailyBars data={trend} label={t("home.trend")} />
            <small className="muted">{fill(t("today.week"), { n: week.total, booked: week.byOutcome.booked, handoffs: week.handoffs })}</small>
          </section>
          <section className="card stack">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2 style={{ margin: 0 }}>{t("home.recent")}</h2>
              <Link className="btn small ghost" href="/app/conversations">{t("home.viewAll")}</Link>
            </div>
            <ul className="day-list">
              {convs.slice(0, 5).map((cv) => (
                <li key={cv.id}>
                  <Link href={`/app/conversations/${cv.id}`}>
                    <span className="time"><small className="muted">{fmtTime(cv.startedAt, locale)}</small></span>
                    <span className="who"><span dir={cv.language === "ar" ? "rtl" : "ltr"} className="clip">{cv.summary}</span><small className="muted">{t(`channel.${cv.channel}` as "channel.website")}</small></span>
                    <Badge tone={cv.outcome === "booked" ? "ok" : cv.outcome === "handed_off" ? "warn" : "neutral"}>{t(`outcome.${cv.outcome}` as "outcome.booked")}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </>
  );
}
