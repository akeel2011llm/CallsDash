import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { dictionaries, getT } from "@/lib/i18n";
import * as store from "@/lib/data";
import { explainCatalogError } from "@/lib/elevenlabs-catalog";
import { ElevenLabsError } from "@/lib/elevenlabs-api";
import { failureToShow } from "@/lib/procedures";
import { EXAMPLE_NUMBER, phoneFailKey, phoneFromEnv, type PhoneLine } from "@/lib/phone";
import { assignPhoneAction, connectPhoneAction, disconnectPhoneAction, testCallAction } from "@/lib/phone-actions";
import { ConfirmDelete } from "@/components/Confirm";
import { Fold } from "@/components/Fold";
import { Guide } from "@/components/Guide";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge, Notice, PageHead } from "@/components/ui";
import { text } from "@/components/studio/text";

type Query = { done?: string; err?: string };
const DONE = ["connected", "assigned", "called", "disconnected"];
const ERR = ["no_key", "no_agent", "number", "sid", "token", "already", "no_line", "to", "agree", "confirm", "refused"];

export default async function PhonePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const tenant = await store.getTenant(id);
  if (!tenant) notFound();
  const { locale } = await getT(tenant);
  const T = text(dictionaries[locale] as Record<string, string>);
  const agent = await store.getAgent(id);
  const api = phoneFromEnv();
  const back = `/admin/clients/${id}/channels`;
  const lineId = tenant.integrations.phone?.elevenLabsId;

  let line: PhoneLine | null = null;
  let problem: string | null = null;
  let gone = false; // the saved number no longer exists in ElevenLabs (deleted there): connect it again
  if (api && lineId) {
    try { line = await api.read(lineId); } catch (e) { if (e instanceof ElevenLabsError && e.status === 404) gone = true; else problem = explainCatalogError(e); }
  }
  const linked = Boolean(lineId) && !gone;
  const refused = sp.err === "refused" ? failureToShow(await store.getSetting(phoneFailKey(id)).catch(() => undefined)) : null;
  const onAgent = Boolean(line && agent.elevenLabsAgentId && line.agentId === agent.elevenLabsAgentId);
  const ready = Boolean(api && agent.elevenLabsAgentId);
  const hidden = <input type="hidden" name="tenantId" value={id} />;

  return (
    <>
      <PageHead title={T("phone.title")} subtitle={T("phone.subtitle")} actions={<Link className="btn ghost" href={back}>{T("proc.back")}</Link>} />
      <Guide id="phone">
        <ol className="notes">{[1, 2, 3, 4, 5, 6].map((i) => <li key={i}>{T(`phone.guide.${i}`, { example: EXAMPLE_NUMBER })}</li>)}</ol>
        <small className="muted">{T("phone.guide.note")}</small>
      </Guide>

      {sp.done && DONE.includes(sp.done) && <Notice tone="ok">{T(`phone.done.${sp.done}`)}</Notice>}
      {sp.err && ERR.includes(sp.err) && <Notice tone="warn">{T(`phone.err.${sp.err}`)}{refused ? ` ${refused}` : ""}</Notice>}
      {!api && sp.err !== "no_key" && <Notice tone="warn">{T("phone.err.no_key")}</Notice>}
      {api && !agent.elevenLabsAgentId && sp.err !== "no_agent" && <Notice tone="warn">{T("phone.err.no_agent")}</Notice>}
      {gone && <Notice tone="warn">{T("phone.gone")}</Notice>}
      {problem && <Notice tone="warn">{T("phone.readFailed")} {problem}</Notice>}

      {api && (
        <div className="stack">
          <section className="card stack">
            <div className="row" style={{ justifyContent: "space-between", gap: ".5rem", flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, fontSize: "1.05rem" }}>{T("phone.now")}</h2>
              <Badge tone={line ? (onAgent ? "ok" : "warn") : "neutral"}>{line ? T(onAgent ? "phone.state.ready" : "phone.state.other") : T("phone.state.none")}</Badge>
            </div>
            {line ? (
              <dl className="scan-grid" style={{ margin: 0 }}>
                <dt>{T("phone.f.number")}</dt><dd dir="ltr">{line.number}</dd>
                <dt>{T("phone.f.label")}</dt><dd dir="auto">{line.label}</dd>
                <dt>{T("phone.f.answers")}</dt><dd dir="auto">{line.agentName || line.agentId || T("phone.nobody")}</dd>
                <dt>{T("phone.f.can")}</dt><dd>{[line.inbound && T("phone.in"), line.outbound && T("phone.out")].filter(Boolean).join(" · ")}</dd>
              </dl>
            ) : (
              <p className="muted" style={{ margin: 0 }}>{T("phone.none")}</p>
            )}
            {line && !onAgent && ready && (
              <form action={assignPhoneAction} className="stack">
                {hidden}
                <small className="muted">{T("phone.assign.help")}</small>
                <div><SubmitButton className="btn" type="submit">{T("phone.assign.button")}</SubmitButton></div>
              </form>
            )}
          </section>

          {!linked && (
            <Fold id="connect" open={["number", "sid", "token", "refused", "already"].includes(sp.err ?? "")} title={T("phone.connect")} hint={T("phone.connect.help")}>
              <form action={connectPhoneAction} className="stack" autoComplete="off">
                {hidden}
                <label>{T("phone.f.number")}<input name="number" required inputMode="tel" dir="ltr" placeholder={EXAMPLE_NUMBER} /><small className="muted">{T("phone.h.number")}</small></label>
                <label>{T("phone.f.label")}<input name="label" maxLength={60} dir="auto" /></label>
                <label>{T("phone.f.sid")}<input name="sid" required dir="ltr" autoComplete="off" spellCheck={false} placeholder="AC… / SK…" /><small className="muted">{T("phone.h.sid")}</small></label>
                <label>{T("phone.f.token")}<input name="token" type="password" required dir="ltr" autoComplete="new-password" spellCheck={false} /><small className="muted">{T("phone.h.token")}</small></label>
                <Notice>{T("phone.notStored")}</Notice>
                <div><SubmitButton className="btn" type="submit" disabled={!ready}>{T("phone.connect.button")}</SubmitButton></div>
              </form>
            </Fold>
          )}

          {linked && (
            <Fold id="test" open={["to", "agree"].includes(sp.err ?? "") || sp.done === "called"} title={T("phone.test")} hint={T("phone.test.help")}>
              <form action={testCallAction} className="stack">
                {hidden}
                <label>{T("phone.f.to")}<input name="to" required inputMode="tel" dir="ltr" placeholder="+973 …" /><small className="muted">{T("phone.h.to")}</small></label>
                <label className="inline"><input type="checkbox" name="agree" required />{T("phone.test.agree")}</label>
                <Notice tone="warn">{T("phone.test.note")}</Notice>
                <div><SubmitButton className="btn" type="submit" disabled={!ready || !line?.outbound}>{T("phone.test.button")}</SubmitButton></div>
              </form>
            </Fold>
          )}

          {linked && (
            <Fold id="disconnect" tone="danger" title={T("phone.disconnect")} hint={T("phone.disconnect.help")}>
              <ConfirmDelete action={disconnectPhoneAction} summary={T("phone.disconnect")} warning={T("phone.disconnect.warning")} tick={T("phone.disconnect.tick")} button={T("phone.disconnect.button")} fields={{ tenantId: id }} />
            </Fold>
          )}
        </div>
      )}
    </>
  );
}
