import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n";
import { Badge, Notice, PageHead, Stat } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { Fold } from "@/components/Fold";
import { FoldControls } from "@/components/FoldControls";
import { fmtDate, fmtDateTime, fmtNum } from "@/lib/format";
import { addMonths } from "@/lib/credits";
import { planNames } from "@/lib/plans";
import { PlanPicker } from "@/components/PlanPicker";
import { getLedger, getTenant, getTopUpRequests, getWallet, listPackages } from "@/lib/data";
import { adminRenewAction, adminTopUpAction, adminAddPlanAction, adminEndPlanAction } from "@/lib/actions";
import { adminAdjustCreditsAction, adminDeclineTopUpAction } from "@/lib/manage-actions";

export default async function ClientBilling({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { id } = await params;
  const { saved, error } = await searchParams;
  const tenant = await getTenant(id);
  if (!tenant) notFound();
  const [{ t, locale }, w, ledger, catalogue, requests] = await Promise.all([getT(tenant), getWallet(id), getLedger(id), listPackages(), getTopUpRequests()]);
  const asked = requests.filter((r) => r.tenantId === id);
  const returnTo = `/admin/clients/${id}/billing`;
  return (
    <>
      {(error === "plan" || error === "lastPlan" || error === "adjust" || error === "adjustTooMuch") && <Notice tone="warn">{t(`admin.err.${error}` as "admin.err.name")}</Notice>}
      {saved && <Notice tone="ok">{t("agent.saved").split(".")[0]}.</Notice>}
      <PageHead title={t("ws.billing")} />
      {asked.length > 0 && (
        <Notice tone="warn">
          {asked.map((r) => (
            <span key={r.id} className="row" style={{ justifyContent: "space-between" }}>
              <span>{t("admin.request.line").replace("{n}", fmtNum(r.credits, locale, 0)).replace("{date}", fmtDate(r.at, locale))}</span>
              <span className="row">
                <form action={adminTopUpAction}>
                  <input type="hidden" name="tenantId" value={id} /><input type="hidden" name="returnTo" value={returnTo} />
                  <input type="hidden" name="credits" value={r.credits} /><input type="hidden" name="note" value="Top-up request" />
                  <SubmitButton className="btn small" type="submit">{t("admin.request.approve").replace("{n}", fmtNum(r.credits, locale, 0))}</SubmitButton>
                </form>
                <form action={adminDeclineTopUpAction}>
                  <input type="hidden" name="requestId" value={r.id} /><input type="hidden" name="returnTo" value={returnTo} />
                  <SubmitButton className="btn small ghost" type="submit">{t("admin.request.decline")}</SubmitButton>
                </form>
              </span>
            </span>
          ))}
        </Notice>
      )}
      <div className="grid">
        <Stat label={t("admin.balance")} value={fmtNum(w.balance, locale, 1)} tone={w.low ? "warn" : undefined} hint={planNames(tenant.plans)} />
      </div>
      <FoldControls openAll={t("fold.openAll")} closeAll={t("fold.closeAll")} />
      <Fold id="wallet" open title={t("admin.wallet")}>
        <div className="table-wrap">
          <table>
            <thead><tr><th>{t("common.kind")}</th><th>{t("common.remaining")}</th><th>{t("common.expires")}</th></tr></thead>
            <tbody>
              {w.batches.filter((b) => b.remaining > 0).map((b) => (
                <tr key={b.id}>
                  <td>{t(`kind.${b.kind}` as "kind.topup")}</td>
                  <td>{fmtNum(b.remaining, locale, 1)} / {fmtNum(b.amount, locale, 0)}</td>
                  <td>{fmtDate(b.expiresAt, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form action={adminTopUpAction} className="row">
          <input type="hidden" name="tenantId" value={id} /><input type="hidden" name="returnTo" value={returnTo} />
          <label style={{ flex: 1 }}>{t("admin.amount")}<input name="credits" type="number" min="1" step="1" defaultValue={500} required /></label>
          <label style={{ flex: 2 }}>Note<input name="note" placeholder="Invoice 2026-114" maxLength={120} /></label>
          <SubmitButton className="btn" type="submit">{t("admin.grant")}</SubmitButton>
        </form>
        <small className="muted">{t("admin.grantHelp")}</small>
        <details>
          <summary style={{ cursor: "pointer" }}>{t("admin.adjust")}</summary>
          <form action={adminAdjustCreditsAction} className="row" style={{ marginBlockStart: ".5rem", alignItems: "end" }}>
            <input type="hidden" name="tenantId" value={id} /><input type="hidden" name="returnTo" value={returnTo} />
            <label style={{ flex: 1 }}>{t("admin.adjust.credits")}<input name="credits" type="number" step="0.01" required placeholder="-50" /></label>
            <label style={{ flex: 2 }}>{t("admin.adjust.reason")}<input name="note" required maxLength={120} placeholder={t("admin.adjust.reasonPh")} /></label>
            <SubmitButton className="btn ghost" type="submit">{t("admin.adjust.apply")}</SubmitButton>
          </form>
          <small className="muted">{t("admin.adjust.help")}</small>
        </details>
      </Fold>
      <Fold id="plans" open title={t("plans.title")} hint={t("plans.help")}>
        <div className="table-wrap">
          <table>
            <tbody>
              {tenant.plans.map((p) => (
                <tr key={p.id} style={p.active ? undefined : { opacity: 0.6 }}>
                  <td>
                    <strong>{p.name}</strong> <Badge tone={p.active ? "ok" : "neutral"}>{p.active ? t("plans.active") : t("plans.ended")}</Badge>
                    <br /><small className="muted">
                      {p.type === "package" ? `${fmtNum(p.includedCredits, locale, 0)} ${t("packages.creditsWord")} · ` : ""}
                      BHD {fmtNum(p.monthlyPriceBhd, locale, 0)} {t("packages.perMonth")}
                      {p.contractRef ? ` · ${p.contractRef}` : ""}
                    </small>
                  </td>
                  <td>{p.active && p.type === "package" ? `${t("plans.since")} ${fmtDate(addMonths(p.periodStart, 1), locale)}` : ""}</td>
                  <td>
                    {p.active && (
                      <div className="row">
                        {p.type === "package" && (
                          <form action={adminRenewAction}>
                            <input type="hidden" name="tenantId" value={id} /><input type="hidden" name="planId" value={p.id} /><input type="hidden" name="returnTo" value={returnTo} />
                            <SubmitButton className="btn small ghost" type="submit">{t("plans.renew")}</SubmitButton>
                          </form>
                        )}
                        {tenant.plans.filter((x) => x.active).length > 1 && (
                          <form action={adminEndPlanAction}>
                            <input type="hidden" name="tenantId" value={id} /><input type="hidden" name="planId" value={p.id} /><input type="hidden" name="returnTo" value={returnTo} />
                            <SubmitButton className="btn small danger" type="submit">{t("plans.end")}</SubmitButton>
                          </form>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <small className="muted">{t("admin.renewHelp")}</small>
        {catalogue.some((p) => !p.archived) ? (
          <form action={adminAddPlanAction} className="stack">
            <input type="hidden" name="tenantId" value={id} /><input type="hidden" name="returnTo" value={returnTo} />
            <PlanPicker packages={catalogue} locale={locale} t={t} />
            <div><SubmitButton className="btn" type="submit">{t("plans.add")}</SubmitButton></div>
          </form>
        ) : <Notice>{t("plans.none")}</Notice>}
      </Fold>
      <Fold id="history" title={t("credits.history")}>
        <div className="table-wrap">
          <table>
            <tbody>
              {ledger.filter((l) => l.kind !== "usage").slice(0, 10).map((l) => (
                <tr key={l.id}>
                  <td>{fmtDateTime(l.at, locale)}</td>
                  <td><Badge>{t(`ledger.${l.kind}` as "ledger.topup")}</Badge></td>
                  <td>{l.credits > 0 ? "+" : ""}{fmtNum(l.credits, locale, 1)}</td>
                  <td className="muted">{l.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Fold>
    </>
  );
}
