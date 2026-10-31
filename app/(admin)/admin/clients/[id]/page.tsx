import Link from "next/link";
import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n";
import { fmtDate, fmtDateTime, fmtNum } from "@/lib/format";
import { addMonths } from "@/lib/credits";
import { planNames } from "@/lib/plans";
import { PlanPicker } from "@/components/PlanPicker";
import { getAgent, getAgentVersions, getBookings, getDoctors, getAudit, getLedger, getTenant, getTopUpRequests, getWallet, listPackages, listProfiles } from "@/lib/data";
import {
  adminPermissionsAction, adminRenewAction, adminRollbackAction, adminTenantSettingsAction, adminTopUpAction, adminDeleteTenantAction, adminAddPlanAction, adminEndPlanAction, viewAsClient,
} from "@/lib/actions";
import { adminAdjustCreditsAction, adminClientProfileAction, adminDeclineTopUpAction, adminBusinessAction } from "@/lib/manage-actions";
import { DoctorsManager } from "@/components/DoctorsManager";
import { TryAssistant } from "@/components/TryAssistant";
import { AssistantCheck } from "@/components/AssistantCheck";
import { Badge, Notice, PageHead, Stat } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { CopyChecklist } from "@/components/CopyChecklist";
import { Fold } from "@/components/Fold";
import { FoldControls } from "@/components/FoldControls";
import { Guide } from "@/components/Guide";
import { BusinessFields } from "@/components/BusinessFields";
import { businessOf, vocabOf } from "@/lib/business-types";

export default async function ClientAdmin({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; error?: string; cal?: string; doc?: string; clash?: string; copied?: string }> }) {
  const { id } = await params;
  const { saved, error, cal, doc, clash, copied } = await searchParams;
  const tenant = await getTenant(id);
  if (!tenant) notFound();
  const [{ t, locale }, w, agent, versions, doctors, ledger, audit, catalogue, bookings, logins, requests] = await Promise.all([
    getT(tenant), getWallet(id), getAgent(id), getAgentVersions(id), getDoctors(id), getLedger(id), getAudit(id), listPackages(), getBookings(id), listProfiles(id), getTopUpRequests(),
  ]);
  // the business type's own texts must not be reworded by the type they describe
  const { t: plain } = await getT();
  const biz = businessOf(tenant);
  const words = vocabOf(tenant, locale);
  const asked = requests.filter((r) => r.tenantId === id);
  const returnTo = `/admin/clients/${id}`;
  const perms = [
    ["editPrompt", "admin.perm.editPrompt"], ["editVoice", "admin.perm.editVoice"],
    ["editBehaviour", "admin.perm.editBehaviour"], ["editKnowledge", "admin.perm.editKnowledge"],
    ["dataManager", "admin.perm.dataManager"],
  ] as const;
  return (
    <>
      <PageHead
        title={locale === "ar" ? tenant.branding.displayNameAr : tenant.name}
        actions={
          <>
            <Link className="btn ghost" href="/admin">{t("common.back")}</Link>
            <Link className="btn ghost" href={`/admin/clients/${id}/setup`}>{t("nav.setup")}</Link>
            <Link className="btn ghost" href={`/admin/clients/${id}/assistant`}>{t("nav.assistant")}</Link>
            <Link className="btn ghost" href={`/admin/clients/${id}/channels`}>{t("nav.channels")}</Link>
            <Link className="btn ghost" href={`/admin/clients/${id}/data`}>{t("data.open")}</Link>
            <Link className="btn ghost" href={`/admin/clients/${id}/branding`}>{t("brand.open")}</Link>
            <Link className="btn ghost" href={`/admin/clients/${id}/duplicate`}>{t("dup.open")}</Link>
            <form action={viewAsClient}><input type="hidden" name="tenantId" value={id} /><SubmitButton className="btn">{t("admin.viewAs")}</SubmitButton></form>
          </>
        }
      />
      {(error === "name" || error === "domain" || error === "confirm" || error === "plan" || error === "lastPlan" || error === "adjust" || error === "adjustTooMuch") && <Notice tone="warn">{t(`admin.err.${error}` as "admin.err.name")}</Notice>}
      {copied && /^\d+\.\d+\.\d+$/.test(copied) && (() => {
        const [nd, nk, nr] = copied.split(".");
        return (
          <>
            <Notice tone="ok">{t("dup.done").replace("{doctors}", nd).replace("{knowledge}", nk).replace("{renamed}", nr)}</Notice>
            <Guide id="copy"><CopyChecklist t={t} /></Guide>
          </>
        );
      })()}
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
      {saved === "business" && <Notice tone="ok">{plain("biz.saved")}</Notice>}
      {saved && saved !== "synced" && saved !== "created" && saved !== "business" && <Notice tone="ok">{t("agent.saved").split(".")[0]}.</Notice>}
      <div className="grid">
        <Stat label={t("admin.balance")} value={fmtNum(w.balance, locale, 1)} tone={w.low ? "warn" : undefined} hint={planNames(tenant.plans)} />
        <Stat label={t("common.status")} value={t(`status.${tenant.status}` as "status.live")} />
        <Stat label="Agent id" value={<code>{agent.elevenLabsAgentId || "–"}</code>} />
      </div>

      <TryAssistant tenant={tenant} admin returnTo={returnTo} sp={{ saved, error }} />
      <AssistantCheck tenant={tenant} />

      <FoldControls openAll={t("fold.openAll")} closeAll={t("fold.closeAll")} />

      <div className="grid two fold-grid">
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

        <Fold id="profile" title={t("admin.profile")}>
          <form action={adminClientProfileAction} className="stack">
            <input type="hidden" name="tenantId" value={id} /><input type="hidden" name="returnTo" value={returnTo} />
            <label>{t("admin.profile.name")}<input name="name" required maxLength={120} defaultValue={tenant.name} /></label>
            <label>{t("common.status")}
              <select name="status" defaultValue={tenant.status === "suspended" ? "suspended" : "live"}>
                <option value="live">{t("admin.profile.active")}</option>
                <option value="suspended">{t("admin.profile.suspended")}</option>
              </select>
            </label>
            <small className="muted">{t("admin.profile.suspendHelp")}</small>
            <label>{t("admin.profile.retention")}
              <select name="retentionDays" defaultValue={String(tenant.retentionDays)}>
                {[30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>{t("admin.profile.days").replace("{n}", String(d))}</option>)}
              </select>
            </label>
            <label>{t("admin.profile.low")}<input name="lowBalancePercent" type="number" min="0" max="90" step="1" defaultValue={Math.round(tenant.lowBalanceThreshold * 100)} /></label>
            <small className="muted">{t("admin.profile.lowHelp")}</small>
            <SubmitButton className="btn" type="submit">{t("common.save")}</SubmitButton>
          </form>
        </Fold>

        <Fold id="business" open={saved === "business"} title={plain("biz.title")} hint={plain(`biz.type.${biz.type}`)}>
          <form action={adminBusinessAction} className="stack">
            <input type="hidden" name="tenantId" value={id} /><input type="hidden" name="returnTo" value={returnTo} />
            <small className="muted">{plain("biz.help")}</small>
            <BusinessFields t={plain} business={biz} />
            <Notice>{plain("biz.preview").replace("{staff}", words.staffMany).replace("{customers}", words.customerMany).replace("{place}", words.place)}</Notice>
            {biz.type !== "clinic" && <small className="muted">{plain("biz.assistantNote")}</small>}
            <SubmitButton className="btn" type="submit">{plain("common.save")}</SubmitButton>
          </form>
        </Fold>

        <Fold title={t("admin.permissions")}>
          <form action={adminPermissionsAction} className="stack">
            <input type="hidden" name="tenantId" value={id} /><input type="hidden" name="returnTo" value={returnTo} />
            {perms.map(([k, label]) => (
              <label key={k} className="inline"><input type="checkbox" name={k} defaultChecked={tenant.permissions[k]} />{t(label)}</label>
            ))}
            <SubmitButton className="btn" type="submit">{t("common.save")}</SubmitButton>
          </form>
        </Fold>

        <Fold title={t("admin.branding")}>
          <form action={adminTenantSettingsAction} className="stack">
            <input type="hidden" name="tenantId" value={id} /><input type="hidden" name="returnTo" value={returnTo} />
            <label>{t("admin.displayName")}<input name="displayName" defaultValue={tenant.branding.displayName} /></label>
            <label>{t("admin.displayNameAr")}<input name="displayNameAr" defaultValue={tenant.branding.displayNameAr} dir="rtl" /></label>
            <label>{t("admin.color")}<input type="color" name="primaryColor" defaultValue={tenant.branding.primaryColor} /></label>
            <small><Link href={`/admin/clients/${id}/branding`}>{t("brand.open")}</Link></small>
            <label>{t("admin.allowedDomains")}<input name="allowedDomains" defaultValue={tenant.allowedDomains.join(", ")} /></label>
            <label>{t("admin.policy")}
              <select name="zeroBalancePolicy" defaultValue={tenant.zeroBalancePolicy}>
                <option value="pause">{t("admin.policy.pause")}</option>
                <option value="overdraft">{t("admin.policy.overdraft")}</option>
              </select>
            </label>
            <SubmitButton className="btn" type="submit">{t("common.save")}</SubmitButton>
          </form>
        </Fold>

        <Fold title={t("admin.versions")}>
          <div className="table-wrap">
            <table>
              <tbody>
                {versions.map((v, i) => (
                  <tr key={v.id}>
                    <td>{fmtDateTime(v.createdAt, locale)}<br /><small className="muted">{v.author} · {v.summary}</small></td>
                    <td>
                      {i > 0 && (
                        <form action={adminRollbackAction}>
                          <input type="hidden" name="tenantId" value={id} /><input type="hidden" name="versionId" value={v.id} /><input type="hidden" name="returnTo" value={returnTo} />
                          <SubmitButton className="btn small ghost" type="submit">{t("admin.rollback")}</SubmitButton>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Fold>
      </div>

      <DoctorsManager tenant={tenant} doctors={doctors} bookings={bookings} logins={logins} returnTo={returnTo} sp={{ doc, cal, clash }} t={t} locale={locale} />

      <Fold title={t("credits.history")}>
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

      <Fold title={t("admin.audit")}>
        <div className="table-wrap">
          <table>
            <tbody>
              {audit.slice(0, 12).map((a) => (
                <tr key={a.id}><td>{fmtDateTime(a.at, locale)}</td><td>{a.actor}</td><td>{a.action}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Fold>

      <Fold title={t("plans.title")} hint={t("plans.help")}>
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

      <Fold tone="danger" title={t("admin.delete.title")} hint={t("admin.delete.help")}>
        <form action={adminDeleteTenantAction} className="row">
          <input type="hidden" name="tenantId" value={id} />
          <label style={{ flex: 1 }}>{tenant.name}<input name="confirmName" required autoComplete="off" placeholder={tenant.name} /></label>
          <SubmitButton className="btn danger" type="submit">{t("admin.delete.button")}</SubmitButton>
        </form>
      </Fold>
    </>
  );
}
