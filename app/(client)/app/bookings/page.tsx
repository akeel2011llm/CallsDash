import Link from "next/link";
import { requireClient } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDateTime } from "@/lib/format";
import { getBookings, getDoctors } from "@/lib/store";
import { setBookingStatusAction } from "@/lib/actions";
import { Badge, PageHead } from "@/components/ui";

export default async function BookingsPage({ searchParams }: { searchParams: Promise<{ doctor?: string; status?: string }> }) {
  const { tenant } = await requireClient();
  const sp = await searchParams;
  const { t, locale } = await getT();
  const doctors = getDoctors(tenant.id);
  const docName = new Map(doctors.map((d) => [d.id, d.name]));
  const rows = getBookings(tenant.id).filter((b) => (!sp.doctor || b.doctorId === sp.doctor) && (!sp.status || b.status === sp.status)).reverse();
  const returnTo = "/app/bookings" + (sp.doctor || sp.status ? `?${new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][])}` : "");
  return (
    <>
      <PageHead title={t("bookings.title")} actions={<Link className="btn ghost" href="/app/calendar">{t("nav.calendar")}</Link>} />
      <form className="filters card" method="get">
        <label>{t("common.doctor")}
          <select name="doctor" defaultValue={sp.doctor ?? ""}>
            <option value="">{t("common.all")}</option>
            {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label>{t("common.status")}
          <select name="status" defaultValue={sp.status ?? ""}>
            <option value="">{t("common.all")}</option>
            {(["confirmed", "rescheduled", "cancelled", "no_show"] as const).map((s) => <option key={s} value={s}>{t(`booking.${s}` as "booking.confirmed")}</option>)}
          </select>
        </label>
        <button className="btn" type="submit">{t("common.apply")}</button>
      </form>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>{t("common.date")}</th><th>{t("common.patient")}</th><th>{t("common.doctor")}</th><th>{t("common.service")}</th><th>{t("common.status")}</th><th /></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="muted">{t("common.none")}</td></tr>}
            {rows.map((b) => (
              <tr key={b.id}>
                <td>{fmtDateTime(b.startsAt, locale)}</td>
                <td>{b.patientName}<br /><small className="muted" dir="ltr">{b.patientPhone}</small></td>
                <td>{docName.get(b.doctorId)}</td>
                <td>{b.service}</td>
                <td><Badge tone={b.status === "confirmed" ? "ok" : b.status === "cancelled" ? "bad" : b.status === "no_show" ? "warn" : "info"}>{t(`booking.${b.status}` as "booking.confirmed")}</Badge></td>
                <td>
                  <div className="row">
                  {b.status !== "cancelled" && (
                    <form action={setBookingStatusAction}>
                      <input type="hidden" name="id" value={b.id} /><input type="hidden" name="status" value="cancelled" /><input type="hidden" name="returnTo" value={returnTo} />
                      <button className="btn small danger">{t("bookings.cancel")}</button>
                    </form>
                  )}
                  {b.status === "confirmed" && new Date(b.startsAt) < new Date() && (
                    <form action={setBookingStatusAction}>
                      <input type="hidden" name="id" value={b.id} /><input type="hidden" name="status" value="no_show" /><input type="hidden" name="returnTo" value={returnTo} />
                      <button className="btn small ghost">{t("bookings.markNoShow")}</button>
                    </form>
                  )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
