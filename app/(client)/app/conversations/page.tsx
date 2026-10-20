import Link from "next/link";
import { requireClient } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDateTime, fmtDuration } from "@/lib/format";
import { getConversations } from "@/lib/data";
import { Badge, PageHead } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";

type SP = { q?: string; channel?: string; outcome?: string; lang?: string };

export default async function ConversationsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { tenant } = await requireClient();
  const sp = await searchParams;
  const { t, locale } = await getT();
  const q = (sp.q ?? "").trim().toLowerCase();
  const rows = (await getConversations(tenant.id)).filter((c) =>
    (!sp.channel || c.channel === sp.channel) && (!sp.outcome || c.outcome === sp.outcome) && (!sp.lang || c.language === sp.lang) &&
    (!q || c.summary.toLowerCase().includes(q) || c.transcript.some((l) => l.text.toLowerCase().includes(q))));
  return (
    <>
      <PageHead title={t("conversations.title")} />
      <form className="filters card" method="get">
        <label style={{ flex: 1, minWidth: 220 }}>{t("common.search")}<input name="q" defaultValue={sp.q ?? ""} placeholder={t("conversations.search")} /></label>
        <label>{t("common.channel")}
          <select name="channel" defaultValue={sp.channel ?? ""}>
            <option value="">{t("common.all")}</option>
            {(["website", "whatsapp", "instagram", "phone"] as const).map((c) => <option key={c} value={c}>{t(`channel.${c}` as "channel.website")}</option>)}
          </select>
        </label>
        <label>{t("common.outcome")}
          <select name="outcome" defaultValue={sp.outcome ?? ""}>
            <option value="">{t("common.all")}</option>
            {(["booked", "answered", "handed_off", "abandoned"] as const).map((c) => <option key={c} value={c}>{t(`outcome.${c}` as "outcome.booked")}</option>)}
          </select>
        </label>
        <label>{t("common.language")}
          <select name="lang" defaultValue={sp.lang ?? ""}>
            <option value="">{t("common.all")}</option><option value="en">English</option><option value="ar">العربية</option>
          </select>
        </label>
        <SubmitButton className="btn" type="submit">{t("common.search")}</SubmitButton>
      </form>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>{t("common.date")}</th><th>{t("common.channel")}</th><th>{t("common.outcome")}</th><th>{t("conversations.summary")}</th><th>{t("conversations.duration")}</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="muted">{t("common.none")}</td></tr>}
            {rows.slice(0, 100).map((c) => (
              <tr key={c.id}>
                <td>{fmtDateTime(c.startedAt, locale)}</td>
                <td>{t(`channel.${c.channel}` as "channel.website")}</td>
                <td><Badge tone={c.outcome === "booked" ? "ok" : c.outcome === "handed_off" ? "warn" : "neutral"}>{t(`outcome.${c.outcome}` as "outcome.booked")}</Badge></td>
                <td dir={c.language === "ar" ? "rtl" : "ltr"}><Link href={`/app/conversations/${c.id}`}>{c.summary}</Link></td>
                <td>{c.mode === "voice" ? fmtDuration(c.durationSec) : `${c.messages} ${t("conversations.messages")}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
