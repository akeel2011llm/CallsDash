import Link from "next/link";
import { getT } from "@/lib/i18n";
import { fmtNum } from "@/lib/format";
import { creditsOwed, getAlerts, getTenant, getTopUpRequests, getWallet, listTenants } from "@/lib/store";
import { viewAsClient } from "@/lib/actions";
import { Badge, PageHead, Stat } from "@/components/ui";

export default async function AdminHome() {
  const { t, locale } = await getT();
  const tenants = listTenants();
  const openAlerts = getAlerts().filter((a) => !a.resolved);
  const requests = getTopUpRequests();
  return (
    <>
      <PageHead title={t("admin.title")} actions={<Link className="btn" href="/admin/clients/new">{t("admin.newClient")}</Link>} />
      <div className="grid">
        <Stat label={t("admin.clientsLive")} value={`${tenants.filter((x) => x.status === "live").length} / ${tenants.length}`} />
        <Stat label={t("admin.openAlerts")} value={openAlerts.length} tone={openAlerts.length ? "warn" : undefined} />
        <Stat label={t("admin.creditsOwed")} value={fmtNum(creditsOwed(), locale, 0)} />
        <Stat label={t("admin.topUpRequests")} value={requests.length} tone={requests.length ? "warn" : undefined} />
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("common.name")}</th><th>{t("common.status")}</th><th>{t("admin.plan")}</th>
              <th>{t("admin.balance")}</th><th>{t("admin.channels")}</th><th />
            </tr>
          </thead>
          <tbody>
            {tenants.map((c) => {
              const w = getWallet(c.id);
              const asked = requests.some((r) => r.tenantId === c.id);
              return (
                <tr key={c.id}>
                  <td><Link href={`/admin/clients/${c.id}`}>{locale === "ar" ? c.branding.displayNameAr : c.name}</Link></td>
                  <td><Badge tone={c.status === "live" ? "ok" : c.status === "error" ? "bad" : "neutral"}>{t(`status.${c.status}` as "status.live")}</Badge></td>
                  <td>{c.plan.name}</td>
                  <td>
                    {fmtNum(w.balance, locale, 1)} {w.low && <Badge tone="warn">!</Badge>} {asked && <Badge tone="info">{t("admin.topUpRequests")}</Badge>}
                  </td>
                  <td className="row">
                    {(Object.entries(c.channels) as [keyof typeof c.channels, string][]).map(([ch, st]) => (
                      <Badge key={ch} tone={st === "connected" ? "ok" : st === "pending" ? "warn" : "neutral"}>
                        {t(`channel.${ch}` as "channel.website")}
                      </Badge>
                    ))}
                  </td>
                  <td className="row">
                    <Link className="btn small ghost" href={`/admin/clients/${c.id}`}>{t("admin.manage")}</Link>
                    <form action={viewAsClient}>
                      <input type="hidden" name="tenantId" value={getTenant(c.id)!.id} />
                      <button className="btn small" type="submit">{t("admin.viewAs")}</button>
                    </form>
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
