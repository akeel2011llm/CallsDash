import { describe, expect, it } from "vitest";
import { DEFAULT_OPENING_HOURS, cleanOpeningHours, computeSlots, isOpenAt, isSlotFree, nextOpening } from "@/lib/availability";

// Wednesday 2026-10-21, 06:00 UTC = 09:00 in Bahrain
const hour = (iso: string) => new Date(new Date(iso).getTime() + 3 * 3_600_000).toISOString().slice(11, 16);
const base = { openingHours: DEFAULT_OPENING_HOURS, durationMin: 30, nowMs: Date.parse("2026-10-21T00:00:00Z") };

describe("computeSlots", () => {
  it("offers half-hour slots inside opening hours, in local time", () => {
    const s = computeSlots({ ...base, busy: [], fromMs: Date.parse("2026-10-21T00:00:00Z"), toMs: Date.parse("2026-10-21T21:00:00Z") });
    expect(hour(s[0])).toBe("08:00");
    expect(hour(s[s.length - 1])).toBe("20:30");
    expect(s).toHaveLength(26);
  });

  it("skips busy intervals and respects the minimum lead time", () => {
    const busy = [{ start: Date.parse("2026-10-21T05:00:00Z"), end: Date.parse("2026-10-21T06:00:00Z") }]; // 08:00-09:00 local
    const s = computeSlots({ ...base, busy, nowMs: Date.parse("2026-10-21T05:45:00Z"), fromMs: Date.parse("2026-10-21T00:00:00Z"), toMs: Date.parse("2026-10-21T21:00:00Z") });
    // now = 08:45 local, lead 30 min: first slot at or after 09:15 local -> 09:30
    expect(hour(s[0])).toBe("09:30");
  });

  it("uses Friday's shorter hours", () => {
    const s = computeSlots({ ...base, busy: [], fromMs: Date.parse("2026-10-23T00:00:00Z"), toMs: Date.parse("2026-10-23T21:00:00Z") });
    expect(hour(s[0])).toBe("16:00");
    expect(s).toHaveLength(10);
  });

  it("returns nothing on a closed day and honours the limit", () => {
    const closed = { ...DEFAULT_OPENING_HOURS, "3": [] as [string, string][] };
    expect(computeSlots({ ...base, openingHours: closed, busy: [], fromMs: Date.parse("2026-10-21T00:00:00Z"), toMs: Date.parse("2026-10-21T21:00:00Z") })).toEqual([]);
    expect(computeSlots({ ...base, busy: [], fromMs: Date.parse("2026-10-21T00:00:00Z"), toMs: Date.parse("2026-10-28T00:00:00Z"), limit: 3 })).toHaveLength(3);
  });

  it("does not offer a slot that would overlap the next appointment", () => {
    const busy = [{ start: Date.parse("2026-10-21T06:15:00Z"), end: Date.parse("2026-10-21T06:45:00Z") }];
    const s = computeSlots({ ...base, durationMin: 30, busy, fromMs: Date.parse("2026-10-21T06:00:00Z"), toMs: Date.parse("2026-10-21T08:00:00Z") });
    expect(s.map(hour)).not.toContain("09:00"); // 06:00Z = 09:00 local overlaps 09:15-09:45
    expect(s.map(hour)).toContain("10:00");
  });
});

describe("isSlotFree", () => {
  it("accepts offered slots and rejects off-grid, busy or closed times", () => {
    const p = { ...base, busy: [{ start: Date.parse("2026-10-21T07:00:00Z"), end: Date.parse("2026-10-21T07:30:00Z") }] };
    expect(isSlotFree({ ...p, startMs: Date.parse("2026-10-21T06:30:00Z") })).toBe(true);
    expect(isSlotFree({ ...p, startMs: Date.parse("2026-10-21T07:00:00Z") })).toBe(false); // busy
    expect(isSlotFree({ ...p, startMs: Date.parse("2026-10-21T06:10:00Z") })).toBe(false); // off the 30-min grid
    expect(isSlotFree({ ...p, startMs: Date.parse("2026-10-21T01:00:00Z") })).toBe(false); // 04:00 local, closed
  });
});

describe("opening hours editing", () => {
  const day = (...r: [string, string][]) => r;
  it("accepts a split shift and treats empty days as closed", () => {
    const h = cleanOpeningHours({ "0": day(["16:00", "21:00"], ["08:00", "13:00"]), "5": [] })!;
    expect(h["0"]).toEqual([["08:00", "13:00"], ["16:00", "21:00"]]);
    expect(h["5"]).toEqual([]);
    expect(h["3"]).toEqual([]);
  });
  it("rejects bad, reversed, overlapping or too many intervals", () => {
    for (const bad of [day(["8:00", "13:00"]), day(["13:00", "08:00"]), day(["08:00", "13:00"], ["12:00", "15:00"]), day(["08:00", "09:00"], ["10:00", "11:00"], ["12:00", "13:00"]), day(["08:00", "25:00"])])
      expect(cleanOpeningHours({ "1": bad })).toBeNull();
  });
  it("knows if the clinic is open and when it opens next (local time)", () => {
    expect(isOpenAt(DEFAULT_OPENING_HOURS, Date.parse("2026-10-21T07:00:00Z"))).toBe(true); // Wed 10:00
    expect(isOpenAt(DEFAULT_OPENING_HOURS, Date.parse("2026-10-21T00:00:00Z"))).toBe(false); // Wed 03:00
    expect(nextOpening(DEFAULT_OPENING_HOURS, Date.parse("2026-10-21T00:00:00Z"))).toBe("2026-10-21T05:00:00.000Z"); // Wed 08:00
    expect(nextOpening(DEFAULT_OPENING_HOURS, Date.parse("2026-10-23T19:00:00Z"))).toBe("2026-10-24T05:00:00.000Z"); // Fri 22:00 -> Sat 08:00
    expect(nextOpening({ "0": [], "1": [], "2": [], "3": [], "4": [], "5": [], "6": [] }, Date.parse("2026-10-21T00:00:00Z"))).toBeNull();
  });
});
