import Link from "next/link";
import { getT, type Key } from "@/lib/i18n";
import { fill, fmtDate, fmtDateTime, fmtNum } from "@/lib/format";
import { adminRenewAction } from "@/lib/actions";
import { billingTopUpAction, runRemindersNowAction, saveBillingSettingsAction, saveClientBillingAction, testEmailAction } from "@/lib/billing-actions";
import { loadBillingOverview, type ClientBillingRow } from "@/lib/billing-server";
import { mailConfigured } from "@/lib/mailer";
import { Badge, Empty, Notice, PageHead, Stat } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { Fold } from "@/components/Fold";
import type { Locale } from "@/lib/types";

type T = (k: Key) => string;
type SP = { saved?: string; error?: string; topped?: string; ran?: string; mail?: string; mailProblem?: string };

const when = (days: number, t: T, l: Locale) => (days === 0 ? t("bc.c.today") : fill(t("bc.c.inDays"), { n: fmtNum(days, l, 0) }));

/** Billing > Clients: every client's packages, contract, balance and renewal, with reminders and manual top-ups. */
export default async function BillingClients({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { t, locale } = await getT();
  const { settings, rows, lastRun } = await loadBillingOverview();
  const renewSoon = rows.filter((r) => r.renewals.some((x) => x.daysLeft <= settings.daysBefore)).length;
  const mail = mailConfigured();
  const ran = sp.ran?.split("-");
  return (
    <>
      <PageHead title={t("bc.title")} subtitle={t("bc.help")} actions={<a className="btn ghost" href="/api/admin/billing/export">{t("bc.c.export")}</a>} />
      {sp.saved === "settings" && <Notice tone="ok">{t("bc.s.saved")}</Notice>}
      {sp.saved === "client" && <Notice tone="ok">{t("bc.c.saved")}</Notice>}
      {sp.topped && <Notice tone="ok">{t("bc.c.topped")}</Notice>}
      {sp.error && <Notice tone="warn">{t(`bc.s.err.${sp.error === "emails" ? "emails" : sp.error === "credits" ? "credits" : "days"}` as Key)}</Notice>}
      <div className="grid">
        <Stat label={t("bc.stat.clients")} value={rows.length} />
        <Stat label={t("bc.stat.monthly")} value={fmtNum(rows.reduce((s, r) => s + r.monthlyBhd, 0), locale, 3)} />
        <Stat label={fill(t("bc.stat.renewSoon"), { n: settings.daysBefore })} value={renewSoon} tone={renewSoon ? "warn" : undefined} />
        <Stat label={t("bc.stat.low")} value={rows.filter((r) => r.low).length} tone={rows.some((r) => r.low) ? "warn" : undefined} />
        <Stat label={t("bc.stat.requests")} value={rows.reduce((s, r) => s + r.requests, 0)} />
      </div>

      <Fold id="settings" open={Boolean(sp.saved === "settings" || sp.error || sp.ran || sp.mail)} title={t("bc.settings.title")} hint={t("bc.settings.hint")}>
        {ran && <Notice tone="ok">{fill(t("bc.s.ran"), { alerts: ran[0] ?? 0, emails: ran[1] ?? 0 })}</Notice>}
        {sp.mail && <Notice tone={sp.mail === "sent" ? "ok" : "warn"}>{fill(t(`bc.s.mail.${["sent", "no_recipient", "not_configured"].includes(sp.mail) ? sp.mail : "failed"}` as Key), { why: sp.mailProblem ?? "" })}</Notice>}
        {sp.mailProblem && !sp.mail && <Notice tone="warn">{sp.mailProblem === "not_configured" ? t("bc.s.mailMissing") : sp.mailProblem}</Notice>}
        <form action={saveBillingSettingsAction} className="stack">
          <input type="hidden" name="returnTo" value="/admin/billing/clients" />
          <label>{t("bc.s.days")}<input name="daysBefore" type="number" min={1} max={60} step={1} defaultValue={settings.daysBefore} required style={{ maxInlineSize: 140 }} /></label>
          <label className="row"><input type="checkbox" name="onScreen" defaultChecked={settings.onScreen} />{t("bc.s.onScreen")}</label>
          <label className="row"><input type="checkbox" name="email" defaultChecked={settings.email} />{t("bc.s.email")}</label>
          <label>{t("bc.s.emailTo")}<input name="emailTo" type="text" defaultValue={settings.emailTo} dir="ltr" inputMode="email" autoComplete="off" /></label>
          <small className={mail ? "muted" : undefined}>{mail ? t("bc.s.mailSet") : t("bc.s.mailMissing")}</small>
          <label>{t("bc.s.payHelp")}<textarea name="paymentHelp" rows={3} maxLength={600} defaultValue={settings.paymentHelp} placeholder={t("bc.s.payPh")} /></label>
          <label>{t("bc.s.payHelpAr")}<textarea name="paymentHelpAr" rows={3} maxLength={600} dir="rtl" defaultValue={settings.paymentHelpAr} /></label>
          <label>{t("bc.s.amounts")}<input name="amounts" type="text" defaultValue={settings.amounts.join(", ")} dir="ltr" inputMode="numeric" /></label>
          <div className="row">
            <SubmitButton className="btn" type="submit">{t("bc.s.save")}</SubmitButton>
          </div>
        </form>
        <div className="row">
          <form action={runRemindersNowAction}><input type="hidden" name="returnTo" value="/admin/billing/clients" /><SubmitButton className="btn ghost" type="submit">{t("bc.s.runNow")}</SubmitButton></form>
          <form action={testEmailAction}><input type="hidden" name="returnTo" value="/admin/billing/clients" /><SubmitButton className="btn ghost" type="submit">{t("bc.s.testEmail")}</SubmitButton></form>
        </div>
        <small className="muted">{fill(t("bc.s.lastRun"), { when: lastRun ? fmtDateTime(lastRun, locale) : t("bc.s.never") })}</small>
      </Fold>

      {rows.length === 0 ? <div className="card"><Empty>{t("bc.c.none")}</Empty></div> : (
        <div className="bc-grid">{rows.map((r) => <ClientCard key={r.tenant.id} r={r} t={t} locale={locale} defaultDays={settings.daysBefore} />)}</div>
      )}
    </>
  );
}

function ClientCard({ r, t, locale, defaultDays }: { r: ClientBillingRow; t: T; locale: Locale; defaultDays: number }) {
  const c = r.tenant;
  const name = locale === "ar" ? c.branding.displayNameAr || c.name : c.name;
  const next = r.renewals[0];
  const back = "/admin/billing/clients";
  return (
    <article className="card bc-client" id={`c-${c.id}`}>
      <header>
        <Link href={`/admin/clients/${c.id}/billing`}><strong>{name}</strong></Link>
        <span className="row">
          {r.low && <Badge tone="warn">{t("bc.c.lowBal")}</Badge>}
          {r.requests > 0 && <Badge tone="info">{fill(t("bc.c.reqs"), { n: r.requests })}</Badge>}
          {r.muted ? <Badge>{t("bc.c.muted")}</Badge> : r.due.length > 0 && <Badge tone="warn">{t("bc.c.reminderDue")}</Badge>}
        </span>
      </header>
      <dl className="bc-facts">
        <div><dt>{t("bc.c.balance")}</dt><dd>{fmtNum(r.balance, locale, 1)}</dd></div>
        <div><dt>{t("bc.c.monthly")}</dt><dd>{fmtNum(r.monthlyBhd, locale, 3)}</dd></div>
        <div><dt>{t("bc.c.next")}</dt><dd>{next ? (next.daysLeft < 0 ? `${fmtDate(next.renewsAt, locale)} !` : `${fmtDate(next.renewsAt, locale)} · ${when(next.daysLeft, t, locale)}`) : "—"}</dd></div>
      </dl>
      <ul className="bc-plans">
        {c.plans.filter((p) => p.active).length === 0 && <li className="muted">{t("bc.c.noPlan")}</li>}
        {c.plans.filter((p) => p.active).map((p) => {
          const ren = r.renewals.find((x) => x.planId === p.id);
          return (
            <li key={p.id} className={ren ? (ren.daysLeft < 0 ? "late" : ren.daysLeft <= r.daysBefore ? "soon" : undefined) : undefined}>
              <span><strong>{p.name}</strong> <Badge>{t(`packages.type.${p.type}` as Key)}</Badge></span>
              <small className="muted">
                {p.type === "package" ? `${fmtNum(p.includedCredits, locale, 0)} ${t("packages.creditsWord")} · ` : ""}BHD {fmtNum(p.monthlyPriceBhd, locale, 3)} {t("packages.perMonth")}
                {p.contractRef ? ` · ${fill(t("bc.c.contract"), { ref: p.contractRef })}` : ""}
              </small>
              <small>
                {ren ? (ren.daysLeft < 0 ? fill(t("bc.c.overdue"), { date: fmtDate(ren.renewsAt, locale), n: fmtNum(-ren.daysLeft, locale, 0) }) : `${fill(t("bc.c.renews"), { date: fmtDate(ren.renewsAt, locale) })} (${when(ren.daysLeft, t, locale)})`) : t("bc.c.payg")}
              </small>
              {ren && (
                <form action={adminRenewAction}>
                  <input type="hidden" name="tenantId" value={c.id} /><input type="hidden" name="planId" value={p.id} /><input type="hidden" name="returnTo" value={`${back}#c-${c.id}`} />
                  <SubmitButton className="btn small ghost" type="submit">{t("bc.c.renewNow")}</SubmitButton>
                </form>
              )}
            </li>
          );
        })}
      </ul>
      {r.expiring.map((e) => <small key={e.batchId} className="muted">{fill(t("bc.c.expiring"), { n: fmtNum(e.remaining, locale, 0), date: fmtDate(e.expiresAt, locale) })} ({when(e.daysLeft, t, locale)})</small>)}

      <details className="bc-sub">
        <summary>{t("bc.c.topup")}</summary>
        <form action={billingTopUpAction} className="stack">
          <input type="hidden" name="tenantId" value={c.id} /><input type="hidden" name="returnTo" value={back} />
          <small className="muted">{t("bc.c.topHelp")}</small>
          <div className="row">
            <label style={{ flex: 1 }}>{t("bc.c.credits")}<input name="credits" type="number" min={1} step={1} defaultValue={500} required /></label>
            <label style={{ flex: 1 }}>{t("bc.c.method")}
              <select name="method" defaultValue="bank">{(["bank", "benefit", "cash", "card", "other"] as const).map((m) => <option key={m} value={m}>{t(`bc.c.method.${m}` as Key)}</option>)}</select>
            </label>
          </div>
          <label>{t("bc.c.reference")}<input name="reference" maxLength={80} /></label>
          <div><SubmitButton className="btn" type="submit">{t("bc.c.add")}</SubmitButton></div>
        </form>
      </details>
      <details className="bc-sub">
        <summary>{t("bc.c.own")}</summary>
        <form action={saveClientBillingAction} className="stack">
          <input type="hidden" name="tenantId" value={c.id} /><input type="hidden" name="returnTo" value={back} />
          <label>{fill(t("bc.c.ownDays"), { n: defaultDays })}<input name="daysBefore" type="number" min={1} max={60} step={1} defaultValue={r.ownDays ?? ""} style={{ maxInlineSize: 140 }} /></label>
          <label>{t("bc.c.ownEmail")}<input name="emailTo" type="text" defaultValue={r.emailTo} dir="ltr" inputMode="email" autoComplete="off" /></label>
          <label className="row"><input type="checkbox" name="muted" defaultChecked={r.muted} />{t("bc.c.mute")}</label>
          <div><SubmitButton className="btn" type="submit">{t("bc.c.save")}</SubmitButton></div>
        </form>
      </details>
      <Link className="btn small ghost" href={`/admin/clients/${c.id}/billing`} style={{ justifySelf: "start" }}>{t("bc.c.manage")}</Link>
    </article>
  );
}
