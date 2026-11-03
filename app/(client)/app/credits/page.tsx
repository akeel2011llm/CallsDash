import { systemText } from "@/lib/system-text";
import { requireClient } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fill, fmtDate, fmtDateTime, fmtNum } from "@/lib/format";
import { getConversations, getLedger, getTopUpRequests, getWallet, usageByChannel } from "@/lib/data";
import { clientForecast } from "@/lib/usage-insights";
import { requestTopUpAction } from "@/lib/actions";
import { cancelTopUpRequestAction } from "@/lib/billing-actions";
import { loadBillingSettings } from "@/lib/billing-server";
import { expiring, renewals } from "@/lib/billing-status";
import { activePlans } from "@/lib/credits";
import { Badge, Notice, PageHead, Stat } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { TopUpPicker } from "@/components/TopUpPicker";

export default async function CreditsPage({ searchParams }: { searchParams: Promise<{ requested?: string; cancelled?: string }> }) {
  const { tenant } = await requireClient();
  const { requested, cancelled } = await searchParams;
  const { t, locale } = await getT(tenant);
  const [w, billing, openRequests] = await Promise.all([getWallet(tenant.id), loadBillingSettings(), getTopUpRequests()]);
  const mine = openRequests.filter((r) => r.tenantId === tenant.id);
  const ren = renewals(tenant.plans, new Date());
  const soon = expiring(w.batches, new Date(), billing.daysBefore);
  const rate = activePlans(tenant.plans)[0]?.pricePerCreditBhd ?? 0;
  const help = locale === "ar" ? billing.paymentHelpAr || billing.paymentHelp : billing.paymentHelp || billing.paymentHelpAr;
  const whenText = (d: number) => (d === 0 ? t("bc.c.today") : fill(t("bc.c.inDays"), { n: fmtNum(Math.abs(d), locale, 0) }));
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const usage = await usageByChannel(tenant.id, monthStart);
  const total = Object.values(usage).reduce((a, b) => a + b, 0) || 1;
  // how long the credits last at the last 14 days' pace (the admin sees the same figure on Platform settings)
  const now = Date.now();
  const fc = clientForecast({ tenantId: tenant.id, name: tenant.name, conversations: (await getConversations(tenant.id)).filter((c) => now - Date.parse(c.startedAt) <= 62 * 86_400_000), walletBalance: w.balance, revenuePerCredit: 0, real: {} }, now);
  return (
    <>
      <PageHead title={t("credits.title")} />
      {requested && <Notice tone="ok">{t("credits.requested")}</Notice>}
      {cancelled && <Notice tone="ok">{t("cp.cancelled")}</Notice>}
      <div className="grid">
        <Stat label={t("credits.balance")} value={fmtNum(w.balance, locale, 1)} tone={w.low ? "warn" : undefined} hint={t("credits.explain")} />
      </div>
      <section className={`card acct-balance ${fc.wallet.daysLeft !== undefined && fc.wallet.daysLeft < 14 ? "warn" : "ok"}`}>
        <h2>{t("acct.mine.title")}</h2>
        <p className="acct-verdict">{fc.wallet.daysLeft !== undefined && fc.wallet.daysLeft > 365 ? t("acct.mine.overYear") : fc.wallet.runsOutAt ? fill(t("acct.mine.lasts"), { date: fmtDate(new Date(fc.wallet.runsOutAt).toISOString(), locale), days: fmtNum(fc.wallet.daysLeft ?? 0, locale, 0) }) : t("acct.mine.none")}</p>
        <p className="muted acct-line">{fill(t("acct.mine.month"), { min: fmtNum(fc.mtd.minutes, locale, 0), msg: fmtNum(fc.mtd.messages, locale, 0) })}</p>
      </section>
      <section className="card stack">
        <h2>{t("cp.package.title")}</h2>
        {ren.length === 0 ? <p className="muted">{t("cp.package.payg")}</p> : (
          <ul className="bc-plans">
            {ren.map((r) => (
              <li key={r.planId} className={r.daysLeft < 0 ? "late" : r.daysLeft <= billing.daysBefore ? "soon" : undefined}>
                <strong>{r.name}</strong>
                <small className="muted">{fmtNum(r.includedCredits, locale, 0)} {t("packages.creditsWord")} · BHD {fmtNum(r.monthlyPriceBhd, locale, 3)} {t("packages.perMonth")}{r.contractRef ? ` · ${fill(t("bc.c.contract"), { ref: r.contractRef })}` : ""}</small>
                <span>{r.daysLeft < 0 ? fill(t("cp.package.overdue"), { date: fmtDate(r.renewsAt, locale) }) : fill(t("cp.package.renews"), { date: fmtDate(r.renewsAt, locale), when: whenText(r.daysLeft) })}</span>
              </li>
            ))}
          </ul>
        )}
        {soon.map((e) => <small key={e.batchId} className="muted">{fill(t("cp.expiring"), { n: fmtNum(e.remaining, locale, 0), date: fmtDate(e.expiresAt, locale), when: whenText(e.daysLeft) })}</small>)}
      </section>
      {tenant.plans.filter((p) => p.active).length > 1 && (
        <section className="card stack">
          <h2>{t("credits.plans")}</h2>
          <ul>
            {tenant.plans.filter((p) => p.active).map((p) => (
              <li key={p.id}>
                <strong>{p.name}</strong>
                {p.type === "package" ? `: ${fmtNum(p.includedCredits, locale, 0)} ${t("packages.creditsWord")}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="grid two">
        <section className="card stack">
          <h2>{t("credits.batches")}</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t("common.kind")}</th><th>{t("common.remaining")}</th><th>{t("common.expires")}</th></tr></thead>
              <tbody>
                {w.batches.filter((b) => b.remaining > 0 && new Date(b.expiresAt) > new Date()).sort((a, b) => a.expiresAt.localeCompare(b.expiresAt)).map((b) => (
                  <tr key={b.id}>
                    <td>{t(`kind.${b.kind}` as "kind.topup")}{b.note && (b.kind === "package" || b.kind === "rollover") ? <><br /><small className="muted">{systemText(b.note, t as (k: string, v?: Record<string, string | number>) => string)}</small></> : null}</td>
                    <td>{fmtNum(b.remaining, locale, 1)} / {fmtNum(b.amount, locale, 0)}</td>
                    <td>{fmtDate(b.expiresAt, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>{t("cp.pay.title")}</h3>
          <form action={requestTopUpAction} className="stack">
            <input type="hidden" name="returnTo" value="/app/credits" />
            <TopUpPicker amounts={billing.amounts} rate={rate} locale={locale} labels={{ pick: t("cp.pay.pick"), custom: t("cp.pay.custom"), total: t("cp.pay.total"), send: t("cp.pay.send"), credits: t("common.credits") }} />
          </form>
          {help && <div className="stack"><strong>{t("cp.pay.how")}</strong><p style={{ whiteSpace: "pre-line", margin: 0 }}>{help}</p></div>}
          <small className="muted">{t("cp.pay.after")}</small>
          {mine.length > 0 && (
            <div className="stack">
              <strong>{t("cp.pending.title")}</strong>
              {mine.map((r) => (
                <form key={r.id} action={cancelTopUpRequestAction} className="row" style={{ justifyContent: "space-between" }}>
                  <input type="hidden" name="requestId" value={r.id} /><input type="hidden" name="returnTo" value="/app/credits" />
                  <span>{fill(t("cp.pending.line"), { n: fmtNum(r.credits, locale, 0), date: fmtDate(r.at, locale) })}</span>
                  <SubmitButton className="btn small ghost" type="submit">{t("cp.cancel")}</SubmitButton>
                </form>
              ))}
            </div>
          )}
        </section>
        <section className="card stack">
          <h2>{t("credits.usage")}</h2>
          {(Object.entries(usage) as [keyof typeof usage, number][]).map(([ch, v]) => (
            <div key={ch}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span>{t(`channel.${ch}` as "channel.website")}</span><span>{fmtNum(v, locale, 1)}</span>
              </div>
              <div className="bar"><span style={{ width: `${(v / total) * 100}%` }} /></div>
            </div>
          ))}
        </section>
      </div>
      <section className="card stack">
        <h2>{t("credits.history")}</h2>
        <div className="table-wrap">
          <table>
            <tbody>
              {(await getLedger(tenant.id)).slice(0, 15).map((l) => (
                <tr key={l.id}>
                  <td>{fmtDateTime(l.at, locale)}</td>
                  <td><Badge>{t(`ledger.${l.kind}` as "ledger.topup")}</Badge></td>
                  <td>{l.credits > 0 ? "+" : ""}{fmtNum(l.credits, locale, 2)}</td>
                  <td className="muted">{l.channel ? t(`channel.${l.channel}` as "channel.website") : systemText(l.note, t as (k: string, v?: Record<string, string | number>) => string)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
