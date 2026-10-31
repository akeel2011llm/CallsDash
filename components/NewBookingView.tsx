import Link from "next/link";
import { getT } from "@/lib/i18n";
import { fmtTime } from "@/lib/format";
import { getDoctors } from "@/lib/data";
import { bookingService } from "@/lib/booking-service";
import { daySlots, isBookingError, todayKey } from "@/lib/booking-ui";
import { createBookingAction } from "@/lib/actions";
import { Notice, PageHead } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { confirmationOptions } from "@/lib/whatsapp";
import type { BookingScope } from "@/components/BookingList";

export type NewBookingParams = { doctor?: string; date?: string; err?: string; name?: string; phone?: string; service?: string };

export async function NewBookingView({ base, tenant, doctorId, sp }: BookingScope & { sp: NewBookingParams }) {
  const { t, locale } = await getT(tenant);
  const doctors = await getDoctors(tenant.id);
  const doctor = doctors.find((d) => d.id === (doctorId ?? sp.doctor));
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : todayKey();
  const picked = doctor ? await daySlots(await bookingService(), tenant.id, doctor.id, date) : null;
  const wa = confirmationOptions(tenant);
  return (
    <>
      <PageHead title={t("bookings.new")} actions={<Link className="btn ghost" href={`${base}/bookings`}>{t("common.back")}</Link>} />
      {isBookingError(sp.err) && <Notice tone="warn">{t(`bookings.err.${sp.err}` as "bookings.err.slot_taken")}</Notice>}
      {doctors.length === 0 && <Notice tone="warn">{t("bookings.noDoctors")}</Notice>}
      <form className="filters card" method="get">
        {doctorId ? <input type="hidden" name="doctor" value={doctorId} /> : (
          <label>{t("common.doctor")}
            <select name="doctor" defaultValue={doctor?.id ?? ""} required>
              <option value="" disabled>{t("bookings.pickDoctor")}</option>
              {doctors.filter((d) => d.active !== false).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
        )}
        <label>{t("common.date")}<input type="date" name="date" defaultValue={date} min={todayKey()} required /></label>
        <SubmitButton className="btn" type="submit">{t("bookings.showTimes")}</SubmitButton>
      </form>
      {doctor && picked && (
        picked.error ? <Notice tone="warn">{t(`bookings.err.${isBookingError(picked.error) ? picked.error : "bad_date"}` as "bookings.err.slot_taken")}</Notice>
        : picked.slots.length === 0 ? <Notice>{t("bookings.noTimes")}</Notice>
        : (
          <form action={createBookingAction} className="card stack">
            <input type="hidden" name="doctorId" value={doctor.id} /><input type="hidden" name="date" value={date} />
            <label>{t("bookings.time")}
              <select name="startsAt" required>
                {picked.slots.map((s) => <option key={s} value={s}>{fmtTime(s, locale)}</option>)}
              </select>
            </label>
            <label>{t("bookings.patientName")}<input name="patientName" required maxLength={120} defaultValue={sp.name ?? ""} /></label>
            <label>{t("bookings.patientPhone")}<input name="patientPhone" required maxLength={30} inputMode="tel" dir="ltr" placeholder="+973 3xxx xxxx" defaultValue={sp.phone ?? ""} /></label>
            <label>{t("bookings.patientCpr")}<input name="patientCpr" maxLength={12} inputMode="numeric" autoComplete="off" dir="ltr" placeholder="850123456" /></label>
            <small className="muted">{t("bookings.cprHelp")}</small>
            <label>{t("common.service")}<input name="service" maxLength={120} placeholder={t("bookings.servicePlaceholder")} defaultValue={sp.service ?? ""} /></label>
            <label>{t("bookings.notes")}<textarea name="notes" rows={3} maxLength={1000} /></label>
            <small className="muted">{t("bookings.remindersNote")}</small>
            {wa.active && (
              <div className="stack" style={{ gap: ".4rem" }}>
                <label className="inline"><input type="checkbox" name="whatsapp" defaultChecked />{t("bookings.wa.send")}</label>
                {wa.languages.length > 1 ? (
                  <label>{t("bookings.wa.lang")}
                    <select name="language" defaultValue={wa.main}>{wa.languages.map((l) => <option key={l} value={l}>{l === "ar" ? "العربية" : "English"}</option>)}</select>
                  </label>
                ) : <input type="hidden" name="language" value={wa.main} />}
                <small className="muted">{t("bookings.wa.help")}</small>
              </div>
            )}
            <div><SubmitButton className="btn" type="submit">{t("bookings.create")}</SubmitButton></div>
          </form>
        )
      )}
    </>
  );
}
