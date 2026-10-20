import Link from "next/link";
import { requireClient } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { dayKey, fmtTime } from "@/lib/format";
import { getBookings, getDoctors } from "@/lib/data";
import { Notice, PageHead } from "@/components/ui";
import { setOpeningHoursAction } from "@/lib/actions";
import { SubmitButton } from "@/components/SubmitButton";

const FIRST_HOUR = 8;
const HOURS = 12; // 08:00 to 20:00
const ROW = 56;
const LOCAL_OFFSET_MS = 3 * 3_600_000; // Asia/Bahrain, no DST

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ w?: string; hours?: string }> }) {
  const { tenant } = await requireClient();
  const { w, hours } = await searchParams;
  const { t, locale } = await getT();
  const offset = Math.max(-52, Math.min(52, Number(w) || 0));
  const local = new Date(Date.now() + LOCAL_OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  const start = new Date(local.getTime() - local.getUTCDay() * 86_400_000 + offset * 7 * 86_400_000); // week starts Sunday
  const days = Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * 86_400_000));
  const todayKey = dayKey(new Date().toISOString());
  const doctors = await getDoctors(tenant.id);
  const color = new Map(doctors.map((d) => [d.id, d.color]));
  const name = new Map(doctors.map((d) => [d.id, d.name]));
  const bookings = await getBookings(tenant.id);
  const dayFmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-BH-u-nu-latn" : "en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  return (
    <>
      <PageHead
        title={t("calendar.title")}
        actions={
          <>
            <Link className="btn ghost" href={`/app/calendar?w=${offset - 1}`}>{t("common.prev")}</Link>
            <Link className="btn ghost" href="/app/calendar">{t("common.today")}</Link>
            <Link className="btn ghost" href={`/app/calendar?w=${offset + 1}`}>{t("common.next")}</Link>
          </>
        }
      />
      {!tenant.calendarConnected && <Notice tone="warn">{t("calendar.notConnected")}</Notice>}
      <div className="row">
        {doctors.map((d) => (
          <span key={d.id} className="row"><span className="logo" style={{ background: d.color, width: 12, height: 12, borderRadius: 99 }} />{d.name}</span>
        ))}
      </div>
      <div className="card table-wrap">
        <div className="week">
          <div className="head" />
          {days.map((d) => {
            const key = d.toISOString().slice(0, 10);
            return <div key={key} className={`head ${key === todayKey ? "today" : ""}`}>{dayFmt.format(d)}</div>;
          })}
          <div>
            {Array.from({ length: HOURS }, (_, i) => <div key={i} className="hour">{String(FIRST_HOUR + i).padStart(2, "0")}:00</div>)}
          </div>
          {days.map((d) => {
            const key = d.toISOString().slice(0, 10);
            return (
              <div key={key} className="col">
                {Array.from({ length: HOURS }, (_, i) => <div key={i} className="slot" />)}
                {bookings.filter((b) => dayKey(b.startsAt) === key).map((b) => {
                  const l = new Date(new Date(b.startsAt).getTime() + LOCAL_OFFSET_MS);
                  const hours = l.getUTCHours() + l.getUTCMinutes() / 60 - FIRST_HOUR;
                  if (hours < 0 || hours >= HOURS) return null;
                  return (
                    <div key={b.id} className={`event ${b.status === "cancelled" ? "cancelled" : ""}`}
                      style={{ top: hours * ROW, height: Math.max(22, (b.durationMin / 60) * ROW - 2), background: color.get(b.doctorId) }}
                      title={`${fmtTime(b.startsAt, locale)} ${b.patientName} · ${name.get(b.doctorId)} · ${b.service}`}>
                      <strong>{fmtTime(b.startsAt, locale)}</strong> {b.patientName}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <section id="hours" className="card stack">
        <h2>{t("hours.title")}</h2>
        <p className="muted">{t("hours.help")}</p>
        {hours === "saved" && <Notice tone="ok">{t("hours.saved")}</Notice>}
        {hours === "invalid" && <Notice tone="warn">{t("hours.invalid")}</Notice>}
        <form action={setOpeningHoursAction} className="stack">
          {[6, 0, 1, 2, 3, 4, 5].map((d) => {
            const day = tenant.openingHours[String(d)] ?? [];
            return (
              <div key={d} className="row" style={{ alignItems: "end" }}>
                <strong style={{ minInlineSize: 110 }}>{t(`day.${d}` as "day.0")}</strong>
                {(["a", "b"] as const).map((r, i) => (
                  <span key={r} className="row" dir="ltr">
                    <label>{i === 0 ? t("hours.from") : ""}<input type="time" name={`open${d}${r}`} defaultValue={day[i]?.[0] ?? ""} /></label>
                    <label>{i === 0 ? t("hours.to") : ""}<input type="time" name={`close${d}${r}`} defaultValue={day[i]?.[1] ?? ""} /></label>
                  </span>
                ))}
              </div>
            );
          })}
          <div><SubmitButton className="btn" type="submit">{t("common.save")}</SubmitButton></div>
        </form>
      </section>
    </>
  );
}
