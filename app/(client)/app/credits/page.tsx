import { requireClient } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate, fmtDateTime, fmtNum } from "@/lib/format";
import { getLedger, getWallet, usageByChannel } from "@/lib/data";
import { requestTopUpAction } from "@/lib/actions";
import { Badge, Notice, PageHead, Stat } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";

export default async function CreditsPage({ searchParams }: { searchParams: Promise<{ requested?: string }> }) {
  const { tenant } = await requireClient();
  const { requested } = await searchParams;
  const { t, locale } = await getT();
  const w = await getWallet(tenant.id);
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const usage = await usageByChannel(tenant.id, monthStart);
  const total = Object.values(usage).reduce((a, b) => a + b, 0) || 1;
  return (
    <>
      <PageHead title={t("credits.title")} />
      {requested && <Notice tone="ok">{t("credits.requested")}</Notice>}
      <div className="grid">
        <Stat label={t("credits.balance")} value={fmtNum(w.balance, locale, 1)} tone={w.low ? "warn" : undefined} hint={t("credits.explain")} />
      </div>
      <div className="grid two">
        <section className="card stack">
          <h2>{t("credits.batches")}</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>{t("common.kind")}</th><th>{t("common.remaining")}</th><th>{t("common.expires")}</th></tr></thead>
              <tbody>
                {w.batches.filter((b) => b.remaining > 0 && new Date(b.expiresAt) > new Date()).sort((a, b) => a.expiresAt.localeCompare(b.expiresAt)).map((b) => (
                  <tr key={b.id}>
                    <td>{t(`kind.${b.kind}` as "kind.topup")}</td>
                    <td>{fmtNum(b.remaining, locale, 1)} / {fmtNum(b.amount, locale, 0)}</td>
                    <td>{fmtDate(b.expiresAt, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form action={requestTopUpAction} className="row">
            <input type="hidden" name="returnTo" value="/app/credits" />
            <input name="credits" type="number" min="1" step="1" defaultValue={500} style={{ maxWidth: 140 }} aria-label={t("common.credits")} />
            <SubmitButton className="btn" type="submit">{t("credits.request")}</SubmitButton>
          </form>
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
                  <td className="muted">{l.channel ? t(`channel.${l.channel}` as "channel.website") : l.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
