import { getT } from "@/lib/i18n";
import { fmtNum } from "@/lib/format";
import { listTenants, marginFor } from "@/lib/data";
import { Notice, PageHead } from "@/components/ui";

export default async function UsagePage() {
  const { t, locale } = await getT();
  const since = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const rows = await Promise.all((await listTenants()).map(async (c) => ({ c, m: await marginFor(c.id, since) })));
  const sum = (k: "conversations" | "credits" | "revenueBhd" | "costBhd" | "marginBhd") => rows.reduce((s, r) => s + r.m[k], 0);
  return (
    <>
      <PageHead title={t("admin.usage.title")} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("common.name")}</th><th>{t("admin.usage.conversations")}</th><th>{t("common.credits")}</th>
              <th>{t("admin.usage.revenue")}</th><th>{t("admin.usage.cost")}</th><th>{t("admin.usage.margin")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ c, m }) => (
              <tr key={c.id}>
                <td>{locale === "ar" ? c.branding.displayNameAr : c.name}</td>
                <td>{m.conversations}</td><td>{fmtNum(m.credits, locale, 1)}</td>
                <td>{fmtNum(m.revenueBhd, locale, 2)}</td><td>{fmtNum(m.costBhd, locale, 2)}</td>
                <td><strong>{fmtNum(m.marginBhd, locale, 2)}</strong></td>
              </tr>
            ))}
            <tr>
              <td><strong>Total</strong></td><td>{sum("conversations")}</td><td>{fmtNum(sum("credits"), locale, 1)}</td>
              <td>{fmtNum(sum("revenueBhd"), locale, 2)}</td><td>{fmtNum(sum("costBhd"), locale, 2)}</td>
              <td><strong>{fmtNum(sum("marginBhd"), locale, 2)}</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
      <Notice>{t("admin.usage.note")}</Notice>
    </>
  );
}
