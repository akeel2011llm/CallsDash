import Link from "next/link";
import { requireClient } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDateTime, fmtNum } from "@/lib/format";
import { getBookings, getConversations, getWallet } from "@/lib/data";
import { Badge, Notice, PageHead, Stat } from "@/components/ui";

export default async function Home() {
  const { tenant } = await requireClient();
  const { t, locale } = await getT();
  const w = await getWallet(tenant.id);
  const weekAgo = Date.now() - 7 * 86_400_000;
  const convs = await getConversations(tenant.id);
  const recent = convs.filter((c) => new Date(c.startedAt).getTime() >= weekAgo);
  const upcoming = (await getBookings(tenant.id)).filter((b) => new Date(b.startsAt).getTime() > Date.now() && b.status !== "cancelled");
  return (
    <>
      <PageHead title={t("home.title")} />
      {w.low && <Notice tone="warn">{t("home.lowBalance")} <Link href="/app/credits">{t("credits.request")}</Link></Notice>}
      <div className="grid">
        <Stat label={t("home.conversations")} value={recent.length} />
        <Stat label={t("home.bookings")} value={upcoming.length} />
        <Stat label={t("home.handoffs")} value={recent.filter((c) => c.outcome === "handed_off").length} />
        <Stat label={t("home.balance")} value={fmtNum(w.balance, locale, 1)} tone={w.low ? "warn" : undefined} />
      </div>
      <section className="card stack">
        <h2>{t("home.recent")}</h2>
        <div className="table-wrap">
          <table>
            <tbody>
              {convs.slice(0, 6).map((c) => (
                <tr key={c.id}>
                  <td>{fmtDateTime(c.startedAt, locale)}</td>
                  <td>{t(`channel.${c.channel}` as "channel.website")}</td>
                  <td><Badge tone={c.outcome === "booked" ? "ok" : c.outcome === "handed_off" ? "warn" : "neutral"}>{t(`outcome.${c.outcome}` as "outcome.booked")}</Badge></td>
                  <td><Link href={`/app/conversations/${c.id}`}>{c.summary}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
