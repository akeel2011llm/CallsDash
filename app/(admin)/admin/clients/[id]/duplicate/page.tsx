import Link from "next/link";
import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n";
import { adminDuplicateTenantAction } from "@/lib/actions";
import { getDoctors, getKnowledge, getTenant, listPackages } from "@/lib/data";
import { PlanPicker } from "@/components/PlanPicker";
import { CopyChecklist } from "@/components/CopyChecklist";
import { Guide } from "@/components/Guide";
import { Notice, PageHead } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";

export default async function DuplicateClient({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const { error } = await searchParams;
  const tenant = await getTenant(id);
  if (!tenant) notFound();
  const [{ t, locale }, packages, doctors, knowledge] = await Promise.all([getT(tenant), listPackages(), getDoctors(id), getKnowledge(id)]);
  return (
    <>
      <PageHead
        title={`${t("dup.title")}: ${locale === "ar" ? tenant.branding.displayNameAr || tenant.name : tenant.name}`}
        actions={<Link className="btn ghost" href={`/admin/clients/${id}`}>{t("common.back")}</Link>}
      />
      {(error === "name" || error === "domain" || error === "plan") && <Notice tone="warn">{t(`admin.err.${error}` as "admin.err.name")}</Notice>}
      <form action={adminDuplicateTenantAction} className="card stack" style={{ maxWidth: 560 }}>
        <input type="hidden" name="sourceId" value={id} />
        <p className="muted">{t("dup.help")}</p>
        <label>{t("admin.new.name")}<input name="name" required maxLength={120} autoComplete="off" /></label>
        <label>{t("admin.displayNameAr")}<input name="nameAr" maxLength={120} dir="rtl" /></label>
        <label>{t("admin.new.domain")}<input name="domain" placeholder="clinic.example.bh" maxLength={200} /></label>
        <small className="muted">{t("dup.domainHelp")}</small>
        <label>{t("admin.color")}<input type="color" name="color" defaultValue={tenant.branding.primaryColor} /></label>
        <PlanPicker packages={packages} locale={locale} t={t} />
        <label className="inline"><input type="checkbox" name="copyDoctors" defaultChecked />{t("dup.copyDoctors").replace("{n}", String(doctors.length))}</label>
        <label className="inline"><input type="checkbox" name="copyKnowledge" defaultChecked />{t("dup.copyKnowledge").replace("{n}", String(knowledge.length))}</label>
        <SubmitButton className="btn" type="submit">{t("dup.create")}</SubmitButton>
      </form>
      <div style={{ maxWidth: 560 }}><Guide id="copy"><CopyChecklist t={t} /></Guide></div>
    </>
  );
}
