import { getT } from "@/lib/i18n";
import { adminCreateTenantAction } from "@/lib/actions";
import { PageHead } from "@/components/ui";

export default async function NewClient() {
  const { t } = await getT();
  return (
    <>
      <PageHead title={t("admin.new.title")} />
      <form action={adminCreateTenantAction} className="card stack" style={{ maxWidth: 560 }}>
        <p className="muted">{t("admin.new.help")}</p>
        <label>{t("admin.new.name")}<input name="name" required maxLength={120} /></label>
        <label>{t("admin.displayNameAr")}<input name="nameAr" maxLength={120} dir="rtl" /></label>
        <label>{t("admin.new.domain")}<input name="domain" placeholder="clinic.example.bh" maxLength={200} /></label>
        <label>{t("admin.color")}<input type="color" name="color" defaultValue="#0e7c86" /></label>
        <label>{t("admin.plan")}
          <select name="planType">
            <option value="package">Monthly package (BHD 199, 2,500 credits)</option>
            <option value="payg">Pay as you go (BHD 20 + BHD 0.11 per credit)</option>
          </select>
        </label>
        <button className="btn" type="submit">{t("admin.new.create")}</button>
      </form>
    </>
  );
}
