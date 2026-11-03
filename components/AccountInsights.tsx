import Link from "next/link";
import type { Key } from "@/lib/i18n";
import type { Locale } from "@/lib/types";
import { fill, fmtNum } from "@/lib/format";
import { USD_TO_BHD } from "@/lib/pricing";
import { refreshAccountAction } from "@/lib/account-actions";
import type { loadInsights } from "@/lib/account-server";
import { BURST_MINUTE_USD, EL_PLANS, EXTRA_MINUTE_USD, MESSAGE_USD, productLabel, type ClientForecast } from "@/lib/usage-insights";
import { Fold } from "./Fold";
import { SubmitButton } from "./SubmitButton";

type T = (k: Key) => string;
type Insights = Awaited<ReturnType<typeof loadInsights>>;

const DAY = 86_400_000;
const date = (ms: number, l: Locale) => new Date(ms).toLocaleDateString(l === "ar" ? "ar-BH" : "en-GB", { day: "numeric", month: "long", ...(new Date(ms).getUTCFullYear() !== new Date().getUTCFullYear() ? { year: "numeric" } : {}), timeZone: "Asia/Bahrain" });
const usd = (n: number, d = 2) => `$${n.toFixed(d)}`;
const ago = (iso: string, t: T, l: Locale) => {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return min < 1 ? t("acct.justNow") : min < 90 ? fill(t("acct.minAgo"), { n: fmtNum(min, l, 0) }) : fill(t("acct.hoursAgo"), { n: fmtNum(Math.round(min / 60), l, 0) });
};

function Refresh({ t, returnTo, small }: { t: T; returnTo: string; small?: boolean }) {
  return (
    <form action={refreshAccountAction}>
      <input type="hidden" name="returnTo" value={returnTo} />
      <SubmitButton className={`btn ${small ? "small " : ""}ghost`} type="submit">{t("acct.refresh")}</SubmitButton>
    </form>
  );
}

/** The ElevenLabs credits left, big and coloured by how urgent it is. `compact` is the admin Home version with a link to the details. */
export function BalanceCard({ ins, t, locale, returnTo, compact }: { ins: Insights; t: T; locale: Locale; returnTo: string; compact?: boolean }) {
  const b = ins.balance;
  if (!b) {
    return (
      <section className="card acct-balance" id="elevenlabs">
        <div className="acct-head"><h2>{t("acct.balance")}</h2><Refresh t={t} returnTo={returnTo} small /></div>
        <p className="muted">{ins.noKey ? t("acct.noKey") : t("acct.noData")}</p>
        {ins.snapshot?.errors.map((e) => <p key={e} className="muted small" dir="ltr">{e}</p>)}
      </section>
    );
  }
  const now = Date.now();
  return (
    <section className={`card acct-balance ${b.tone}`} id="elevenlabs">
      <div className="acct-head">
        <h2>{t("acct.balance")}</h2>
        <Refresh t={t} returnTo={returnTo} small />
      </div>
      <div className="acct-big">
        <strong>{fmtNum(b.left, locale, 0)}</strong>
        <span className="muted">{fill(t("acct.leftOf"), { total: fmtNum(b.limit, locale, 0) })}</span>
      </div>
      <div className="bar acct-bar" role="img" aria-label={fill(t("acct.usedPct"), { pct: fmtNum(b.usedPct, locale, 0) })}><span style={{ inlineSize: `${b.usedPct}%` }} /></div>
      <p className="acct-line">
        {fill(t("acct.usedLine"), { used: fmtNum(b.used, locale, 0), pct: fmtNum(b.usedPct, locale, 0) })}
        {b.plan ? ` · ${fill(t("acct.planLine"), { plan: b.plan.name })}` : ""}
        {b.resetAt ? ` · ${fill(t("acct.renews"), { date: date(b.resetAt, locale), days: fmtNum(Math.ceil(b.daysToReset ?? 0), locale, 0) })}` : ""}
      </p>
      <p className={`acct-verdict ${b.tone}`}>
        {b.perDay <= 0 ? t("acct.pace.none")
          : b.runsOutAt ? fill(t("acct.pace.out"), { perDay: fmtNum(b.perDay, locale, 0), date: date(b.runsOutAt, locale), days: fmtNum(Math.max(0, Math.floor((b.runsOutAt - now) / DAY)), locale, 0) })
            : fill(t("acct.pace.ok"), { perDay: fmtNum(b.perDay, locale, 0), left: fmtNum(Math.max(0, b.limit - (b.projectedAtReset ?? b.used)), locale, 0) })}
      </p>
      <small className="muted">{fill(t("acct.updated"), { when: ago(ins.snapshot!.fetchedAt, t, locale) })}</small>
      {compact && <Link className="btn small ghost" href="/admin/settings#elevenlabs">{t("acct.details")}</Link>}
    </section>
  );
}

const ADVICE_TONE: Record<ClientForecast["advice"][number], "ok" | "warn" | "bad" | "neutral"> = {
  no_usage: "neutral", wallet_empty: "bad", wallet_soon: "warn", margin_negative: "bad", margin_low: "warn", estimate_only: "neutral", ok: "ok",
};

/** Platform settings: the balance, usage in plain words, the plan explained with suggestions, and each client's forecast. */
export function AccountInsights({ ins, t, locale }: { ins: Insights; t: T; locale: Locale }) {
  const s = ins.summary, m = ins.minute, a = ins.advice, b = ins.balance;
  const plan = b?.plan;
  const n0 = (x: number) => fmtNum(x, locale, 0);
  const tips: string[] = [];
  if (b?.runsOutAt) tips.push(fill(t("acct.tip.runsOut"), { date: date(b.runsOutAt, locale) }));
  if (a.verdict === "upgrade" || a.verdict === "downgrade") tips.push(fill(t(`acct.tip.${a.verdict}`), { plan: a.best!.name, saving: usd(a.saving) }));
  if (a.verdict === "too_small" && a.best) tips.push(fill(t("acct.tip.too_small"), { plan: a.current!.name, minutes: n0(a.minutesPerMonth), best: a.best.name }));
  if (a.verdict === "overage") tips.push(fill(t("acct.tip.overage"), { extra: n0(Math.max(0, a.minutesPerMonth - (a.current?.minutes ?? 0))) }));
  if (a.verdict === "keep" && a.current) tips.push(fill(t("acct.tip.keep"), { plan: a.current.name, minutes: n0(a.minutesPerMonth), included: n0(a.current.minutes) }));
  tips.push(t("acct.tip.samePrice"));
  if (plan) tips.push(fill(t("acct.tip.concurrency"), { n: n0(plan.concurrency), burst: usd(BURST_MINUTE_USD) }));
  if (m?.usdPerMinute !== undefined && m.usdPerMinute > EXTRA_MINUTE_USD * 1.5) tips.push(t("acct.tip.model"));
  if (ins.clients.some((c) => c.advice.includes("estimate_only"))) tips.push(t("acct.tip.refreshReal"));

  return (
    <>
      <BalanceCard ins={ins} t={t} locale={locale} returnTo="/admin/settings" />
      {ins.snapshot?.errors.length ? <p className="notice warn" dir="ltr">{ins.snapshot.errors.join(" · ")}</p> : null}

      <Fold id="usage-plain" open title={t("acct.usage.title")} hint={t("acct.usage.hint")}>
        {!s ? <p className="muted">{t("acct.noData")}</p> : (
          <ul className="acct-facts">
            <li>
              {fill(t("acct.usage.week"), { n: n0(s.last7) })}{" "}
              {s.changePct === undefined ? "" : s.changePct >= 0 ? fill(t("acct.usage.up"), { pct: n0(s.changePct) }) : fill(t("acct.usage.down"), { pct: n0(-s.changePct) })}
            </li>
            <li>{fill(t("acct.usage.month"), { n: n0(s.last30), minutes: fmtNum(s.minutes30, locale, 0), days: n0(s.activeDays) })}</li>
            {s.products.length > 0 && (
              <li>
                {t("acct.usage.what")}
                <div className="acct-split">
                  {s.products.slice(0, 5).map((p) => (
                    <div key={p.key} className="acct-split-row">
                      <span>{t(`acct.product.${productLabel(p.key)}` as Key)}{productLabel(p.key) === "other" ? ` (${p.key})` : ""}</span>
                      <div className="bar"><span style={{ inlineSize: `${p.pct}%` }} /></div>
                      <span className="muted">{n0(p.pct)}% · {n0(p.credits)}</span>
                    </div>
                  ))}
                </div>
              </li>
            )}
            {s.busiest && <li>{fill(t("acct.usage.busiest"), { date: date(s.busiest.day, locale), n: n0(s.busiest.credits) })}</li>}
            {m?.creditsPerMinute !== undefined && <li>{fill(t("acct.usage.perMinute"), { n: n0(m.creditsPerMinute) })}</li>}
          </ul>
        )}
      </Fold>

      <Fold id="plan-explained" title={t("acct.plan.title")} hint={t("acct.plan.hint")}>
        <ul className="acct-facts">
          {plan && <li>{fill(t("acct.plan.current"), { plan: plan.name, price: plan.usd !== undefined ? usd(plan.usd, 0) : "?", minutes: n0(plan.minutes), credits: n0(b?.limit ?? 0), conc: n0(plan.concurrency) })}</li>}
          <li>{fill(t("acct.plan.list"), { minute: usd(EXTRA_MINUTE_USD), message: usd(MESSAGE_USD, 3), burst: usd(BURST_MINUTE_USD) })}</li>
          {m?.usdPerCredit !== undefined && <li>{fill(t("acct.plan.credit"), { usd: `$${m.usdPerCredit.toFixed(6)}` })}</li>}
          {m?.usdPerMinute !== undefined && (
            <li><strong>{fill(t("acct.plan.minute"), { credits: n0(m.creditsPerMinute ?? 0), usd: usd(m.usdPerMinute, 3), bhd: fmtNum(m.bhdPerMinute ?? 0, locale, 3) })}</strong></li>
          )}
          {m?.realUsdPerMinute !== undefined && <li>{fill(t("acct.plan.real"), { usd: usd(m.realUsdPerMinute, 3), bhd: fmtNum(m.realUsdPerMinute * USD_TO_BHD, locale, 3), minutes: fmtNum(m.realMinutes ?? 0, locale, 0) })}</li>}
        </ul>
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t("acct.col.plan")}</th><th>{t("acct.col.price")}</th><th>{t("acct.col.minutes")}</th><th>{t("acct.col.calls")}</th><th>{fill(t("acct.col.yours"), { n: n0(a.minutesPerMonth) })}</th></tr></thead>
            <tbody>
              {EL_PLANS.map((p) => {
                const o = a.options.find((x) => x.plan.id === p.id);
                const mine = p.id === a.current?.id, best = p.id === a.best?.id;
                return (
                  <tr key={p.id} className={mine ? "acct-mine" : undefined}>
                    <td>{p.name}{mine ? ` · ${t("acct.col.current")}` : ""}{best ? ` · ${t("acct.col.best")}` : ""}</td>
                    <td>{p.usd !== undefined ? usd(p.usd, 0) : t("acct.col.sales")}</td>
                    <td>{n0(p.minutes)}</td>
                    <td>{n0(p.concurrency)}</td>
                    <td>{o ? `${usd(o.usd)}${o.extraMinutes ? ` (${fill(t("acct.col.extra"), { n: n0(o.extraMinutes) })})` : ""}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <h3>{t("acct.tips")}</h3>
        <ul className="notes">{tips.map((x) => <li key={x}>{x}</li>)}</ul>
        <small className="muted">{t("acct.plan.source")}</small>
      </Fold>

      <Fold id="clients-forecast" open title={t("acct.clients.title")} hint={t("acct.clients.hint")}>
        <div className="acct-clients">
          {ins.clients.map((c) => (
            <article key={c.tenantId} className="acct-client">
              <header>
                <Link href={`/admin/clients/${c.tenantId}`}><strong>{c.name}</strong></Link>
                <span className={`badge ${ADVICE_TONE[c.advice[0]]}`}>{t(`acct.adv.${c.advice[0]}` as Key)}</span>
              </header>
              <dl>
                <div><dt>{t("acct.c.mtd")}</dt><dd>{fill(t("acct.c.usage"), { min: fmtNum(c.mtd.minutes, locale, 0), msg: n0(c.mtd.messages) })}</dd></div>
                <div><dt>{t("acct.c.perMinute")}</dt><dd>{c.usdPerMinute !== undefined ? `${usd(c.usdPerMinute, 3)} · BHD ${fmtNum(c.usdPerMinute * USD_TO_BHD, locale, 3)}` : "—"}</dd></div>
                <div><dt>{t("acct.c.forecast")}</dt><dd>{fill(t("acct.c.usage"), { min: n0(c.month.minutes), msg: n0(c.month.messages) })}</dd></div>
                <div><dt>{t("acct.c.money")}</dt><dd>{fill(t("acct.c.moneyLine"), { cost: fmtNum(c.month.costBhd, locale, 2), rev: fmtNum(c.month.revenueBhd, locale, 2), margin: fmtNum(c.month.marginBhd, locale, 2) })}{c.month.marginPct !== undefined ? ` (${n0(c.month.marginPct)}%)` : ""}</dd></div>
                <div><dt>{t("acct.c.wallet")}</dt><dd>{n0(c.wallet.balance)}{c.wallet.daysLeft !== undefined && c.wallet.daysLeft > 365 ? ` · ${t("acct.c.overYear")}` : c.wallet.runsOutAt ? ` · ${fill(t("acct.c.lasts"), { date: date(c.wallet.runsOutAt, locale), days: n0(c.wallet.daysLeft ?? 0) })}` : ""}</dd></div>
              </dl>
              <ul className="notes small">
                {c.advice.filter((x) => x !== "ok").map((x) => <li key={x}>{fill(t(`acct.advice.${x}` as Key), { topUp: n0(c.topUp ?? 0), real: n0(c.realShare) })}</li>)}
              </ul>
            </article>
          ))}
        </div>
        <small className="muted">{t("acct.clients.how")}</small>
      </Fold>
    </>
  );
}
