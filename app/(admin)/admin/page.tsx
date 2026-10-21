import Link from "next/link";
import { getT } from "@/lib/i18n";
import { fmtNum } from "@/lib/format";
import { planNames } from "@/lib/plans";
import { creditsOwed, getAlerts, getTopUpRequests, getWallet, listTenants } from "@/lib/data";
import { checklistFor } from "@/lib/setup-facts";
import { progress } from "@/lib/checklist";
import { viewAsClient } from "@/lib/actions";
import { Badge, PageHead, Stat } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";

export default async function AdminHome() {
  const [{ t, locale }, tenants, alerts, requests, owed] = await Promise.all([getT(), listTenants(), getAlerts(), getTopUpRequests(), creditsOwed()]);
  const openAlerts = alerts.filter((a) => !a.resolved);
  const wallets = new Map(await Promise.all(tenants.map(async (c) => [c.id, await getWallet(c.id)] as const)));
  const setups = new Map(await Promise.all(tenants.map(async (c) => [c.id, progress(await checklistFor(c))] as const)));
  return (
    <>
      <PageHead title={t("admin.title")} actions={<Link className="btn" href="/admin/clients/new">{t("admin.newClient")}</Link>} />
      <div className="grid">
        <Stat label={t("admin.clientsLive")} value={`${tenants.filter((x) => x.status === "live").length} / ${tenants.length}`} />
        <Stat label={t("admin.openAlerts")} value={openAlerts.length} tone={openAlerts.length ? "warn" : undefined} />
        <Stat label={t("admin.creditsOwed")} value={fmtNum(owed, locale, 0)} />
        <Stat label={t("admin.topUpRequests")} value={requests.length} tone={requests.length ? "warn" : undefined} />
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("common.name")}</th><th>{t("common.status")}</th><th>{t("admin.plan")}</th>
              <th>{t("admin.balance")}</th><th>{t("admin.setupCol")}</th><th>{t("admin.channels")}</th><th />
            </tr>
          </thead>
          <tbody>
            {tenants.map((c) => {
              const w = wallets.get(c.id)!;
              const asked = requests.some((r) => r.tenantId === c.id);
              return (
                <tr key={c.id}>
                  <td><Link href={`/admin/clients/${c.id}`}>{locale === "ar" ? c.branding.displayNameAr : c.name}</Link></td>
                  <td><Badge tone={c.status === "live" ? "ok" : c.status === "error" ? "bad" : "neutral"}>{t(`status.${c.status}` as "status.live")}</Badge></td>
                  <td>{planNames(c.plans)}</td>
                  <td>
                    {fmtNum(w.balance, locale, 1)} {w.low && <Badge tone="warn">!</Badge>} {asked && <Badge tone="info">{t("admin.topUpRequests")}</Badge>}
                  </td>
                  <td>
                    {(() => { const sp = setups.get(c.id)!; return (
                      <Link href={`/admin/clients/${c.id}/setup`} title={t("admin.setupOpen")}>
                        <Badge tone={sp.done === sp.total ? "ok" : "warn"}>{sp.done} / {sp.total}</Badge>
                      </Link>
                    ); })()}
                  </td>
                  <td>
                    <div className="row">
                    {(Object.entries(c.channels) as [keyof typeof c.channels, string][]).map(([ch, st]) => (
                      <Badge key={ch} tone={st === "connected" ? "ok" : st === "pending" ? "warn" : "neutral"}>
                        {t(`channel.${ch}` as "channel.website")}
                      </Badge>
                    ))}
                    </div>
                  </td>
                  <td>
                    <div className="row">
                    <Link className="btn small ghost" href={`/admin/clients/${c.id}`}>{t("admin.manage")}</Link>
                    <form action={viewAsClient}>
                      <input type="hidden" name="tenantId" value={c.id} />
                      <SubmitButton className="btn small" type="submit">{t("admin.viewAs")}</SubmitButton>
                    </form>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
