import { describe, expect, it } from "vitest";
import { dailyCounts, lastDays, summarize, toCsv, localDay } from "@/lib/stats";
import type { Conversation } from "@/lib/types";

const NOW = Date.parse("2026-10-21T10:00:00Z");
const mk = (over: Partial<Conversation>): Conversation => ({
  id: "c", tenantId: "t", channel: "website", mode: "voice", language: "en", startedAt: "2026-10-21T08:00:00Z", durationSec: 120, messages: 0,
  outcome: "answered", summary: "", sentiment: "neutral", transcript: [], creditsCharged: 2, costUsd: 0, flags: [], reviewed: false, ...over,
});

describe("stats", () => {
  it("summarizes a period", () => {
    const s = summarize([
      mk({ outcome: "booked", durationSec: 60 }),
      mk({ outcome: "handed_off", durationSec: 180, flags: ["complaint"] }),
      mk({ outcome: "answered", mode: "text", channel: "whatsapp", messages: 10, durationSec: 0, flags: ["lead"] }),
      mk({ outcome: "abandoned", channel: "phone", sentiment: "negative", flags: ["emergency", "complaint"] }),
    ]);
    expect(s).toMatchObject({ total: 4, bookings: 1, handoffs: 1, voiceMinutes: 6, avgDurationSec: 120, credits: 8 });
    expect(s.handledRate).toBe(0.75);
    expect(s.byChannel).toEqual({ website: 2, whatsapp: 1, instagram: 0, phone: 1 });
    expect(s.flags).toEqual({ emergency: 1, complaint: 2, lead: 1 });
    expect(s.bySentiment.negative).toBe(1);
    expect(summarize([]).handledRate).toBe(0);
  });

  it("buckets by Bahrain day, zero-fills, and ends today", () => {
    expect(localDay(Date.parse("2026-10-20T21:30:00Z"))).toBe("2026-10-21"); // 00:30 local
    const d = dailyCounts([mk({ startedAt: "2026-10-20T21:30:00Z" }), mk({ startedAt: "2026-10-19T10:00:00Z" })], 3, NOW);
    expect(d.map((x) => [x.key, x.value])).toEqual([["2026-10-19", 1], ["2026-10-20", 0], ["2026-10-21", 1]]);
    expect(d[2].label).toBe("21/10");
  });

  it("selects the last N days", () => {
    const rows = [mk({ id: "a", startedAt: "2026-10-21T08:00:00Z" }), mk({ id: "b", startedAt: "2026-10-15T08:00:00Z" }), mk({ id: "c", startedAt: "2026-10-10T08:00:00Z" })];
    expect(lastDays(rows, 7, NOW).map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("writes CSV that is safe to open in a spreadsheet", () => {
    expect(toCsv([["a", 'b "q"', "c,d"], ["=SUM(A1)", "+1", 3]])).toBe('a,"b ""q""","c,d"\r\n\'=SUM(A1),\'+1,3\r\n');
  });
});
