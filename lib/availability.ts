/** Slot search for appointment booking. Pure functions: calendar and booking lookups happen in lib/booking.ts. */

export const LOCAL_OFFSET_MIN = 180; // Asia/Bahrain, UTC+3, no daylight saving
const DAY_MS = 86_400_000;

export type OpeningHours = Record<string, [string, string][]>;

/** Sat to Thu 08:00 to 21:00, Friday 16:00 to 21:00. Clinics change this per client. */
export const DEFAULT_OPENING_HOURS: OpeningHours = {
  "0": [["08:00", "21:00"]], "1": [["08:00", "21:00"]], "2": [["08:00", "21:00"]], "3": [["08:00", "21:00"]],
  "4": [["08:00", "21:00"]], "5": [["16:00", "21:00"]], "6": [["08:00", "21:00"]],
};

export interface Busy { start: number; end: number } // epoch ms

const hm = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};

export function computeSlots(p: {
  openingHours: OpeningHours;
  busy: Busy[];
  fromMs: number;
  toMs: number;
  durationMin: number;
  stepMin?: number;
  nowMs: number;
  minLeadMin?: number;
  limit?: number;
}): string[] {
  const step = p.stepMin ?? p.durationMin;
  const earliest = Math.max(p.fromMs, p.nowMs + (p.minLeadMin ?? 30) * 60_000);
  const out: string[] = [];
  // walk local calendar days; localMidnight is the UTC instant of 00:00 local time
  let localMidnight = Math.floor((p.fromMs + LOCAL_OFFSET_MIN * 60_000) / DAY_MS) * DAY_MS - LOCAL_OFFSET_MIN * 60_000;
  for (; localMidnight < p.toMs; localMidnight += DAY_MS) {
    const weekday = new Date(localMidnight + LOCAL_OFFSET_MIN * 60_000).getUTCDay();
    for (const [open, close] of p.openingHours[String(weekday)] ?? []) {
      for (let m = hm(open); m + p.durationMin <= hm(close); m += step) {
        const start = localMidnight + m * 60_000;
        const end = start + p.durationMin * 60_000;
        if (start < earliest || start >= p.toMs) continue;
        if (p.busy.some((b) => start < b.end && end > b.start)) continue;
        out.push(new Date(start).toISOString());
        if (p.limit && out.length >= p.limit) return out;
      }
    }
  }
  return out;
}

/** True when a specific start time is an offered, still-free slot. */
export function isSlotFree(p: Omit<Parameters<typeof computeSlots>[0], "fromMs" | "toMs" | "limit"> & { startMs: number }): boolean {
  return computeSlots({ ...p, fromMs: p.startMs, toMs: p.startMs + 1 }).includes(new Date(p.startMs).toISOString());
}

/** Human phrase for the agent, in the clinic's local time: "Wednesday 21 October, 10:30". */
export function describeSlot(iso: string, locale: "en" | "ar"): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-BH-u-nu-latn" : "en-GB", {
    weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bahrain",
  }).format(new Date(iso));
}
