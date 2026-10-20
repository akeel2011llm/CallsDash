import type { CatalogPackage, Plan } from "./types";

/**
 * Starting points offered when adding a plan to a client. Prices are the proposed ones from the pricing model
 * and can be edited per client in the form.
 */
export const PLAN_PRESETS = {
  clinic: { type: "package", name: "Clinic package", includedCredits: 2500, monthlyPriceBhd: 199, pricePerCreditBhd: 0.08, rolloverCap: 0.5 },
  addon: { type: "package", name: "Extra credits bundle", includedCredits: 1000, monthlyPriceBhd: 80, pricePerCreditBhd: 0.08, rolloverCap: 0.5 },
  payg: { type: "payg", name: "Pay as you go", includedCredits: 0, monthlyPriceBhd: 20, pricePerCreditBhd: 0.11, rolloverCap: 0 },
} as const satisfies Record<string, Omit<Plan, "id" | "active" | "periodStart">>;

export type PlanInput = Omit<Plan, "id" | "active" | "periodStart">;

/**
 * Reads the plan column. Older rows hold one plan object without id or active flag; newer rows hold an array.
 * A legacy plan gets the stable id "plan-1" so batches and renewals can refer to it.
 */
export function normalizePlans(raw: unknown): Plan[] {
  const list = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Partial<Plan>[];
  return list.map((p, i) => ({
    ...(p as Plan),
    id: p.id ?? `plan-${i + 1}`,
    active: p.active ?? true,
  }));
}

/** The package that adopts credit batches created before multi-package support. */
export const firstPackage = (plans: Plan[]) => plans.find((p) => p.type === "package");

export const planNames = (plans: Plan[]) => plans.filter((p) => p.active).map((p) => p.name).join(" + ") || "–";

/** Clamp admin input to sane values. */
export function cleanPlanInput(i: Partial<PlanInput>): PlanInput | null {
  const type = i.type === "payg" ? "payg" : "package";
  const name = String(i.name ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const credits = Math.round(Number(i.includedCredits));
  const fee = Number(i.monthlyPriceBhd);
  const per = Number(i.pricePerCreditBhd);
  if (!name || !(fee >= 0) || fee > 100_000 || !(per >= 0) || per > 1000) return null;
  if (type === "package" && !(credits > 0 && credits <= 10_000_000)) return null;
  return {
    type, name, includedCredits: type === "package" ? credits : 0, monthlyPriceBhd: fee, pricePerCreditBhd: per,
    rolloverCap: type === "package" ? Math.min(1, Math.max(0, Number(i.rolloverCap ?? 0.5) || 0)) : 0,
  };
}

/** Packages offered until AqeelLLM edits the catalogue. */
export const DEFAULT_CATALOGUE: Omit<CatalogPackage, "id" | "archived">[] = [
  { ...PLAN_PRESETS.clinic, nameAr: "باقة العيادة", description: "Monthly package with 2,500 credits, 50% rollover, extra credits at BHD 0.08." },
  { ...PLAN_PRESETS.addon, nameAr: "باقة رصيد إضافية", description: "Second package for a client who needs more room, for example a second branch or a busy season." },
  { ...PLAN_PRESETS.payg, nameAr: "ادفع حسب الاستخدام", description: "BHD 20 dashboard fee, then prepaid credits at BHD 0.11." },
];

/** Validates a catalogue entry coming from the admin form. */
export function cleanCatalogInput(i: Partial<CatalogPackage>): (PlanInput & { nameAr: string; description: string }) | null {
  const base = cleanPlanInput(i);
  if (!base) return null;
  return { ...base, nameAr: String(i.nameAr ?? "").replace(/\s+/g, " ").trim().slice(0, 80), description: String(i.description ?? "").trim().slice(0, 300) };
}
