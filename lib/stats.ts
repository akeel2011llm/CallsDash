import { round2 } from "./credits";
import type { Channel, Conversation, FlagKind, Outcome } from "./types";

const DAY = 86_400_000;
const OFFSET = 3 * 3_600_000; // Asia/Bahrain
/** Calendar day (Bahrain time) of an instant, as "YYYY-MM-DD". */
export const localDay = (ms: number) => new Date(ms + OFFSET).toISOString().slice(0, 10);

export interface Summary {
  total: number;
  voiceMinutes: number;
  bookings: number;
  handoffs: number;
  avgDurationSec: number;
  /** Share of conversations that ended without a hand-off to staff (0..1). */
  handledRate: number;
  credits: number;
  byChannel: Record<Channel, number>;
  byOutcome: Record<Outcome, number>;
  bySentiment: Record<Conversation["sentiment"], number>;
  flags: Record<FlagKind, number>;
}

export function summarize(convs: Conversation[]): Summary {
  const s: Summary = {
    total: convs.length, voiceMinutes: 0, bookings: 0, handoffs: 0, avgDurationSec: 0, handledRate: 0, credits: 0,
    byChannel: { website: 0, whatsapp: 0, instagram: 0, phone: 0 },
    byOutcome: { booked: 0, answered: 0, handed_off: 0, abandoned: 0 },
    bySentiment: { positive: 0, neutral: 0, negative: 0 },
    flags: { emergency: 0, complaint: 0, lead: 0 },
  };
  let voiceSec = 0, voiceCalls = 0;
  for (const c of convs) {
    s.byChannel[c.channel]++;
    s.byOutcome[c.outcome]++;
    s.bySentiment[c.sentiment]++;
    s.credits += c.creditsCharged;
    for (const f of c.flags) s.flags[f]++;
    if (c.mode === "voice") { voiceSec += c.durationSec; voiceCalls++; }
  }
  s.voiceMinutes = round2(voiceSec / 60);
  s.bookings = s.byOutcome.booked;
  s.handoffs = s.byOutcome.handed_off;
  s.avgDurationSec = voiceCalls ? Math.round(voiceSec / voiceCalls) : 0;
  s.handledRate = convs.length ? (convs.length - s.handoffs) / convs.length : 0;
  s.credits = round2(s.credits);
  return s;
}

/** One entry per day for the last `days` days ending today, oldest first, zero-filled. */
export function dailyCounts(convs: Conversation[], days: number, nowMs: number): { key: string; label: string; value: number }[] {
  const counts = new Map<string, number>();
  for (const c of convs) counts.set(localDay(Date.parse(c.startedAt)), (counts.get(localDay(Date.parse(c.startedAt))) ?? 0) + 1);
  return Array.from({ length: days }, (_, i) => {
    const key = localDay(nowMs - (days - 1 - i) * DAY);
    return { key, label: `${Number(key.slice(8))}/${Number(key.slice(5, 7))}`, value: counts.get(key) ?? 0 };
  });
}

export const since = (days: number, nowMs: number) => localDay(nowMs - (days - 1) * DAY);
/** Conversations whose Bahrain-local day falls in the last `days` days. */
export const lastDays = (convs: Conversation[], days: number, nowMs: number) => {
  const from = since(days, nowMs);
  return convs.filter((c) => localDay(Date.parse(c.startedAt)) >= from);
};

const csvCell = (v: string | number) => {
  const s = String(v);
  // a leading = + - @ would run as a formula when the file is opened in a spreadsheet
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export const toCsv = (rows: (string | number)[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
