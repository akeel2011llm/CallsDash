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
import { businessOf, vocabOf } from "@/lib/business-types";

export default async function ClientBusiness({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { id } = await params;
  const { saved, error } = await searchParams;
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
      {saved && saved !== "business" && <Notice tone="ok">{t("agent.saved").split(".")[0]}.</Notice>}
      <PageHead title={t("ws.business")} />
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
      <Fold id="settings" title={t("admin.branding")}>
        <form action={adminTenantSettingsAction} className="stack">
          <input type="hidden" name="tenantId" value={id} /><input type="hidden" name="returnTo" value={returnTo} />
          <label>{t("admin.displayName")}<input name="displayName" defaultValue={tenant.branding.displayName} /></label>
          <label>{t("admin.displayNameAr")}<input name="displayNameAr" defaultValue={tenant.branding.displayNameAr} dir="rtl" /></label>
          <label>{t("admin.color")}<input type="color" name="primaryColor" defaultValue={tenant.branding.primaryColor} /></label>
          <small><Link href={`/admin/clients/${id}/business/branding`}>{t("brand.open")}</Link></small>
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
      </div>
      <p><Link className="btn ghost" href={`/admin/clients/${id}/business/branding`}>{t("brand.open")}</Link></p>
    </>
  );
}
