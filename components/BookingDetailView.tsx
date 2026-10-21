import Link from "next/link";
import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n";
import { dayKey, fmtDateTime, fmtTime } from "@/lib/format";
import { getBookings, getDoctors } from "@/lib/data";
import { bookingService } from "@/lib/booking-service";
import { daySlots, isBookingError, todayKey } from "@/lib/booking-ui";
import { rescheduleBookingAction, saveBookingNotesAction, setBookingStatusAction } from "@/lib/actions";
import { Badge, Notice, PageHead } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import type { BookingScope } from "@/components/BookingList";

export type BookingDetailParams = { date?: string; err?: string; created?: string; moved?: string; saved?: string };
const tone = (s: string) => (s === "confirmed" || s === "completed" ? "ok" : s === "cancelled" ? "bad" : s === "no_show" ? "warn" : "info");

export async function BookingDetailView({ base, tenant, doctorId, id, sp }: BookingScope & { id: string; sp: BookingDetailParams }) {
  const { t, locale } = await getT();
  const booking = (await getBookings(tenant.id)).find((b) => b.id === id && (!doctorId || b.doctorId === doctorId));
  if (!booking) notFound();
  const doctor = (await getDoctors(tenant.id)).find((d) => d.id === booking.doctorId);
  const active = booking.status === "confirmed" || booking.status === "rescheduled";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : dayKey(booking.startsAt);
  const slots = active && sp.date && doctor ? await daySlots(await bookingService(), tenant.id, doctor.id, date) : null;
  const here = `${base}/bookings/${booking.id}`;
  const status = (to: string, label: string, cls = "btn small ghost") => (
    <form action={setBookingStatusAction}>
      <input type="hidden" name="id" value={booking.id} /><input type="hidden" name="status" value={to} /><input type="hidden" name="returnTo" value={here} />
      <SubmitButton className={cls}>{label}</SubmitButton>
    </form>
  );
  const phoneDigits = booking.patientPhone.replace(/\D/g, "");
  return (
    <>
      <PageHead title={booking.patientName} subtitle={fmtDateTime(booking.startsAt, locale)} actions={<Link className="btn ghost" href={`${base}/bookings`}>{t("common.back")}</Link>} />
      {isBookingError(sp.err) && <Notice tone="warn">{t(`bookings.err.${sp.err}` as "bookings.err.slot_taken")}</Notice>}
      {sp.created && <Notice tone="ok">{t("bookings.created")}</Notice>}
      {sp.moved && <Notice tone="ok">{t("bookings.moved")}</Notice>}
      {sp.saved && <Notice tone="ok">{t("bookings.saved")}</Notice>}
      <section className="card stack">
        <div className="row">
          <Badge tone={tone(booking.status)}>{t(`booking.${booking.status}` as "booking.confirmed")}</Badge>
          <Badge>{t(`bookings.source.${booking.source ?? "ai"}` as "bookings.source.ai")}</Badge>
          <Badge tone={booking.calendarEventId ? "ok" : "neutral"}>
            {booking.calendarEventId ? t("bookings.calSynced") : doctor?.googleCalendarId ? t("bookings.calMissing") : t("bookings.calNoDoctor")}
          </Badge>
        </div>
        <div>{t("common.doctor")}: <strong>{doctor?.name}</strong></div>
        <div>{t("common.service")}: {booking.service}</div>
        <div>{t("common.phone")}: <a href={`tel:+${phoneDigits}`} dir="ltr">{booking.patientPhone}</a> · <a href={`https://wa.me/${phoneDigits}`} target="_blank" rel="noreferrer">WhatsApp</a></div>
        <small className="muted">{t("bookings.remindersNote")}</small>
        <div className="row">
          {active && status("completed", t("bookings.complete"), "btn small")}
          {active && new Date(booking.startsAt) < new Date() && status("no_show", t("bookings.markNoShow"))}
          {active && status("cancelled", t("bookings.cancel"), "btn small danger")}
          {!active && status("confirmed", t("bookings.restore"))}
        </div>
      </section>
      <form action={saveBookingNotesAction} className="card stack">
        <input type="hidden" name="id" value={booking.id} />
        <label>{t("bookings.notes")}<textarea name="notes" rows={4} maxLength={1000} defaultValue={booking.notes ?? ""} /></label>
        <div><SubmitButton className="btn small" type="submit">{t("common.save")}</SubmitButton></div>
      </form>
      {active && (
        <section className="card stack">
          <h2>{t("bookings.reschedule")}</h2>
          <form method="get" className="filters">
            <label>{t("common.date")}<input type="date" name="date" defaultValue={date} min={todayKey()} required /></label>
            <SubmitButton className="btn ghost" type="submit">{t("bookings.showTimes")}</SubmitButton>
          </form>
          {slots && (slots.error ? <Notice tone="warn">{t(`bookings.err.${isBookingError(slots.error) ? slots.error : "bad_date"}` as "bookings.err.slot_taken")}</Notice>
            : slots.slots.length === 0 ? <Notice>{t("bookings.noTimes")}</Notice>
            : (
              <form action={rescheduleBookingAction} className="row">
                <input type="hidden" name="id" value={booking.id} />
                <select name="startsAt" required>{slots.slots.map((s) => <option key={s} value={s}>{fmtTime(s, locale)}</option>)}</select>
                <SubmitButton className="btn small" type="submit">{t("bookings.moveHere")}</SubmitButton>
              </form>
            ))}
        </section>
      )}
    </>
  );
}
