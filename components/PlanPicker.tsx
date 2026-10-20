import type { CatalogPackage, Locale } from "@/lib/types";
import { fmtNum } from "@/lib/format";
import type { Key } from "@/lib/i18n";

type T = (k: Key) => string;

/** One-line summary of a package for a dropdown: "Clinic package: 2,500 credits, BHD 199 per month". */
export function packageLabel(p: CatalogPackage, locale: Locale, t: T) {
  const name = locale === "ar" && p.nameAr ? p.nameAr : p.name;
  return p.type === "package"
    ? `${name}: ${fmtNum(p.includedCredits, locale, 0)} ${t("packages.creditsWord")}, BHD ${fmtNum(p.monthlyPriceBhd, locale, 0)} ${t("packages.perMonth")}`
    : `${name}: BHD ${fmtNum(p.monthlyPriceBhd, locale, 0)} + BHD ${p.pricePerCreditBhd} / ${t("packages.creditsWord")}`;
}

/** The "which package?" fields shared by "create client" and "add a package to a client". */
export function PlanPicker({ packages, locale, t }: { packages: CatalogPackage[]; locale: Locale; t: T }) {
  const live = packages.filter((p) => !p.archived);
  return (
    <>
      <label>{t("plans.choose")}
        <select name="packageId" required defaultValue={live[0]?.id}>
          {live.map((p) => <option key={p.id} value={p.id}>{packageLabel(p, locale, t)}</option>)}
        </select>
      </label>
      <label>{t("plans.contractRef")}<input name="contractRef" maxLength={120} /></label>
      <div className="row">
        <label style={{ flex: 1 }}>{t("plans.feeOverride")}<input name="monthlyPriceBhd" type="number" min="0" step="0.001" /></label>
        <label style={{ flex: 1 }}>{t("plans.perCreditOverride")}<input name="pricePerCreditBhd" type="number" min="0" step="0.0001" /></label>
      </div>
      <small className="muted">{t("plans.overrideHelp")}</small>
    </>
  );
}
