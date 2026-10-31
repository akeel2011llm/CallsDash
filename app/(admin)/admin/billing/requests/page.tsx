import Link from "next/link";
import { getT } from "@/lib/i18n";
import { fmtDate, fmtNum } from "@/lib/format";
import { getTopUpRequests, getWallet, listTenants } from "@/lib/data";
import { adminTopUpAction } from "@/lib/actions";
import { adminDeclineTopUpAction } from "@/lib/manage-actions";
import { Empty, Notice, PageHead } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";

/** Every client's waiting top-up requests in one list, so none is missed (each client's Billing tab shows its own too). */
export default async function TopUpRequests({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const { saved } = await searchParams;
  const [{ t, locale }, requests, tenants] = await Promise.all([getT(), getTopUpRequests(), listTenants()]);
  const byId = new Map(tenants.map((c) => [c.id, c]));
  const balances = new Map(await Promise.all([...new Set(requests.map((r) => r.tenantId))].map(async (id) => [id, (await getWallet(id)).balance] as const)));
  const returnTo = "/admin/billing/requests";
  return (
    <>
      <PageHead title={t("billing.requests")} subtitle={t("billing.requests.help")} />
      {saved && <Notice tone="ok">{t("agent.saved").split(".")[0]}.</Notice>}
      {requests.length === 0 ? <div className="card"><Empty>{t("billing.requests.none")}</Empty></div> : (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr><th>{t("common.name")}</th><th>{t("common.credits")}</th><th>{t("common.date")}</th><th>{t("admin.balance")}</th><th /></tr>
            </thead>
            <tbody>
              {requests.map((r) => {
                const c = byId.get(r.tenantId);
                const name = c ? (locale === "ar" ? c.branding.displayNameAr || c.name : c.name) : r.tenantId;
                return (
                  <tr key={r.id}>
                    <td><Link href={`/admin/clients/${r.tenantId}/billing`} title={t("billing.requests.open")}>{name}</Link></td>
                    <td>{fmtNum(r.credits, locale, 0)}</td>
                    <td>{fmtDate(r.at, locale)}</td>
                    <td>{fmtNum(balances.get(r.tenantId) ?? 0, locale, 1)}</td>
                    <td>
                      <div className="row">
                        <form action={adminTopUpAction}>
                          <input type="hidden" name="tenantId" value={r.tenantId} /><input type="hidden" name="returnTo" value={returnTo} />
                          <input type="hidden" name="credits" value={r.credits} /><input type="hidden" name="note" value="Top-up request" />
                          <SubmitButton className="btn small" type="submit">{t("admin.request.approve").replace("{n}", fmtNum(r.credits, locale, 0))}</SubmitButton>
                        </form>
                        <form action={adminDeclineTopUpAction}>
                          <input type="hidden" name="requestId" value={r.id} /><input type="hidden" name="returnTo" value={returnTo} />
                          <SubmitButton className="btn small ghost" type="submit">{t("admin.request.decline")}</SubmitButton>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
