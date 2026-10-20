import Link from "next/link";
import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n";
import { fmtDate, fmtDateTime, fmtNum } from "@/lib/format";
import { addMonths } from "@/lib/credits";
import { planNames } from "@/lib/plans";
import { PlanPicker } from "@/components/PlanPicker";
import { getAgent, getAgentVersions, getDoctors, getAudit, getLedger, getTenant, getWallet, listPackages } from "@/lib/data";
import {
  adminPermissionsAction, adminRenewAction, adminSetCalendarAction, adminRollbackAction, adminTenantSettingsAction, adminTopUpAction, adminDeleteTenantAction, adminAddPlanAction, adminEndPlanAction, viewAsClient,
} from "@/lib/actions";
import { Badge, Notice, PageHead, Stat } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";

export default async function ClientAdmin({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { id } = await params;
  const { saved, error } = await searchParams;
  const tenant = await getTenant(id);
  if (!tenant) notFound();
  const [{ t, locale }, w, agent, versions, doctors, ledger, audit, catalogue] = await Promise.all([
    getT(), getWallet(id), getAgent(id), getAgentVersions(id), getDoctors(id), getLedger(id), getAudit(id), listPackages(),
  ]);
  const returnTo = `/admin/clients/${id}`;
  const perms = [
    ["editPrompt", "admin.perm.editPrompt"], ["editVoice", "admin.perm.editVoice"],
    ["editBehaviour", "admin.perm.editBehaviour"], ["editKnowledge", "admin.perm.editKnowledge"],
  ] as const;
  return (
    <>
      <PageHead
        title={locale === "ar" ? tenant.branding.displayNameAr : tenant.name}
        actions={
          <>
            <Link className="btn ghost" href="/admin">{t("common.back")}</Link>
            <Link className="btn ghost" href={`/admin/clients/${id}/setup`}>{t("nav.setup")}</Link>
            <Link className="btn ghost" href={`/admin/clients/${id}/channels`}>{t("nav.channels")}</Link>
            <Link className="btn ghost" href={`/admin/clients/${id}/branding`}>{t("brand.open")}</Link>
            <form action={viewAsClient}><input type="hidden" name="tenantId" value={id} /><SubmitButton className="btn">{t("admin.viewAs")}</SubmitButton></form>
          </>
        }
      />
      {(error === "name" || error === "domain" || error === "confirm" || error === "plan" || error === "lastPlan") && <Notice tone="warn">{t(`admin.err.${error}` as "admin.err.name")}</Notice>}
      {saved && <Notice tone="ok">{t("agent.saved").split(".")[0]}.</Notice>}
      <div className="grid">
        <Stat label={t("admin.balance")} value={fmtNum(w.balance, locale, 1)} tone={w.low ? "warn" : undefined} hint={planNames(tenant.plans)} />
        <Stat label={t("common.status")} value={t(`status.${tenant.status}` as "status.live")} />
        <Stat label="Agent id" value={<code>{agent.elevenLabsAgentId || "–"}</code>} />
      </div>

      <div className="grid two">
        <section className="card stack">
          <h2>{t("admin.wallet")}</h2>
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
        </section>

        <section className="card">
          <form action={adminPermissionsAction} className="stack">
            <input type="hidden" name="tenantId" value={id} /><input type="hidden" name="returnTo" value={returnTo} />
            <h2>{t("admin.permissions")}</h2>
            {perms.map(([k, label]) => (
              <label key={k} className="inline"><input type="checkbox" name={k} defaultChecked={tenant.permissions[k]} />{t(label)}</label>
            ))}
            <SubmitButton className="btn" type="submit">{t("common.save")}</SubmitButton>
          </form>
        </section>

        <section className="card">
          <form action={adminTenantSettingsAction} className="stack">
            <input type="hidden" name="tenantId" value={id} /><input type="hidden" name="returnTo" value={returnTo} />
            <h2>{t("admin.branding")}</h2>
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
        </section>

        <section className="card stack">
          <h2>{t("admin.versions")}</h2>
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
        </section>
      </div>

      <section className="card stack" id="doctors">
        <h2>{t("admin.doctors")}</h2>
        <small className="muted">{t("admin.doctors.help")}</small>
        {doctors.map((d) => (
          <form key={d.id} action={adminSetCalendarAction} className="row">
            <input type="hidden" name="tenantId" value={id} /><input type="hidden" name="doctorId" value={d.id} /><input type="hidden" name="returnTo" value={returnTo} />
            <span style={{ minWidth: 180 }}>{d.name}</span>
            <input name="calendarId" defaultValue={d.googleCalendarId ?? ""} placeholder="clinic@group.calendar.google.com" style={{ flex: 1, minWidth: 220 }} dir="ltr" />
            <SubmitButton className="btn small" type="submit">{t("common.save")}</SubmitButton>
          </form>
        ))}
      </section>

      <section className="card stack">
        <h2>{t("credits.history")}</h2>
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
      </section>

      <section className="card stack">
        <h2>{t("admin.audit")}</h2>
        <div className="table-wrap">
          <table>
            <tbody>
              {audit.slice(0, 12).map((a) => (
                <tr key={a.id}><td>{fmtDateTime(a.at, locale)}</td><td>{a.actor}</td><td>{a.action}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card stack">
        <h2>{t("plans.title")}</h2>
        <p className="muted">{t("plans.help")}</p>
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
      </section>

      <section className="card stack danger-zone">
        <h2>{t("admin.delete.title")}</h2>
        <p className="muted">{t("admin.delete.help")}</p>
        <form action={adminDeleteTenantAction} className="row">
          <input type="hidden" name="tenantId" value={id} />
          <label style={{ flex: 1 }}>{tenant.name}<input name="confirmName" required autoComplete="off" placeholder={tenant.name} /></label>
          <SubmitButton className="btn danger" type="submit">{t("admin.delete.button")}</SubmitButton>
        </form>
      </section>
    </>
  );
}
