import Link from "next/link";
import { requireDoctor } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { dayKey, fmtDate, fmtTime } from "@/lib/format";
import { getBookings } from "@/lib/data";
import { setBookingStatusAction } from "@/lib/actions";
import { Badge, PageHead, Stat } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";

const live = (s: string) => s === "confirmed" || s === "rescheduled";
const tone = (s: string) => (s === "confirmed" || s === "completed" ? "ok" : s === "cancelled" ? "bad" : s === "no_show" ? "warn" : "info");

/** The doctor's day: today's visits with one-tap outcomes, and what is coming this week. */
export default async function DoctorHome() {
  const { tenant, doctor } = await requireDoctor();
  const { t, locale } = await getT(tenant);
  const mine = (await getBookings(tenant.id)).filter((b) => b.doctorId === doctor.id).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const nowMs = Date.now();
  const today = dayKey(new Date().toISOString());
  const weekEnd = dayKey(new Date(nowMs + 7 * 86_400_000).toISOString());
  const todays = mine.filter((b) => dayKey(b.startsAt) === today && b.status !== "cancelled");
  const coming = mine.filter((b) => live(b.status) && dayKey(b.startsAt) > today && dayKey(b.startsAt) <= weekEnd);
  const next = mine.find((b) => live(b.status) && Date.parse(b.startsAt) + b.durationMin * 60_000 > nowMs);
  const noShows = mine.filter((b) => b.status === "no_show" && Date.parse(b.startsAt) > nowMs - 30 * 86_400_000).length;
  const status = (id: string, to: string, label: string, cls = "btn small ghost") => (
    <form action={setBookingStatusAction}>
      <input type="hidden" name="id" value={id} /><input type="hidden" name="status" value={to} /><input type="hidden" name="returnTo" value="/doctor" />
      <SubmitButton className={cls}>{label}</SubmitButton>
    </form>
  );
  return (
    <>
      <PageHead title={doctor.name} subtitle={`${t("doctor.today")} · ${fmtDate(new Date().toISOString(), locale)}`} actions={<Link className="btn" href="/doctor/bookings/new">{t("bookings.new")}</Link>} />
      <div className="grid">
        <Stat label={t("doctor.visitsToday")} value={todays.filter((b) => live(b.status) || b.status === "completed").length} />
        <Stat label={t("doctor.thisWeek")} value={coming.length} />
        <Stat label={t("bookings.noShows30")} value={noShows} />
      </div>
      {next && (
        <section className="card stack">
          <small className="muted">{t("doctor.next")}</small>
          <h2>{next.patientName}</h2>
          <div>{fmtDate(next.startsAt, locale)} · {fmtTime(next.startsAt, locale)} · {next.service}</div>
          {next.notes && <small className="muted">{next.notes}</small>}
          <div className="row"><Link className="btn small" href={`/doctor/bookings/${next.id}`}>{t("bookings.open")}</Link></div>
        </section>
      )}
      <section className="card stack">
        <h2>{t("doctor.today")}</h2>
        <div className="table-wrap">
          <table>
            <tbody>
              {todays.length === 0 && <tr><td className="muted">{t("doctor.nothingToday")}</td></tr>}
              {todays.map((b) => (
                <tr key={b.id}>
                  <td>{fmtTime(b.startsAt, locale)}</td>
                  <td><Link href={`/doctor/bookings/${b.id}`}>{b.patientName}</Link><br /><small className="muted">{b.service}</small></td>
                  <td><Badge tone={tone(b.status)}>{t(`booking.${b.status}` as "booking.confirmed")}</Badge></td>
                  <td>
                    {live(b.status) && (
                      <div className="row">
                        {status(b.id, "completed", t("bookings.complete"), "btn small")}
                        {status(b.id, "no_show", t("bookings.markNoShow"))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card stack">
        <h2>{t("doctor.comingUp")}</h2>
        <div className="table-wrap">
          <table>
            <tbody>
              {coming.length === 0 && <tr><td className="muted">{t("common.none")}</td></tr>}
              {coming.map((b) => (
                <tr key={b.id}>
                  <td>{fmtDate(b.startsAt, locale)} · {fmtTime(b.startsAt, locale)}</td>
                  <td><Link href={`/doctor/bookings/${b.id}`}>{b.patientName}</Link></td>
                  <td>{b.service}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
