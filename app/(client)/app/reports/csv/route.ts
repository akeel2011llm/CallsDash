import { requireClient } from "@/lib/auth";
import { getConversations } from "@/lib/data";
import { lastDays } from "@/lib/stats";
import { formatOf, sheetResponse } from "@/lib/sheet";

export const dynamic = "force-dynamic";

/** The report's conversations as a spreadsheet: CSV, or Excel with ?format=xlsx. */
export async function GET(req: Request) {
  const { tenant } = await requireClient();
  const days = [7, 30, 90].find((d) => String(d) === new URL(req.url).searchParams.get("days")) ?? 30;
  const rows = lastDays(await getConversations(tenant.id), days, Date.now())
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map((c) => [c.startedAt, c.channel, c.mode, c.language, c.outcome, c.sentiment, c.durationSec, c.messages, c.creditsCharged, c.flags.join(" "), c.reviewed ? "yes" : "no", c.summary]);
  return sheetResponse(
    [["started_at", "channel", "mode", "language", "outcome", "sentiment", "duration_sec", "messages", "credits", "flags", "reviewed", "summary"], ...rows],
    `${tenant.slug}-report-${days}d`, formatOf(req.url), { sheet: `report ${days} days` },
  );
}
