import Link from "next/link";
import { requireClient } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { dayKey, fmtDate, fmtTime } from "@/lib/format";
import { getBookings, getDoctors } from "@/lib/data";
import { Notice, PageHead } from "@/components/ui";
import { setOpeningHoursAction } from "@/lib/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { HoursFields } from "@/components/HoursFields";
import { addClosureAction, removeClosureAction } from "@/lib/manage-actions";

const FIRST_HOUR = 8;
const HOURS = 12; // 08:00 to 20:00
const ROW = 56;
const LOCAL_OFFSET_MS = 3 * 3_600_000; // Asia/Bahrain, no DST

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ w?: string; hours?: string; closure?: string; clash?: string }> }) {
  const { tenant, staffRole } = await requireClient();
  const { w, hours, closure, clash } = await searchParams;
  const { t, locale } = await getT(tenant);
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
          <HoursFields hours={tenant.openingHours} t={t} />
          <div><SubmitButton className="btn" type="submit">{t("common.save")}</SubmitButton></div>
        </form>
        {staffRole === "manager" && <small><Link href="/app/doctors">{t("calendar.doctorHours")}</Link></small>}
      </section>
      <section id="closures" className="card stack">
        <h2>{t("closures.title")}</h2>
        <p className="muted">{t("closures.help")}</p>
        {closure === "saved" && <Notice tone="ok">{t("closures.saved")}</Notice>}
        {closure === "invalid" && <Notice tone="warn">{t("closures.invalid")}</Notice>}
        {Number(clash) > 0 && <Notice tone="warn">{t("doctors.clash").replace("{n}", String(Number(clash)))}</Notice>}
        {(tenant.closures ?? []).filter((r) => r.to >= todayKey).length === 0 && <small className="muted">{t("closures.none")}</small>}
        {(tenant.closures ?? []).filter((r) => r.to >= todayKey).map((r) => (
          <form key={`${r.from}-${r.to}`} action={removeClosureAction} className="row">
            <input type="hidden" name="tenantId" value={tenant.id} /><input type="hidden" name="from" value={r.from} /><input type="hidden" name="to" value={r.to} />
            <span>{fmtDate(`${r.from}T12:00:00Z`, locale)}{r.to !== r.from ? ` – ${fmtDate(`${r.to}T12:00:00Z`, locale)}` : ""}{r.note ? <span className="muted"> · {r.note}</span> : null}</span>
            {staffRole === "manager" && <SubmitButton className="btn small ghost" type="submit">{t("common.remove")}</SubmitButton>}
          </form>
        ))}
        {staffRole === "manager" && (
          <form action={addClosureAction} className="row" style={{ alignItems: "end" }}>
            <input type="hidden" name="tenantId" value={tenant.id} />
            <label>{t("doctors.leave.from")}<input type="date" name="from" min={todayKey} required /></label>
            <label>{t("doctors.leave.to")}<input type="date" name="to" min={todayKey} /></label>
            <label style={{ flex: 1, minWidth: 160 }}>{t("doctors.leave.note")}<input name="note" maxLength={120} placeholder={t("closures.notePh")} /></label>
            <SubmitButton className="btn small" type="submit">{t("common.add")}</SubmitButton>
          </form>
        )}
      </section>
    </>
  );
}
