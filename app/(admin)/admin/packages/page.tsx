import { getT } from "@/lib/i18n";
import { fmtNum } from "@/lib/format";
import { listPackages, listTenants } from "@/lib/data";
import { adminArchivePackageAction, adminSavePackageAction } from "@/lib/actions";
import { Badge, Notice, PageHead } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import type { CatalogPackage } from "@/lib/types";

export default async function PackagesPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { saved, error } = await searchParams;
  const [{ t, locale }, packages, tenants] = await Promise.all([getT(), listPackages(), listTenants()]);
  const inUse = (id: string) => tenants.filter((c) => c.plans.some((p) => p.active && p.packageId === id)).length;
  const blank: CatalogPackage = { id: "", name: "", nameAr: "", description: "", type: "package", includedCredits: 1000, monthlyPriceBhd: 0, pricePerCreditBhd: 0.08, rolloverCap: 0.5, archived: false };
  return (
    <>
      <PageHead title={t("packages.title")} />
      <p className="muted">{t("packages.help")}</p>
      {saved && <Notice tone="ok">{t("packages.saved")}</Notice>}
      {(error === "invalid" || error === "name") && <Notice tone="warn">{t(`packages.err.${error}` as "packages.err.name")}</Notice>}
      {packages.map((p) => (
        <details key={p.id} className="card">
          <summary className="row" style={{ justifyContent: "space-between", cursor: "pointer" }}>
            <span>
              <strong>{locale === "ar" && p.nameAr ? p.nameAr : p.name}</strong>{" "}
              <Badge>{t(`packages.type.${p.type}` as "packages.type.package")}</Badge>{" "}
              {p.archived && <Badge tone="warn">{t("packages.archived")}</Badge>}
            </span>
            <span className="muted">
              {p.type === "package" ? `${fmtNum(p.includedCredits, locale, 0)} ${t("packages.creditsWord")} · ` : ""}
              BHD {fmtNum(p.monthlyPriceBhd, locale, 0)} {t("packages.perMonth")} · {inUse(p.id)} {t("nav.clients")}
            </span>
          </summary>
          <PackageForm p={p} t={t} />
          <form action={adminArchivePackageAction} className="row">
            <input type="hidden" name="id" value={p.id} />
            <input type="hidden" name="archived" value={p.archived ? "0" : "1"} />
            <SubmitButton className="btn small ghost" type="submit">{p.archived ? t("packages.restore") : t("packages.archive")}</SubmitButton>
          </form>
        </details>
      ))}
      <details className="card" open={packages.length === 0}>
        <summary style={{ cursor: "pointer" }}><strong>{t("packages.new")}</strong></summary>
        <PackageForm p={blank} t={t} />
      </details>
    </>
  );
}

function PackageForm({ p, t }: { p: CatalogPackage; t: (k: import("@/lib/i18n").Key) => string }) {
  return (
    <form action={adminSavePackageAction} className="stack" style={{ marginBlock: 12 }}>
      <input type="hidden" name="id" value={p.id} />
      <div className="row">
        <label style={{ flex: 1 }}>{t("packages.name")}<input name="name" defaultValue={p.name} required maxLength={80} /></label>
        <label style={{ flex: 1 }}>{t("packages.nameAr")}<input name="nameAr" defaultValue={p.nameAr} maxLength={80} dir="rtl" /></label>
      </div>
      <label>{t("packages.description")}<input name="description" defaultValue={p.description} maxLength={300} /></label>
      <div className="row">
        <label style={{ flex: 1 }}>{t("packages.type")}
          <select name="type" defaultValue={p.type}>
            <option value="package">{t("packages.type.package")}</option>
            <option value="payg">{t("packages.type.payg")}</option>
          </select>
        </label>
        <label style={{ flex: 1 }}>{t("packages.credits")}<input name="includedCredits" type="number" min="0" step="1" defaultValue={p.includedCredits} /></label>
        <label style={{ flex: 1 }}>{t("packages.rollover")}<input name="rolloverPercent" type="number" min="0" max="100" step="1" defaultValue={Math.round(p.rolloverCap * 100)} /></label>
      </div>
      <div className="row">
        <label style={{ flex: 1 }}>{t("packages.fee")}<input name="monthlyPriceBhd" type="number" min="0" step="0.001" defaultValue={p.monthlyPriceBhd} required /></label>
        <label style={{ flex: 1 }}>{t("packages.perCredit")}<input name="pricePerCreditBhd" type="number" min="0" step="0.0001" defaultValue={p.pricePerCreditBhd} required /></label>
      </div>
      <div><SubmitButton className="btn" type="submit">{t("common.save")}</SubmitButton></div>
    </form>
  );
}
