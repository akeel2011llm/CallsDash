import Link from "next/link";
import { getT } from "@/lib/i18n";
import { dayKey, fmtDateTime } from "@/lib/format";
import { getBookings, getDoctors } from "@/lib/data";
import { setBookingStatusAction } from "@/lib/actions";
import { isBookingError } from "@/lib/booking-ui";
import { asciiDigits } from "@/lib/cpr";
import { bookingRef } from "@/lib/booking-ref";
import { Badge, Notice, PageHead, Stat } from "@/components/ui";
import type { Tenant } from "@/lib/types";
import { SubmitButton } from "@/components/SubmitButton";

const VIEWS = ["upcoming", "today", "past", "all"] as const;
type View = (typeof VIEWS)[number];
const tone = (s: string) => (s === "confirmed" || s === "completed" ? "ok" : s === "cancelled" ? "bad" : s === "no_show" ? "warn" : "info");
const live = (s: string) => s === "confirmed" || s === "rescheduled";

export interface BookingScope { base: "/app" | "/doctor"; tenant: Tenant; /** Set for a doctor: they only ever see their own bookings. */ doctorId?: string }

export async function BookingList({ base, tenant, doctorId, sp }: BookingScope & { sp: { doctor?: string; status?: string; view?: string; q?: string; err?: string; deleted?: string } }) {
  const { t, locale } = await getT(tenant);
  const view: View = (VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as View) : "upcoming";
  const doctors = await getDoctors(tenant.id);
  const docName = new Map(doctors.map((d) => [d.id, d.name]));
  const all = (await getBookings(tenant.id)).filter((b) => !doctorId || b.doctorId === doctorId);
  const today = dayKey(new Date().toISOString());
  const nowMs = Date.now();
  const q = (sp.q ?? "").trim().toLowerCase();
  const qDigits = asciiDigits(q).replace(/\D/g, "");
  const inView = (b: (typeof all)[number]) =>
    view === "all" ? true : view === "today" ? dayKey(b.startsAt) === today : view === "past" ? Date.parse(b.startsAt) < nowMs : dayKey(b.startsAt) >= today;
  const rows = all
    .filter((b) => inView(b) && (!sp.doctor || b.doctorId === sp.doctor) && (!sp.status || b.status === sp.status)
      && (!q || b.patientName.toLowerCase().includes(q) || (qDigits.length >= 3 && (b.patientPhone.replace(/\D/g, "").includes(qDigits) || (b.patientCpr ?? "").includes(qDigits)))
        || (q.length >= 4 && bookingRef(b.id).toLowerCase().includes(q.replace(/\s+/g, "")))))
    .sort((a, b) => (view === "past" || view === "all" ? b.startsAt.localeCompare(a.startsAt) : a.startsAt.localeCompare(b.startsAt)));
  const todayLive = all.filter((b) => dayKey(b.startsAt) === today && live(b.status)).length;
  const upcomingLive = all.filter((b) => live(b.status) && Date.parse(b.startsAt) >= nowMs).length;
  const noShows = all.filter((b) => b.status === "no_show" && Date.parse(b.startsAt) > nowMs - 30 * 86_400_000).length;
  const keep = (extra: Record<string, string>) => {
    const p = new URLSearchParams(Object.entries({ doctor: sp.doctor, status: sp.status, q: sp.q, view, ...extra }).filter(([, v]) => v) as [string, string][]);
    return `${base}/bookings?${p}`;
  };
  const returnTo = keep({});
  return (
    <>
      <PageHead title={t("bookings.title")} actions={<><Link className="btn" href={`${base}/bookings/new`}>{t("bookings.new")}</Link>{base === "/app" && <><a className="btn ghost" href="/app/bookings/export">{t("sheet.csv")}</a><a className="btn ghost" href="/app/bookings/export?format=xlsx">{t("sheet.xlsx")}</a></>}</>} />
      {isBookingError(sp.err) && <Notice tone="warn">{t(`bookings.err.${sp.err}` as "bookings.err.slot_taken")}</Notice>}
      {sp.deleted && <Notice tone="ok">{t("bookings.deleted")}</Notice>}
      <div className="grid">
        <Stat label={t("bookings.todayCount")} value={todayLive} />
        <Stat label={t("home.bookings")} value={upcomingLive} />
        <Stat label={t("bookings.noShows30")} value={noShows} />
      </div>
      <div className="row">
        {VIEWS.map((v) => <Link key={v} className={`btn small ${v === view ? "" : "ghost"}`} href={keep({ view: v })}>{t(`bookings.view.${v}` as "bookings.view.all")}</Link>)}
      </div>
      <form className="filters card" method="get">
        <input type="hidden" name="view" value={view} />
        <label>{t("common.search")}<input name="q" defaultValue={sp.q ?? ""} placeholder={t("bookings.searchPlaceholder")} /></label>
        {!doctorId && (
          <label>{t("common.doctor")}
            <select name="doctor" defaultValue={sp.doctor ?? ""}>
              <option value="">{t("common.all")}</option>
              {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
        )}
        <label>{t("common.status")}
          <select name="status" defaultValue={sp.status ?? ""}>
            <option value="">{t("common.all")}</option>
            {(["confirmed", "rescheduled", "completed", "cancelled", "no_show"] as const).map((s) => <option key={s} value={s}>{t(`booking.${s}` as "booking.confirmed")}</option>)}
          </select>
        </label>
        <SubmitButton className="btn" type="submit">{t("common.apply")}</SubmitButton>
      </form>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>{t("common.date")}</th><th>{t("common.patient")}</th>{!doctorId && <th>{t("common.doctor")}</th>}<th>{t("common.service")}</th><th>{t("common.status")}</th><th /></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={doctorId ? 5 : 6} className="muted">{t("common.none")}</td></tr>}
            {rows.map((b) => (
              <tr key={b.id}>
                <td><Link href={`${base}/bookings/${b.id}`}>{fmtDateTime(b.startsAt, locale)}</Link></td>
                <td>{b.patientName}<br /><small className="muted" dir="ltr">{b.patientPhone}{b.patientCpr ? ` · ${t("bookings.cprShort")} ${b.patientCpr}` : ""}</small></td>
                {!doctorId && <td>{docName.get(b.doctorId)}</td>}
                <td>{b.service}</td>
                <td><Badge tone={tone(b.status)}>{t(`booking.${b.status}` as "booking.confirmed")}</Badge></td>
                <td>
                  <div className="row">
                    <Link className="btn small ghost" href={`${base}/bookings/${b.id}`}>{t("bookings.open")}</Link>
                    {live(b.status) && (
                      <form action={setBookingStatusAction}>
                        <input type="hidden" name="id" value={b.id} /><input type="hidden" name="status" value="cancelled" /><input type="hidden" name="returnTo" value={returnTo} />
                        <SubmitButton className="btn small danger">{t("bookings.cancel")}</SubmitButton>
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
