import Link from "next/link";
import { asksId, idInputProps, idRuleOf } from "@/lib/id-rule";
import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n";
import { dayKey, fill, fmtDateTime, fmtTime } from "@/lib/format";
import { getBookings, getDoctors } from "@/lib/data";
import { bookingService } from "@/lib/booking-service";
import { daySlots, isBookingError, todayKey } from "@/lib/booking-ui";
import { rescheduleBookingAction, saveBookingNotesAction, setBookingStatusAction } from "@/lib/actions";
import { Badge, Notice, PageHead } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import type { BookingScope } from "@/components/BookingList";
import { deleteBookingAction, resendWhatsappConfirmationAction, updateBookingDetailsAction } from "@/lib/manage-actions";
import { bookingRef } from "@/lib/booking-ref";
import { confirmationOptions, failureHint } from "@/lib/whatsapp";
import { ConfirmDelete } from "@/components/Confirm";

export type BookingDetailParams = { date?: string; err?: string; created?: string; moved?: string; saved?: string; wa?: string };
const tone = (s: string) => (s === "confirmed" || s === "completed" ? "ok" : s === "cancelled" ? "bad" : s === "no_show" ? "warn" : "info");

/** `canDelete`: the clinic's manager. Everyone else cancels, which keeps the record. */
export async function BookingDetailView({ base, tenant, doctorId, id, sp, canDelete = false }: BookingScope & { id: string; sp: BookingDetailParams; canDelete?: boolean }) {
  const { t, locale } = await getT(tenant);
  const booking = (await getBookings(tenant.id)).find((b) => b.id === id && (!doctorId || b.doctorId === doctorId));
  if (!booking) notFound();
  const doctors = await getDoctors(tenant.id);
  const doctor = doctors.find((d) => d.id === booking.doctorId);
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
  const wa = confirmationOptions(tenant);
  const idRule = idRuleOf(tenant);
  const msg = booking.message;
  // a note that says "sending" for more than ten minutes means the sending was cut short: nobody knows if it arrived
  const stuck = msg?.status === "sending" && Date.now() - Date.parse(msg.at) > 10 * 60_000;
  const waLang = msg?.lang ?? booking.language ?? wa.main;
  const waState = !msg ? "none" : stuck ? "unknown" : msg.status;
  const waTone = ({ none: "neutral", unknown: "warn", sending: "info", sent: "ok", failed: "bad", skipped: "warn" } as const)[waState];
  const hint = msg?.status === "failed" ? failureHint(msg.detail) : null;
  return (
    <>
      <PageHead title={booking.patientName} subtitle={fmtDateTime(booking.startsAt, locale)} actions={<Link className="btn ghost" href={`${base}/bookings`}>{t("common.back")}</Link>} />
      {isBookingError(sp.err) && <Notice tone="warn">{t(`bookings.err.${sp.err}` as "bookings.err.slot_taken")}</Notice>}
      {sp.err === "confirm" && <Notice tone="warn">{t("doctors.n.confirm")}</Notice>}
      {sp.created && <Notice tone="ok">{t("bookings.created")}</Notice>}
      {sp.moved && <Notice tone="ok">{t("bookings.moved")}</Notice>}
      {sp.saved && <Notice tone="ok">{t("bookings.saved")}</Notice>}
      {sp.wa && <Notice tone={sp.wa === "sent" ? "ok" : "warn"}>{t(`bookings.wa.result.${["sent", "failed", "not_active", "bad_phone", "not_configured", "no_agent", "channel_off", "confirmations_off"].includes(sp.wa) ? sp.wa : "failed"}` as "bookings.wa.result.sent")}</Notice>}
      <section className="card stack">
        <div className="row">
          <Badge tone={tone(booking.status)}>{t(`booking.${booking.status}` as "booking.confirmed")}</Badge>
          <Badge>{t(`bookings.source.${booking.source ?? "ai"}` as "bookings.source.ai")}</Badge>
          <Badge tone={booking.calendarEventId ? "ok" : "neutral"}>
            {booking.calendarEventId ? t("bookings.calSynced") : doctor?.googleCalendarId ? t("bookings.calMissing") : t("bookings.calNoDoctor")}
          </Badge>
        </div>
        <div>{t("common.doctor")}: <strong>{doctor?.name}</strong></div>
        <div>{t("bookings.ref")}: <strong dir="ltr">{bookingRef(booking.id)}</strong></div>
        <div>{t("common.service")}: {booking.service}</div>
        <div>{t("common.phone")}: <a href={`tel:+${phoneDigits}`} dir="ltr">{booking.patientPhone}</a> · <a href={`https://wa.me/${phoneDigits}`} target="_blank" rel="noreferrer">WhatsApp</a></div>
        {(asksId(idRule) || booking.patientCpr) && <div>{t("bookings.patientCpr")}: {booking.patientCpr ? <span dir="ltr">{booking.patientCpr}</span> : <span className="muted">{t("bookings.noCpr")}</span>}</div>}
        <small className="muted">{t("bookings.remindersNote")}</small>
        <div className="row">
          {active && status("completed", t("bookings.complete"), "btn small")}
          {active && new Date(booking.startsAt) < new Date() && status("no_show", t("bookings.markNoShow"))}
          {active && status("cancelled", t("bookings.cancel"), "btn small danger")}
          {!active && status("confirmed", t("bookings.restore"))}
        </div>
      </section>
      {(wa.active || msg) && (
        <section className="card stack">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>{t("bookings.wa.title")}</h2>
            <Badge tone={waTone}>{t(`bookings.wa.state.${waState}` as "bookings.wa.state.sent")}</Badge>
          </div>
          {waState === "none" && <p className="muted">{t("bookings.wa.none")}</p>}
          {waState === "sending" && <p className="muted">{t("bookings.wa.sendingNote")}</p>}
          {waState === "unknown" && <p className="muted">{t("bookings.wa.unknown")}</p>}
          {msg?.status === "sent" && <p className="muted">{fill(t("bookings.wa.sentOn"), { when: fmtDateTime(msg.at, locale) })} {t("bookings.wa.sentNote")}</p>}
          {msg?.status === "failed" && (
            <div className="stack" style={{ gap: ".3rem" }}>
              <p className="muted">{t("bookings.wa.failedNote")}</p>
              {hint && <p>{t(`bookings.wa.hint.${hint}` as "bookings.wa.hint.template")}</p>}
              {msg.detail && <small className="muted" dir="ltr"><code>{msg.detail}</code></small>}
            </div>
          )}
          {msg?.status === "skipped" && <p className="muted">{t(`bookings.wa.skipped.${msg.detail ?? "bad_phone"}` as "bookings.wa.skipped.bad_phone")}</p>}
          {wa.languages.length > 1 && <small className="muted">{t("bookings.wa.langIs")}: {waLang === "ar" ? "العربية" : "English"}</small>}
          {active && wa.active && (
            <form action={resendWhatsappConfirmationAction}>
              <input type="hidden" name="id" value={booking.id} />
              <SubmitButton className="btn small ghost">{msg?.status === "sent" ? t("bookings.wa.resend") : t("bookings.wa.sendNow")}</SubmitButton>
            </form>
          )}
        </section>
      )}
      <details className="card">
        <summary style={{ cursor: "pointer" }}><strong>{t("bookings.editDetails")}</strong></summary>
        <form action={updateBookingDetailsAction} className="stack" style={{ marginBlockStart: ".6rem" }}>
          <input type="hidden" name="id" value={booking.id} />
          <div className="row">
            <label style={{ flex: 2, minWidth: 180 }}>{t("bookings.patient")}<input name="patientName" required maxLength={120} defaultValue={booking.patientName} /></label>
            <label style={{ flex: 1, minWidth: 150 }}>{t("common.phone")}<input name="patientPhone" required maxLength={30} defaultValue={booking.patientPhone} dir="ltr" inputMode="tel" /></label>
            {asksId(idRule) && <label style={{ flex: 1, minWidth: 130 }}>{t("bookings.patientCpr")}<input name="patientCpr" {...idInputProps(idRule)} placeholder={undefined} defaultValue={booking.patientCpr ?? ""} required={Boolean(booking.patientCpr)} /></label>}
          </div>
          <label>{t("common.service")}<input name="service" maxLength={120} defaultValue={booking.service} /></label>
          {wa.languages.length > 1 && (
            <label>{t("bookings.wa.lang")}
              <select name="language" defaultValue={waLang}>{wa.languages.map((l) => <option key={l} value={l}>{l === "ar" ? "العربية" : "English"}</option>)}</select>
            </label>
          )}
          {!doctorId && (
            <label>{t("common.doctor")}
              <select name="doctorId" defaultValue={booking.doctorId}>
                {doctors.filter((d) => d.active !== false || d.id === booking.doctorId).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
          )}
          {!doctorId && <small className="muted">{t("bookings.changeDoctorHelp")}</small>}
          {wa.active && active && <label className="inline"><input type="checkbox" name="whatsapp" defaultChecked />{t("bookings.wa.sendChanged")}</label>}
          <div><SubmitButton className="btn small" type="submit">{t("common.save")}</SubmitButton></div>
        </form>
      </details>
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
                {wa.active && <label className="inline"><input type="checkbox" name="whatsapp" defaultChecked />{t("bookings.wa.sendMove")}</label>}
                <SubmitButton className="btn small" type="submit">{t("bookings.moveHere")}</SubmitButton>
              </form>
            ))}
        </section>
      )}
      {canDelete && (
        <section className="card danger-zone">
          <ConfirmDelete action={deleteBookingAction} summary={t("bookings.delete")} warning={t("bookings.delete.warn")}
            tick={t("common.confirmTick")} button={t("bookings.delete")} fields={{ id: booking.id }} />
        </section>
      )}
    </>
  );
}
