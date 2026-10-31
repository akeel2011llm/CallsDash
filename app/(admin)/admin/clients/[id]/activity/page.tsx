import Link from "next/link";
import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n";
import { Notice, PageHead } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { Fold } from "@/components/Fold";
import { FoldControls } from "@/components/FoldControls";
import { fmtDateTime } from "@/lib/format";
import { getAgentVersions, getAudit, getTenant } from "@/lib/data";
import { adminRollbackAction, adminDeleteTenantAction } from "@/lib/actions";

export default async function ClientActivity({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { id } = await params;
  const { saved, error } = await searchParams;
  const tenant = await getTenant(id);
  if (!tenant) notFound();
  const [{ t, locale }, versions, audit] = await Promise.all([getT(tenant), getAgentVersions(id), getAudit(id)]);
  const returnTo = `/admin/clients/${id}/activity`;
  return (
    <>
      {(error === "confirm") && <Notice tone="warn">{t(`admin.err.${error}` as "admin.err.name")}</Notice>}
      {saved && <Notice tone="ok">{t("agent.saved").split(".")[0]}.</Notice>}
      <PageHead title={t("ws.activity")} actions={<Link className="btn ghost" href={`/admin/clients/${id}/activity/duplicate`}>{t("dup.open")}</Link>} />
      <FoldControls openAll={t("fold.openAll")} closeAll={t("fold.closeAll")} />
      <Fold id="audit" open title={t("admin.audit")}>
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
      <Fold id="versions" title={t("admin.versions")}>
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
      <Fold id="delete" open={error === "confirm"} tone="danger" title={t("admin.delete.title")} hint={t("admin.delete.help")}>
        <form action={adminDeleteTenantAction} className="row">
          <input type="hidden" name="tenantId" value={id} />
          <label style={{ flex: 1 }}>{tenant.name}<input name="confirmName" required autoComplete="off" placeholder={tenant.name} /></label>
          <SubmitButton className="btn danger" type="submit">{t("admin.delete.button")}</SubmitButton>
        </form>
      </Fold>
    </>
  );
}
