import { getT } from "@/lib/i18n";
import { fmtDateTime } from "@/lib/format";
import { getAlerts, getTenant } from "@/lib/store";
import { resolveAlertAction } from "@/lib/actions";
import { Badge, Notice, PageHead } from "@/components/ui";

export default async function AlertsPage() {
  const { t, locale } = await getT();
  const open = getAlerts().filter((a) => !a.resolved);
  return (
    <>
      <PageHead title={t("admin.alerts.title")} />
      {open.length === 0 && <Notice tone="ok">{t("admin.alerts.none")}</Notice>}
      <div className="stack">
        {open.map((a) => (
          <div key={a.id} className="card row" style={{ justifyContent: "space-between" }}>
            <div>
              <Badge tone={a.severity === "error" ? "bad" : a.severity === "warning" ? "warn" : "info"}>{a.severity}</Badge>{" "}
              <strong>{getTenant(a.tenantId)?.name}</strong>
              <div>{a.message}</div>
              <small className="muted">{fmtDateTime(a.at, locale)}</small>
            </div>
            <form action={resolveAlertAction}>
              <input type="hidden" name="id" value={a.id} />
              <button className="btn small ghost">{t("common.resolve")}</button>
            </form>
          </div>
        ))}
      </div>
    </>
  );
}
