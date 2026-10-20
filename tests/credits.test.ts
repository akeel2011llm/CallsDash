import { describe, expect, it } from "vitest";
import {
  addMonths,
  addTopUp,
  balance,
  creditsFor,
  deduct,
  lowBalance,
  renewPackage,
  revenuePerCredit,
  sweepExpired,
  topUpKind,
} from "@/lib/credits";
import type { CreditBatch, Plan } from "@/lib/types";

const plan: Plan = {
  id: "plan-1",
  active: true,
  type: "package",
  name: "Clinic package",
  includedCredits: 2500,
  monthlyPriceBhd: 199,
  pricePerCreditBhd: 0.08,
  rolloverCap: 0.5,
  periodStart: "2026-10-01T00:00:00.000Z",
};
const T = "t1";
const now = new Date("2026-10-15T00:00:00.000Z");

describe("creditsFor", () => {
  it("bills voice per second and text per 20 messages", () => {
    expect(creditsFor({ mode: "voice", durationSec: 90, messages: 0 })).toBe(1.5);
    expect(creditsFor({ mode: "text", durationSec: 0, messages: 10 })).toBe(0.5);
  });
});

describe("addMonths", () => {
  it("clamps to the end of shorter months", () => {
    expect(addMonths("2026-01-31T00:00:00.000Z", 1)).toBe("2026-02-28T00:00:00.000Z");
    expect(addMonths("2026-10-19T10:00:00.000Z", 12)).toBe("2027-10-19T10:00:00.000Z");
  });
});

describe("deduct", () => {
  it("uses rollover first, then package, then top-ups oldest first", () => {
    let b: CreditBatch[] = [];
    b = addTopUp(b, { id: "tu2", tenantId: T, amount: 100, now: new Date("2026-09-10T00:00:00Z") });
    b = addTopUp(b, { id: "tu1", tenantId: T, amount: 100, now: new Date("2026-08-10T00:00:00Z") });
    const r = renewPackage(b, { tenantId: T, plan, periodStart: "2026-10-01T00:00:00.000Z", ids: { rollover: "ro", package: "pk" } });
    const d = deduct(r.batches, 150, now);
    expect(d.shortfall).toBe(0);
    expect(d.allocations).toEqual([{ batchId: "pk", amount: 150 }]);

    // with a rollover batch present it is drained before the package batch
    const withRoll = renewPackage(
      [{ id: "old", tenantId: T, kind: "package", amount: 2500, remaining: 400, purchasedAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-10-01T00:00:00.000Z" }, ...b],
      { tenantId: T, plan, periodStart: "2026-10-01T00:00:00.000Z", ids: { rollover: "ro", package: "pk" } },
    );
    const d2 = deduct(withRoll.batches, 450, now);
    expect(d2.allocations).toEqual([
      { batchId: "ro", amount: 400 },
      { batchId: "pk", amount: 50 },
    ]);
    // top-ups: oldest (tu1) before newer (tu2)
    const d3 = deduct(b, 150, now);
    expect(d3.allocations).toEqual([
      { batchId: "tu1", amount: 100 },
      { batchId: "tu2", amount: 50 },
    ]);
  });

  it("reports a shortfall when credits run out", () => {
    const b = addTopUp([], { id: "a", tenantId: T, amount: 10, now });
    const d = deduct(b, 12.5, now);
    expect(d.shortfall).toBe(2.5);
    expect(balance(d.batches, now)).toBe(0);
  });

  it("ignores expired batches", () => {
    const b = addTopUp([], { id: "a", tenantId: T, amount: 10, now: new Date("2025-01-01T00:00:00Z") });
    expect(balance(b, now)).toBe(0);
    expect(deduct(b, 1, now).shortfall).toBe(1);
  });
});

describe("renewPackage rollover", () => {
  const prev = (remaining: number): CreditBatch => ({
    id: "old", tenantId: T, kind: "package", amount: 2500, remaining,
    purchasedAt: "2026-09-01T00:00:00.000Z", expiresAt: "2026-10-01T00:00:00.000Z",
  });
  const ids = { rollover: "ro", package: "pk" };

  it("carries over at most 50% of the included credits", () => {
    const r = renewPackage([prev(2000)], { tenantId: T, plan, periodStart: "2026-10-01T00:00:00.000Z", ids });
    expect(r.carried).toBe(1250);
    expect(r.lapsed).toBe(750);
    expect(balance(r.batches, now)).toBe(1250 + 2500);
  });

  it("carries everything when under the cap", () => {
    const r = renewPackage([prev(300)], { tenantId: T, plan, periodStart: "2026-10-01T00:00:00.000Z", ids });
    expect(r.carried).toBe(300);
    expect(r.lapsed).toBe(0);
  });

  it("never rolls a rollover batch a second time", () => {
    const first = renewPackage([prev(300)], { tenantId: T, plan, periodStart: "2026-10-01T00:00:00.000Z", ids });
    // spend nothing in October, renew for November
    const second = renewPackage(first.batches, {
      tenantId: T, plan, periodStart: "2026-11-01T00:00:00.000Z", ids: { rollover: "ro2", package: "pk2" },
    });
    // only the October package batch (2500 unused) can roll, capped at 1250; the 300 rollover lapses
    expect(second.carried).toBe(1250);
    expect(second.lapsed).toBe(300 + 1250);
    expect(second.batches.find((b) => b.id === "ro")!.remaining).toBe(0);
  });

  it("leaves top-up batches untouched", () => {
    const b = addTopUp([prev(100)], { id: "tu", tenantId: T, amount: 50, now: new Date("2026-09-15T00:00:00Z") });
    const r = renewPackage(b, { tenantId: T, plan, periodStart: "2026-10-01T00:00:00.000Z", ids });
    expect(r.batches.find((x) => x.id === "tu")!.remaining).toBe(50);
  });
});

describe("expiry and low balance", () => {
  it("sweeps expired top-ups after 12 months", () => {
    const b = addTopUp([], { id: "a", tenantId: T, amount: 40, now: new Date("2025-10-01T00:00:00Z") });
    const s = sweepExpired(b, now);
    expect(s.expired).toBe(40);
    expect(s.batches[0].remaining).toBe(0);
  });

  it("flags low balance at 15% of the included credits", () => {
    const r = renewPackage([], { tenantId: T, plan, periodStart: "2026-10-01T00:00:00.000Z", ids: { rollover: "ro", package: "pk" } });
    expect(lowBalance(r.batches, [plan], 0.15, now).low).toBe(false);
    const spent = deduct(r.batches, 2150, now).batches; // 350 left = 14%
    expect(lowBalance(spent, [plan], 0.15, now).low).toBe(true);
  });

  describe("several packages on one client", () => {
    const addon: Plan = { ...plan, id: "plan-2", name: "Extra bundle", includedCredits: 1000, monthlyPriceBhd: 80 };
    const start = "2026-10-01T00:00:00.000Z";
    const both = () => {
      const a = renewPackage([], { tenantId: T, plan, periodStart: start, ids: { rollover: "ro1", package: "pk1" }, adoptUnowned: true });
      return renewPackage(a.batches, { tenantId: T, plan: addon, periodStart: "2026-10-10T00:00:00.000Z", ids: { rollover: "ro2", package: "pk2" }, adoptUnowned: false }).batches;
    };

    it("pools the credits of every package", () => expect(balance(both(), now)).toBe(3500));

    it("renewing one package leaves the other untouched and rolls over per package cap", () => {
      const spent = deduct(both(), 3000, now).batches; // oldest-expiring package (plan-1) first: 2500 used, then 500 from the add-on
      expect(spent.find((b) => b.id === "pk1")!.remaining).toBe(0);
      expect(spent.find((b) => b.id === "pk2")!.remaining).toBe(500);
      const r = renewPackage(spent, { tenantId: T, plan: addon, periodStart: "2026-11-10T00:00:00.000Z", ids: { rollover: "ro3", package: "pk3" }, adoptUnowned: false });
      expect(r.carried).toBe(500); // capped at 50% of 1,000
      expect(r.batches.find((b) => b.id === "pk1")!.remaining).toBe(0);
      expect(r.batches.find((b) => b.id === "ro3")).toMatchObject({ planId: "plan-2", remaining: 500 });
    });

    it("measures low balance against all live packages, ignoring ended ones", () => {
      const b = both();
      expect(lowBalance(b, [plan, addon], 0.15, now).reference).toBe(3500);
      expect(lowBalance(b, [plan, { ...addon, active: false }], 0.15, now).reference).toBe(2500);
    });

    it("blends the revenue per credit", () => {
      expect(revenuePerCredit([plan, addon])).toBeCloseTo((199 + 80) / 3500, 6);
      expect(revenuePerCredit([plan, { ...addon, active: false }])).toBeCloseTo(199 / 2500, 6);
      expect(topUpKind([plan])).toBe("topup");
      expect(topUpKind([{ ...plan, type: "payg", active: true }])).toBe("payg");
    });
  });
});
