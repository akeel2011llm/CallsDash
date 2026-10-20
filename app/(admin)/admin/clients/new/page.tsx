import { getT } from "@/lib/i18n";
import { adminCreateTenantAction } from "@/lib/actions";
import { listPackages } from "@/lib/data";
import { PlanPicker } from "@/components/PlanPicker";
import { Notice, PageHead } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";

export default async function NewClient({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const [{ t, locale }, packages] = await Promise.all([getT(), listPackages()]);
  return (
    <>
      <PageHead title={t("admin.new.title")} />
      {(error === "name" || error === "domain" || error === "plan") && <Notice tone="warn">{t(`admin.err.${error}` as "admin.err.name")}</Notice>}
      <form action={adminCreateTenantAction} className="card stack" style={{ maxWidth: 560 }}>
        <p className="muted">{t("admin.new.help")}</p>
        <label>{t("admin.new.name")}<input name="name" required maxLength={120} /></label>
        <label>{t("admin.displayNameAr")}<input name="nameAr" maxLength={120} dir="rtl" /></label>
        <label>{t("admin.new.domain")}<input name="domain" placeholder="clinic.example.bh" maxLength={200} /></label>
        <label>{t("admin.color")}<input type="color" name="color" defaultValue="#0e7c86" /></label>
        <PlanPicker packages={packages} locale={locale} t={t} />
        <SubmitButton className="btn" type="submit">{t("admin.new.create")}</SubmitButton>
      </form>
    </>
  );
}
