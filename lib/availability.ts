/** Slot search for appointment booking. Pure functions: calendar and booking lookups happen in lib/booking.ts. */

export const LOCAL_OFFSET_MIN = 180; // Asia/Bahrain, UTC+3, no daylight saving
const DAY_MS = 86_400_000;

export type OpeningHours = Record<string, [string, string][]>;

/** Sat to Thu 08:00 to 21:00, Friday 16:00 to 21:00. Clinics change this per client. */
export const DEFAULT_OPENING_HOURS: OpeningHours = {
  "0": [["08:00", "21:00"]], "1": [["08:00", "21:00"]], "2": [["08:00", "21:00"]], "3": [["08:00", "21:00"]],
  "4": [["08:00", "21:00"]], "5": [["16:00", "21:00"]], "6": [["08:00", "21:00"]],
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Validates opening hours typed in the dashboard: up to two intervals per weekday, "HH:MM", opening before closing,
 * no overlap. Returns the cleaned hours, or null when anything is malformed. A missing or empty day means closed.
 */
export function cleanOpeningHours(input: Record<string, [string, string][] | undefined>): OpeningHours | null {
  const out: OpeningHours = {};
  for (let d = 0; d < 7; d++) {
    const list = (input[String(d)] ?? []).filter(([a, b]) => a || b);
    if (list.length > 2) return null;
    let prevEnd = -1;
    const day: [string, string][] = [];
    for (const [a, b] of [...list].sort((x, y) => x[0].localeCompare(y[0]))) {
      if (!TIME.test(a) || !TIME.test(b) || hm(a) >= hm(b) || hm(a) < prevEnd) return null;
      prevEnd = hm(b);
      day.push([a, b]);
    }
    out[String(d)] = day;
  }
  return out;
}

const localParts = (ms: number) => {
  const l = new Date(ms + LOCAL_OFFSET_MIN * 60_000);
  return { weekday: l.getUTCDay(), minutes: l.getUTCHours() * 60 + l.getUTCMinutes() };
};

export function isOpenAt(hours: OpeningHours, ms: number): boolean {
  const { weekday, minutes } = localParts(ms);
  return (hours[String(weekday)] ?? []).some(([a, b]) => minutes >= hm(a) && minutes < hm(b));
}

/** The next time the clinic opens after `ms` (within a week), as an ISO instant, or null if it never opens. */
export function nextOpening(hours: OpeningHours, ms: number): string | null {
  const localMidnight = Math.floor((ms + LOCAL_OFFSET_MIN * 60_000) / DAY_MS) * DAY_MS - LOCAL_OFFSET_MIN * 60_000;
  for (let i = 0; i < 8; i++) {
    const day = localMidnight + i * DAY_MS;
    const weekday = new Date(day + LOCAL_OFFSET_MIN * 60_000).getUTCDay();
    for (const [a] of [...(hours[String(weekday)] ?? [])].sort()) {
      const t = day + hm(a) * 60_000;
      if (t > ms) return new Date(t).toISOString();
    }
  }
  return null;
}

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
