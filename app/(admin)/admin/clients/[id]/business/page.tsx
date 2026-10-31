import Link from "next/link";
import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n";
import { Notice, PageHead } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { Fold } from "@/components/Fold";
import { FoldControls } from "@/components/FoldControls";
import { getTenant } from "@/lib/data";
import { adminTenantSettingsAction } from "@/lib/actions";
import { adminClientProfileAction, adminBusinessAction } from "@/lib/manage-actions";
import { BusinessFields } from "@/components/BusinessFields";
import { ContactForm } from "@/components/ContactForm";
import { businessOf, vocabOf } from "@/lib/business-types";
import { EXTRA_TARGETS, extraFieldsOf } from "@/lib/extra-fields";
import { ExtraFieldsDesigner } from "@/components/ExtraFields";
import { dictionaries, type Key } from "@/lib/i18n";

export default async function ClientBusiness({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; error?: string; err?: string; who?: string; target?: string }> }) {
  const { id } = await params;
  const { saved, error, err, who, target } = await searchParams;
  const tenant = await getTenant(id);
  if (!tenant) notFound();
  const { t, locale } = await getT(tenant);
  // the business type's own texts must not be reworded by the type they describe
  const { t: plain } = await getT();
  const biz = businessOf(tenant);
  const words = vocabOf(tenant, locale);
  const returnTo = `/admin/clients/${id}/business`;
  return (
    <>
      {(error === "name" || error === "domain") && <Notice tone="warn">{t(`admin.err.${error}` as "admin.err.name")}</Notice>}
      {saved === "business" && <Notice tone="ok">{plain("biz.saved")}</Notice>}
      {err === "role_in_use" && <Notice tone="warn">{plain("biz.err.role_in_use").replace("{who}", (who ?? "").slice(0, 60))}</Notice>}
      {err === "id_name" && <Notice tone="warn">{plain("biz.err.id_name")}</Notice>}
      {saved === "fields" && <Notice tone="ok">{t("fields.saved")}</Notice>}
      {err?.startsWith("fields_") && `${err.replace("fields_", "fields.err.")}` in dictionaries.en && <Notice tone="warn">{t(err.replace("fields_", "fields.err.") as Key).replace("{who}", (who ?? "").slice(0, 60))}</Notice>}
      {saved && saved !== "business" && <Notice tone="ok">{t("agent.saved").split(".")[0]}.</Notice>}
      <PageHead title={t("ws.business")} actions={<Link className="btn ghost" href={`/admin/clients/${id}/business/branding`}>{t("brand.open")}</Link>} />
      <FoldControls openAll={t("fold.openAll")} closeAll={t("fold.closeAll")} />
      <div className="grid two fold-grid">
      <Fold id="profile" open title={t("admin.profile")}>
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
      <Fold id="business" open={saved === "business" || err === "role_in_use" || err === "id_name"} title={plain("biz.title")} hint={plain(`biz.type.${biz.type}`)}>
        <form action={adminBusinessAction} className="stack">
          <input type="hidden" name="tenantId" value={id} /><input type="hidden" name="returnTo" value={returnTo} />
          <small className="muted">{plain("biz.help")}</small>
          <BusinessFields t={plain} business={biz} />
          <Notice>{plain("biz.preview").replace("{staff}", words.staffMany).replace("{customers}", words.customerMany).replace("{place}", words.place)}</Notice>
          <small className="muted">{plain("biz.assistantNote")}</small>
          <SubmitButton className="btn" type="submit">{plain("common.save")}</SubmitButton>
        </form>
      </Fold>
      {EXTRA_TARGETS.map((x) => (
        <ExtraFieldsDesigner key={x} tenantId={id} target={x} fields={extraFieldsOf(tenant, x)} t={t} open={target === x} />
      ))}
      <Fold id="contact" open={saved === "details" || error === "domain"} title={t("ws.contact")}>
        <ContactForm tenant={tenant} t={t} returnTo={returnTo} />
      </Fold>
      <Fold id="settings" title={t("ws.domains")}>
        <form action={adminTenantSettingsAction} className="stack">
          <input type="hidden" name="tenantId" value={id} /><input type="hidden" name="returnTo" value={returnTo} />
          <label>{t("admin.allowedDomains")}<input name="allowedDomains" defaultValue={tenant.allowedDomains.join(", ")} dir="ltr" /></label>
          <small className="muted">{t("ws.domains.help")}</small>
          <SubmitButton className="btn" type="submit">{t("common.save")}</SubmitButton>
        </form>
      </Fold>
      </div>
    </>
  );
}
