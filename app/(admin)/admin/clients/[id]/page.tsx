import Link from "next/link";
import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n";
import { fmtDate, fmtDateTime, fmtNum } from "@/lib/format";
import { getAgent, getAgentVersions, getAudit, getLedger, getTenant, getWallet } from "@/lib/store";
import {
  adminPermissionsAction, adminRenewAction, adminRollbackAction, adminTenantSettingsAction, adminTopUpAction, viewAsClient,
} from "@/lib/actions";
import { Badge, Notice, PageHead, Stat } from "@/components/ui";

export default async function ClientAdmin({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { id } = await params;
  const { saved } = await searchParams;
  const tenant = getTenant(id);
  if (!tenant) notFound();
  const { t, locale } = await getT();
  const w = getWallet(id);
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
            <form action={viewAsClient}><input type="hidden" name="tenantId" value={id} /><button className="btn">{t("admin.viewAs")}</button></form>
          </>
        }
      />
      {saved && <Notice tone="ok">{t("agent.saved").split(".")[0]}.</Notice>}
      <div className="grid">
        <Stat label={t("admin.balance")} value={fmtNum(w.balance, locale, 1)} tone={w.low ? "warn" : undefined} hint={tenant.plan.name} />
        <Stat label={t("common.status")} value={t(`status.${tenant.status}` as "status.live")} />
        <Stat label="Agent id" value={<code>{getAgent(id).elevenLabsAgentId || "–"}</code>} />
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
            <button className="btn" type="submit">{t("admin.grant")}</button>
          </form>
          <small className="muted">{t("admin.grantHelp")}</small>
          {tenant.plan.type === "package" && (
            <form action={adminRenewAction} className="stack">
              <input type="hidden" name="tenantId" value={id} /><input type="hidden" name="returnTo" value={returnTo} />
              <button className="btn ghost" type="submit">{t("admin.renew")}</button>
              <small className="muted">{t("admin.renewHelp")}</small>
            </form>
          )}
        </section>

        <section className="card">
          <form action={adminPermissionsAction} className="stack">
            <input type="hidden" name="tenantId" value={id} /><input type="hidden" name="returnTo" value={returnTo} />
            <h2>{t("admin.permissions")}</h2>
            {perms.map(([k, label]) => (
              <label key={k} className="inline"><input type="checkbox" name={k} defaultChecked={tenant.permissions[k]} />{t(label)}</label>
            ))}
            <button className="btn" type="submit">{t("common.save")}</button>
          </form>
        </section>

        <section className="card">
          <form action={adminTenantSettingsAction} className="stack">
            <input type="hidden" name="tenantId" value={id} /><input type="hidden" name="returnTo" value={returnTo} />
            <h2>{t("admin.branding")}</h2>
            <label>{t("admin.displayName")}<input name="displayName" defaultValue={tenant.branding.displayName} /></label>
            <label>{t("admin.displayNameAr")}<input name="displayNameAr" defaultValue={tenant.branding.displayNameAr} dir="rtl" /></label>
            <label>{t("admin.color")}<input type="color" name="primaryColor" defaultValue={tenant.branding.primaryColor} /></label>
            <label>{t("admin.allowedDomains")}<input name="allowedDomains" defaultValue={tenant.allowedDomains.join(", ")} /></label>
            <label>{t("admin.policy")}
              <select name="zeroBalancePolicy" defaultValue={tenant.zeroBalancePolicy}>
                <option value="pause">{t("admin.policy.pause")}</option>
                <option value="overdraft">{t("admin.policy.overdraft")}</option>
              </select>
            </label>
            <button className="btn" type="submit">{t("common.save")}</button>
          </form>
        </section>

        <section className="card stack">
          <h2>{t("admin.versions")}</h2>
          <div className="table-wrap">
            <table>
              <tbody>
                {getAgentVersions(id).map((v, i) => (
                  <tr key={v.id}>
                    <td>{fmtDateTime(v.createdAt, locale)}<br /><small className="muted">{v.author} · {v.summary}</small></td>
                    <td>
                      {i > 0 && (
                        <form action={adminRollbackAction}>
                          <input type="hidden" name="tenantId" value={id} /><input type="hidden" name="versionId" value={v.id} /><input type="hidden" name="returnTo" value={returnTo} />
                          <button className="btn small ghost" type="submit">{t("admin.rollback")}</button>
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

      <section className="card stack">
        <h2>{t("credits.history")}</h2>
        <div className="table-wrap">
          <table>
            <tbody>
              {getLedger(id).filter((l) => l.kind !== "usage").slice(0, 10).map((l) => (
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
              {getAudit(id).slice(0, 12).map((a) => (
                <tr key={a.id}><td>{fmtDateTime(a.at, locale)}</td><td>{a.actor}</td><td>{a.action}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
