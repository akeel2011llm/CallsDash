import Link from "next/link";
import { getT, type Key } from "@/lib/i18n";
import { fmtDateTime, fmtNum } from "@/lib/format";
import { appUrl } from "@/lib/app-url";
import { agentVariables } from "@/lib/agent-context";
import { bookingService } from "@/lib/booking-service";
import { ToolError } from "@/lib/booking";
import { getAgent, getBookings, getConversations, getDoctors, getKnowledge, getStaffRequests, getWallet, listTenants } from "@/lib/data";
import { syncAgentAction } from "@/lib/channel-actions";
import { viewAsClient } from "@/lib/actions";
import { AgentTestWidget } from "@/components/AgentTestWidget";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge, Notice, PageHead } from "@/components/ui";

type SP = { c?: string; lang?: string; saved?: string; error?: string };
const SCENARIOS = ["hours", "faq", "book", "change", "message", "human", "arabic", "unknown"] as const;

/** The client's real agent, run from the admin portal, with everything needed to judge the result on one page. */
export default async function TestAgentPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const [{ t, locale }, tenants] = await Promise.all([getT(), listTenants()]);
  const tenant = tenants.find((x) => x.id === sp.c) ?? tenants[0];
  if (!tenant) return <><PageHead title={t("test.title")} /><Notice>{t("test.noClients")}</Notice></>;
  const lang = sp.lang === "ar" ? "ar" : "en";
  const [agent, wallet, doctors, knowledge, conversations, requests, bookings, url] = await Promise.all([
    getAgent(tenant.id), getWallet(tenant.id), getDoctors(tenant.id), getKnowledge(tenant.id), getConversations(tenant.id),
    getStaffRequests(tenant.id), getBookings(tenant.id), appUrl(),
  ]);
  const host = new URL(url).hostname;
  const el = tenant.integrations.elevenlabs;
  const allowed = Boolean(el?.widgetHosts?.includes(host));
  const paused = tenant.status === "suspended" || (wallet.balance <= 0 && tenant.zeroBalancePolicy === "pause");
  let slots: { doctor: string; start: string }[] = [];
  let slotError: string | null = null;
  try { slots = (await (await bookingService()).checkAvailability(tenant.id, { days: 7, limit: 6, locale: lang })).slots; }
  catch (e) { if (e instanceof ToolError) slotError = e.code; else throw e; }
  const here = `/admin/test?c=${tenant.id}&lang=${lang}`;
  const name = (x: (typeof tenants)[number]) => (locale === "ar" ? x.branding.displayNameAr || x.name : x.name);
  const recent = [...conversations].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 5);
  const aiBookings = bookings.filter((b) => (b.source ?? "ai") === "ai").sort((a, b) => b.id.localeCompare(a.id)).slice(0, 5);
  const doctorName = new Map(doctors.map((d) => [d.id, d.name]));
  const openAs = (next: string, label: string) => (
    <form action={viewAsClient}>
      <input type="hidden" name="tenantId" value={tenant.id} /><input type="hidden" name="next" value={next} />
      <SubmitButton className="btn small ghost" type="submit">{label}</SubmitButton>
    </form>
  );
  const check = (ok: boolean, label: string, detail: React.ReactNode) => (
    <tr><td><Badge tone={ok ? "ok" : "warn"}>{ok ? t("test.ok") : t("test.todo")}</Badge></td><td><strong>{label}</strong><br /><small className="muted">{detail}</small></td></tr>
  );
  return (
    <>
      <PageHead title={t("test.title")} subtitle={t("test.subtitle")} />
      <form method="get" className="filters card">
        <label>{t("users.client")}
          <select name="c" defaultValue={tenant.id}>{tenants.map((x) => <option key={x.id} value={x.id}>{name(x)}</option>)}</select>
        </label>
        <label>{t("common.language")}
          <select name="lang" defaultValue={lang}><option value="en">English</option><option value="ar">العربية</option></select>
        </label>
        <SubmitButton className="btn ghost" type="submit">{t("common.apply")}</SubmitButton>
      </form>
      {sp.saved && <Notice tone="ok">{t("test.synced")}</Notice>}
      {sp.error && <Notice tone="warn">{t(`channels.err.${sp.error}` as Key) ?? sp.error}</Notice>}

      <div className="grid two">
        <section className="card stack" style={{ alignContent: "start" }}>
          <h2>{t("test.ready")}</h2>
          <div className="table-wrap"><table><tbody>
            {check(Boolean(agent.elevenLabsAgentId), t("test.check.agent"), agent.elevenLabsAgentId ? <code>{agent.elevenLabsAgentId}</code> : t("test.check.agentMissing"))}
            {check(Boolean(el?.syncedAt), t("test.check.sync"), el?.syncedAt ? fmtDateTime(el.syncedAt, locale) : t("test.never"))}
            {check(allowed, t("test.check.portal"), allowed ? host : t("test.check.portalMissing").replace("{host}", host))}
            {check(!paused, t("test.check.credits"), `${fmtNum(wallet.balance, locale, 1)} · ${paused ? t("test.check.paused") : t("status.live")}`)}
            {check(doctors.some((d) => d.googleCalendarId), t("test.check.calendar"), t("test.check.calendarCount").replace("{n}", String(doctors.filter((d) => d.googleCalendarId).length)).replace("{m}", String(doctors.length)))}
            {check(knowledge.length > 0, t("test.check.knowledge"), t("test.check.knowledgeCount").replace("{n}", String(knowledge.length)))}
          </tbody></table></div>
          <div className="row">
            <form action={syncAgentAction}>
              <input type="hidden" name="tenantId" value={tenant.id} /><input type="hidden" name="returnTo" value={here} />
              <SubmitButton className="btn" type="submit">{agent.elevenLabsAgentId ? t("channels.agent.sync") : t("channels.agent.create")}</SubmitButton>
            </form>
            <Link className="btn ghost" href={`/admin/clients/${tenant.id}/channels`}>{t("nav.channels")}</Link>
          </div>
          <small className="muted">{t("test.syncHelp")}</small>
        </section>

        <section className="card stack" style={{ alignContent: "start" }}>
          <h2>{t("test.talk")}</h2>
          {agent.elevenLabsAgentId ? (
            <>
              <p>{t("test.talkHelp")}</p>
              {!allowed && <Notice tone="warn">{t("test.check.portalMissing").replace("{host}", host)}</Notice>}
              {paused && <Notice tone="warn">{t("test.pausedNote")}</Notice>}
              <small className="muted">{t("test.costNote")}</small>
              <AgentTestWidget key={`${tenant.id}-${lang}`} agentId={agent.elevenLabsAgentId} language={lang} variables={agentVariables(tenant, new Date(), { channel: "website" })} />
            </>
          ) : <Notice tone="warn">{t("test.check.agentMissing")}</Notice>}
        </section>
      </div>

      <section className="card stack" style={{ alignContent: "start" }}>
        <h2>{t("test.try")}</h2>
        <ol className="stack" style={{ paddingInlineStart: "1.2rem", margin: 0 }}>
          {SCENARIOS.map((s) => (
            <li key={s}><strong>{t(`test.s.${s}` as Key)}</strong><br /><small className="muted">{t(`test.s.${s}.expect` as Key)}</small></li>
          ))}
        </ol>
      </section>

      <div className="grid two">
        <section className="card stack" style={{ alignContent: "start" }}>
          <h2>{t("test.slots")}</h2>
          <small className="muted">{t("test.slotsHelp")}</small>
          {slotError ? <Notice tone="warn">{t(`bookings.err.${slotError}` as Key)}</Notice>
            : slots.length === 0 ? <Notice>{t("bookings.noTimes")}</Notice>
            : <div className="table-wrap"><table><tbody>
              {slots.map((s) => <tr key={`${s.doctor}-${s.start}`}><td>{fmtDateTime(s.start, locale)}</td><td>{s.doctor}</td></tr>)}
            </tbody></table></div>}
        </section>

        <section className="card stack" style={{ alignContent: "start" }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>{t("test.results")}</h2>
            <Link className="btn small ghost" href={here}>{t("test.refresh")}</Link>
          </div>
          <small className="muted">{t("test.resultsHelp")}</small>
          <h3>{t("nav.conversations")}</h3>
          {recent.length === 0 ? <small className="muted">{t("common.none")}</small> : recent.map((c) => (
            <div key={c.id}>
              <small className="muted">{fmtDateTime(c.startedAt, locale)} · {t(`channel.${c.channel}` as Key)} · {t(`outcome.${c.outcome}` as Key)}</small>
              <div dir="auto">{c.summary}</div>
            </div>
          ))}
          <h3>{t("test.aiBookings")}</h3>
          {aiBookings.length === 0 ? <small className="muted">{t("common.none")}</small> : aiBookings.map((b) => (
            <div key={b.id}><small className="muted">{fmtDateTime(b.startsAt, locale)} · {doctorName.get(b.doctorId) ?? ""} · {t(`booking.${b.status}` as Key)}</small><div>{b.patientName} · {b.service}</div></div>
          ))}
          <h3>{t("nav.messages")}</h3>
          <small className="muted">{t("test.openMessages").replace("{n}", String(requests.filter((r) => r.status === "open").length))}</small>
          <div className="row">
            {openAs("/app/conversations", t("test.open.conversations"))}
            {openAs("/app/bookings", t("test.open.bookings"))}
            {openAs("/app/messages", t("test.open.messages"))}
          </div>
        </section>
      </div>
    </>
  );
}
