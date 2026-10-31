import type { Key } from "@/lib/i18n";
import { fmtDate } from "@/lib/format";
import type { Booking, Doctor, Locale, Profile, Tenant } from "@/lib/types";
import {
  addDoctorAction, addTimeOffAction, removeDoctorAction, removeTimeOffAction, saveDoctorAction, saveDoctorHoursAction, testDoctorCalendarAction,
} from "@/lib/manage-actions";
import { todayKey } from "@/lib/booking-ui";
import { roleName, roleOf, rolesOf } from "@/lib/business-types";
import { Badge, Notice } from "./ui";
import { SubmitButton } from "./SubmitButton";
import { HoursFields } from "./HoursFields";
import { ConfirmDelete } from "./Confirm";

export type DoctorNotice = { doc?: string; cal?: string; clash?: string; role?: string };
const DOC_NOTICES = ["added", "saved", "removed", "name_missing", "name_taken", "hours_invalid", "dates_invalid", "confirm", "has_bookings", "has_login"];
const CAL_RESULTS = ["ok", "no_id", "no_key", "key_rejected", "not_shared", "timeout", "other"];

/**
 * Everything about the clinic's doctors in one place: details, Google Calendar, own working hours, leave, and removal.
 * Used on the admin client page and on the clinic manager's Doctors page.
 */
export function DoctorsManager({ tenant, doctors, bookings, logins, returnTo, sp, t, locale }: {
  tenant: Tenant; doctors: Doctor[]; bookings: Booking[]; logins: Profile[]; returnTo: string; sp: DoctorNotice; t: (k: Key) => string; locale: Locale;
}) {
  const hidden = (
    <><input type="hidden" name="tenantId" value={tenant.id} /><input type="hidden" name="returnTo" value={returnTo} /></>
  );
  const [calDoctor, calOutcome] = (sp.cal ?? "").split(":");
  const notice = sp.doc && DOC_NOTICES.includes(sp.doc) ? sp.doc : null;
  const good = notice === "added" || notice === "saved" || notice === "removed";
  const clash = Number(sp.clash) || 0;
  const now = Date.now();
  const today = todayKey();
  // roles (Doctor, Nurse, Stylist...): a picker and a filter appear once the client has more than one
  const roles = rolesOf(tenant);
  const many = roles.length > 1;
  const filter = many && roles.some((r) => r.key === sp.role) ? sp.role : "";
  const shown = filter ? doctors.filter((d) => roleOf(roles, d.role).key === filter) : doctors;
  const base = returnTo.split(/[?#]/)[0];
  const rolePick = (cur?: string) => many ? (
    <label style={{ flex: 1, minWidth: 140 }}>{t("team.role")}
      <select name="role" defaultValue={roleOf(roles, cur).key}>{roles.map((r) => <option key={r.key} value={r.key}>{roleName(r, locale)}</option>)}</select>
    </label>
  ) : null;
  return (
    <section className="card stack" id="doctors">
      <h2>{t("doctors.title")}</h2>
      <small className="muted">{t("doctors.help")}</small>
      {notice && <Notice tone={good ? "ok" : "warn"}>{t(`doctors.n.${notice}` as Key)}</Notice>}
      {clash > 0 && <Notice tone="warn">{t("doctors.clash").replace("{n}", String(clash))}</Notice>}
      {doctors.length === 0 && <small className="muted">{t("admin.doctor.none")}</small>}
      {many && doctors.length > 0 && (
        <nav className="row" aria-label={t("team.role")}>
          <a className={filter ? "btn small ghost" : "btn small"} href={`${base}#doctors`} aria-current={filter ? undefined : "true"}>{t("team.allRoles")} ({doctors.length})</a>
          {roles.map((r) => {
            const n = doctors.filter((d) => roleOf(roles, d.role).key === r.key).length;
            return <a key={r.key} className={filter === r.key ? "btn small" : "btn small ghost"} href={`${base}?role=${r.key}#doctors`} aria-current={filter === r.key ? "true" : undefined}>{roleName(r, locale, true)} ({n})</a>;
          })}
        </nav>
      )}
      {shown.map((d) => {
        const upcoming = bookings.filter((b) => b.doctorId === d.id && (b.status === "confirmed" || b.status === "rescheduled") && Date.parse(b.startsAt) > now).length;
        const login = logins.find((p) => p.role === "doctor" && p.doctorId === d.id);
        const leave = (d.timeOff ?? []).filter((r) => r.to >= today);
        const active = d.active !== false;
        const doctorHidden = <>{hidden}<input type="hidden" name="doctorId" value={d.id} /></>;
        return (
          <article key={d.id} id={`doctor-${d.id}`} className="card stack" style={{ borderInlineStart: `4px solid ${d.color}`, opacity: active ? 1 : 0.75 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="row" style={{ flexWrap: "nowrap", gap: ".5rem" }}>
                {d.photoAt
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={`/api/data/photo/doctor/${d.id}?v=${Date.parse(d.photoAt) || 0}&t=${tenant.id}`} alt="" width={36} height={36} loading="lazy" style={{ objectFit: "cover", borderRadius: "50%" }} />
                  : null}
                <span><strong>{d.name}</strong>{many ? <span className="muted"> · {roleName(roleOf(roles, d.role), locale)}</span> : null}{d.specialty ? <span className="muted"> · {d.specialty}</span> : null}</span>
              </span>
              <span className="row">
                <Badge tone={active ? "ok" : "neutral"}>{active ? t("doctors.active") : t("doctors.inactive")}</Badge>
                <Badge tone={d.googleCalendarId ? "ok" : "warn"}>{d.googleCalendarId ? t("doctors.calLinked") : t("doctors.calMissing")}</Badge>
                <Badge>{d.hours ? t("doctors.ownHours") : t("doctors.clinicHours")}</Badge>
                {leave.length > 0 && <Badge tone="info">{t("doctors.onLeave").replace("{n}", String(leave.length))}</Badge>}
                <Badge>{t("doctors.upcoming").replace("{n}", String(upcoming))}</Badge>
                {login && <Badge tone="info">{t("doctors.hasLogin")}</Badge>}
              </span>
            </div>

            <details open={calDoctor === d.id}>
              <summary style={{ cursor: "pointer" }}>{t("doctors.edit")}</summary>
              <form action={saveDoctorAction} className="stack" style={{ marginBlockStart: ".6rem" }}>
                {doctorHidden}
                <div className="row">
                  <label style={{ flex: 2, minWidth: 180 }}>{t("admin.doctor.name")}<input name="name" required maxLength={120} defaultValue={d.name} /></label>
                  {rolePick(d.role)}
                  <label style={{ flex: 2, minWidth: 160 }}>{t("admin.doctor.specialty")}<input name="specialty" maxLength={120} defaultValue={d.specialty} /></label>
                  <label style={{ flex: 0 }}>{t("doctors.color")}<input type="color" name="color" defaultValue={d.color} /></label>
                </div>
                <label>{t("admin.doctor.about")}<textarea name="about" rows={3} maxLength={800} defaultValue={d.about ?? ""} /></label>
                <label>{t("admin.doctor.aboutAr")}<textarea name="aboutAr" rows={3} maxLength={800} dir="rtl" defaultValue={d.aboutAr ?? ""} /></label>
                <small className="muted">{t("admin.doctor.about.help")}</small>
                <label>{t("doctors.calendarId")}
                  <input name="calendarId" defaultValue={d.googleCalendarId ?? ""} placeholder="clinic@group.calendar.google.com" dir="ltr" />
                </label>
                <small className="muted">{t("admin.doctors.help")}</small>
                <label className="inline"><input type="checkbox" name="active" defaultChecked={active} />{t("doctors.takesBookings")}</label>
                <small className="muted">{t("doctors.takesBookings.help")}</small>
                <div className="row">
                  <SubmitButton className="btn small" type="submit">{t("common.save")}</SubmitButton>
                  <SubmitButton className="btn small ghost" type="submit" formAction={testDoctorCalendarAction}>{t("admin.cal.test")}</SubmitButton>
                  {calDoctor === d.id && CAL_RESULTS.includes(calOutcome) && (
                    <Badge tone={calOutcome === "ok" ? "ok" : "warn"}>{t(`admin.cal.${calOutcome}` as Key)}</Badge>
                  )}
                </div>
              </form>
            </details>

            <details>
              <summary style={{ cursor: "pointer" }}>{t("doctors.hours")}</summary>
              <form action={saveDoctorHoursAction} className="stack" style={{ marginBlockStart: ".6rem" }}>
                {doctorHidden}
                <label className="inline"><input type="radio" name="mode" value="clinic" defaultChecked={!d.hours} />{t("doctors.hours.clinic")}</label>
                <label className="inline"><input type="radio" name="mode" value="own" defaultChecked={Boolean(d.hours)} />{t("doctors.hours.own")}</label>
                <HoursFields hours={d.hours ?? tenant.openingHours} t={t} />
                <small className="muted">{t("doctors.hours.help")}</small>
                <div><SubmitButton className="btn small" type="submit">{t("common.save")}</SubmitButton></div>
              </form>
            </details>

            <details>
              <summary style={{ cursor: "pointer" }}>{t("doctors.leave")}{leave.length ? ` (${leave.length})` : ""}</summary>
              <div className="stack" style={{ marginBlockStart: ".6rem" }}>
                {leave.length === 0 && <small className="muted">{t("doctors.leave.none")}</small>}
                {leave.map((r) => (
                  <form key={`${r.from}-${r.to}`} action={removeTimeOffAction} className="row">
                    {doctorHidden}<input type="hidden" name="from" value={r.from} /><input type="hidden" name="to" value={r.to} />
                    <span>{fmtDate(`${r.from}T12:00:00Z`, locale)}{r.to !== r.from ? ` – ${fmtDate(`${r.to}T12:00:00Z`, locale)}` : ""}{r.note ? <span className="muted"> · {r.note}</span> : null}</span>
                    <SubmitButton className="btn small ghost" type="submit">{t("common.remove")}</SubmitButton>
                  </form>
                ))}
                <form action={addTimeOffAction} className="row" style={{ alignItems: "end" }}>
                  {doctorHidden}
                  <label>{t("doctors.leave.from")}<input type="date" name="from" min={today} required /></label>
                  <label>{t("doctors.leave.to")}<input type="date" name="to" min={today} /></label>
                  <label style={{ flex: 1, minWidth: 160 }}>{t("doctors.leave.note")}<input name="note" maxLength={120} placeholder={t("doctors.leave.notePh")} /></label>
                  <SubmitButton className="btn small" type="submit">{t("common.add")}</SubmitButton>
                </form>
                <small className="muted">{t("doctors.leave.help")}</small>
              </div>
            </details>

            <ConfirmDelete action={removeDoctorAction} summary={t("doctors.remove")}
              warning={upcoming > 0 ? t("doctors.remove.blocked").replace("{n}", String(upcoming)) : login ? t("doctors.n.has_login") : t("doctors.remove.warn")}
              tick={t("common.confirmTick")} button={t("doctors.remove")}
              fields={{ tenantId: tenant.id, returnTo, doctorId: d.id }} />
          </article>
        );
      })}
      <form action={addDoctorAction} className="row" style={{ alignItems: "end" }}>
        {hidden}
        <label style={{ flex: 2, minWidth: 180 }}>{t("admin.doctor.name")}<input name="name" required maxLength={120} /></label>
        {rolePick(filter || undefined)}
        <label style={{ flex: 2, minWidth: 160 }}>{t("admin.doctor.specialty")}<input name="specialty" maxLength={120} /></label>
        <label style={{ flex: "1 1 100%" }}>{t("admin.doctor.about")}<textarea name="about" rows={2} maxLength={800} /></label>
        <SubmitButton className="btn small" type="submit">{t("admin.doctor.add")}</SubmitButton>
      </form>
    </section>
  );
}
