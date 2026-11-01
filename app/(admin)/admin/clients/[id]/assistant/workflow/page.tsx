import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { dictionaries, getT } from "@/lib/i18n";
import * as store from "@/lib/data";
import { vocabOf } from "@/lib/business-types";
import { explainCatalogError } from "@/lib/elevenlabs-catalog";
import { failureToShow } from "@/lib/procedures";
import {
  STEP_KINDS, STEP_LIMITS, STEP_TEMPLATES, blankStep, stepTemplate, workflowFailKey, workflowFromEnv,
  type LiveWorkflow, type Step, type StepKind, type StepTemplate,
} from "@/lib/workflow";
import { deleteStepAction, moveStepAction, removeWorkflowAction, saveStepAction } from "@/lib/workflow-actions";
import { ConfirmDelete } from "@/components/Confirm";
import { Fold } from "@/components/Fold";
import { Guide } from "@/components/Guide";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge, Notice, PageHead } from "@/components/ui";
import { text } from "@/components/studio/text";

type Query = { done?: string; err?: string; kind?: string; template?: string };
const DONE = ["added", "saved", "deleted", "moved", "removed"];
const NODE_TYPES = ["start", "end", "override_agent", "say", "standalone_agent", "phone_number", "tool", "update_state"];
const ERR = ["no_key", "no_agent", "label", "when", "instructions", "message", "agent", "ownAgent", "phone", "long", "confirm", "refused", "full", "gone", "custom"];

export default async function WorkflowPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const tenant = await store.getTenant(id);
  if (!tenant) notFound();
  const { locale } = await getT(tenant);
  const T = text(dictionaries[locale] as Record<string, string>);
  const agent = await store.getAgent(id);
  const api = workflowFromEnv();
  const back = `/admin/clients/${id}/assistant`;

  let live: LiveWorkflow | null = null;
  let problem: string | null = null;
  if (api && agent.elevenLabsAgentId) {
    try { live = await api.read(agent.elevenLabsAgentId); } catch (e) { problem = explainCatalogError(e); }
  }
  const steps = live?.kind === "simple" ? live.steps : [];
  const refused = sp.err === "refused" ? failureToShow(await store.getSetting(workflowFailKey(id)).catch(() => undefined)) : null;
  const template = STEP_TEMPLATES.find((x) => x === sp.template) as StepTemplate | undefined;
  const kind = (STEP_KINDS.find((k) => k === sp.kind) ?? "specialist") as StepKind;
  const start: Step = template ? stepTemplate(template, vocabOf(tenant, "en")) : blankStep(kind);

  const fields = (s: Step) => (
    <>
      <input type="hidden" name="kind" value={s.kind} />
      <label>{T("wf.f.label")}<input name="label" required maxLength={STEP_LIMITS.label} defaultValue={s.label} dir="auto" /></label>
      <label>{T("wf.f.when")}<input name="when" required maxLength={STEP_LIMITS.when} defaultValue={s.when} dir="auto" /><small className="muted">{T("wf.h.when")}</small></label>
      {s.kind === "specialist" && (
        <>
          <label>{T("wf.f.instructions")}<textarea name="instructions" required rows={6} maxLength={STEP_LIMITS.instructions} defaultValue={s.instructions} dir="auto" /><small className="muted">{T("wf.h.instructions")}</small></label>
          <label>{T("wf.f.back")}<input name="back" maxLength={STEP_LIMITS.when} defaultValue={s.back} dir="auto" /><small className="muted">{T("wf.h.back")}</small></label>
          <label>{T("wf.f.endWhen")}<input name="endWhen" maxLength={STEP_LIMITS.when} defaultValue={s.endWhen} dir="auto" /><small className="muted">{T("wf.h.endWhen")}</small></label>
        </>
      )}
      {s.kind === "say" && (
        <>
          <label>{T("wf.f.message")}<textarea name="message" required rows={2} maxLength={STEP_LIMITS.message} defaultValue={s.message} dir="auto" /><small className="muted">{T("wf.h.message")}</small></label>
          <fieldset className="stack" style={{ gap: ".35rem" }}>
            <legend style={{ fontWeight: 600, fontSize: ".88rem" }}>{T("wf.f.then")}</legend>
            <div className="radio-cards">
              {(["main", "end"] as const).map((v) => <label key={v}><input type="radio" name="then" value={v} defaultChecked={s.then === v} />{T(`wf.then.${v}`)}</label>)}
            </div>
          </fieldset>
        </>
      )}
      {s.kind === "agent" && (
        <>
          <label>{T("wf.f.agentId")}<input name="agentId" required defaultValue={s.agentId} placeholder="agent_..." dir="ltr" /><small className="muted">{T("wf.h.agentId")}</small></label>
          <label>{T("wf.f.transferMessage")}<input name="transferMessage" maxLength={STEP_LIMITS.message} defaultValue={s.transferMessage} dir="auto" /><small className="muted">{T("wf.h.transferMessage")}</small></label>
        </>
      )}
      {s.kind === "phone" && (
        <>
          <label>{T("wf.f.phone")}<input name="phone" required type="tel" defaultValue={s.phone} placeholder="+973..." dir="ltr" /><small className="muted">{T("wf.h.phone")}</small></label>
          <Notice tone="warn">{T("wf.phoneNote")}</Notice>
        </>
      )}
    </>
  );
  const outcome = (s: Step) => {
    switch (s.kind) {
      case "specialist": return [s.back ? T("wf.out.back", { when: s.back }) : T("wf.out.stays"), s.endWhen ? T("wf.out.endWhen", { when: s.endWhen }) : ""].filter(Boolean).join(" ");
      case "say": return T(s.then === "end" ? "wf.out.sayEnd" : "wf.out.sayBack", { message: s.message });
      case "agent": return T("wf.out.agent", { agent: s.agentId });
      case "phone": return T("wf.out.phone", { phone: s.phone });
      case "end": return T("wf.out.end");
    }
  };

  return (
    <>
      <PageHead title={T("wf.title")} subtitle={T("wf.subtitle")} actions={<Link className="btn ghost" href={back}>{T("proc.back")}</Link>} />
      <Guide id="workflow">
        <ol className="notes">{[1, 2, 3, 4].map((i) => <li key={i}>{T(`wf.guide.${i}`)}</li>)}</ol>
      </Guide>

      {sp.done && DONE.includes(sp.done) && <Notice tone="ok">{T(`wf.done.${sp.done}`)}</Notice>}
      {sp.err && ERR.includes(sp.err) && <Notice tone="warn">{T(`wf.err.${sp.err}`)}{refused ? ` ${refused}` : ""}</Notice>}
      {!api && sp.err !== "no_key" && <Notice tone="warn">{T("wf.err.no_key")}</Notice>}
      {api && !agent.elevenLabsAgentId && sp.err !== "no_agent" && <Notice tone="warn">{T("wf.err.no_agent")}</Notice>}
      {problem && <Notice tone="warn">{T("wf.readFailed")} {problem}</Notice>}

      {live && (
        <div className="stack">
          <section className="card stack">
            <h2 style={{ margin: 0, fontSize: "1.05rem" }}>{T("wf.now")}</h2>
            <p className="muted" style={{ margin: 0 }}>{T(`wf.state.${live.kind}`, { n: steps.length })}</p>
            <small className="muted">{T("wf.recommend")}</small>
          </section>

          {live.kind === "custom" && (
            <section className="card stack">
              <p style={{ margin: 0 }}>{T("wf.custom.help", { n: live.nodes.length, e: live.edges })}</p>
              <ul className="notes">{live.nodes.map((n) => <li key={n.id}><span dir="auto">{n.label || n.id}</span> <Badge>{NODE_TYPES.includes(n.type) ? T(`wf.node.${n.type}`) : n.type}</Badge></li>)}</ul>
            </section>
          )}

          {live.kind !== "custom" && (
            <>
              <ol className="wf-map" aria-label={T("wf.title")}>
                <li className="wf-node wf-main"><strong>{T("wf.main")}</strong><small className="muted">{T("wf.main.help")}</small></li>
                {steps.map((s, i) => (
                  <li key={s.id} className="wf-node">
                    <Fold id={`s-${s.id}`} title={<span dir="auto">{s.label}</span>} hint={<span dir="auto">{T("wf.whenShort", { when: s.when })}</span>} badge={<Badge tone="info">{T(`wf.kind.${s.kind}`)}</Badge>}>
                      <p className="muted" style={{ margin: 0 }} dir="auto">{outcome(s)}</p>
                      <div className="row" style={{ gap: ".4rem" }}>
                        {(["up", "down"] as const).map((dir) => (
                          <form key={dir} action={moveStepAction}>
                            <input type="hidden" name="tenantId" value={id} /><input type="hidden" name="stepId" value={s.id} /><input type="hidden" name="dir" value={dir} />
                            <SubmitButton className="btn ghost small" type="submit" disabled={dir === "up" ? i === 0 : i === steps.length - 1}>{T(`wf.move.${dir}`)}</SubmitButton>
                          </form>
                        ))}
                      </div>
                      <form action={saveStepAction} className="stack">
                        <input type="hidden" name="tenantId" value={id} /><input type="hidden" name="stepId" value={s.id} />
                        {fields(s)}
                        <div><SubmitButton className="btn" type="submit">{T("wf.save")}</SubmitButton></div>
                      </form>
                      <ConfirmDelete action={deleteStepAction} summary={T("wf.delete.summary")} warning={T(steps.length === 1 ? "wf.delete.last" : "wf.delete.warning")} tick={T("wf.delete.tick")} button={T("wf.delete.button")} fields={{ tenantId: id, stepId: s.id, label: s.label }} />
                    </Fold>
                  </li>
                ))}
              </ol>

              <Fold id="new" open={Boolean(template || sp.kind)} title={T("wf.add")} hint={T("wf.add.help")}>
                <div className="stack" style={{ gap: ".4rem" }}>
                  <small className="muted">{T("wf.templates")}</small>
                  <div className="row" style={{ gap: ".4rem", flexWrap: "wrap" }}>
                    {STEP_TEMPLATES.map((x) => <Link key={x} className={`btn small${x === template ? "" : " ghost"}`} href={`?template=${x}#new`}>{T(`wf.tpl.${x}`)}</Link>)}
                  </div>
                  <small className="muted">{T("wf.kinds")}</small>
                  <div className="row" style={{ gap: ".4rem", flexWrap: "wrap" }}>
                    {STEP_KINDS.map((k) => <Link key={k} className={`btn small${!template && k === kind ? "" : " ghost"}`} href={`?kind=${k}#new`}>{T(`wf.kind.${k}`)}</Link>)}
                  </div>
                  <small className="muted">{T(`wf.kind.${start.kind}.help`)}</small>
                </div>
                <form key={template ?? kind} action={saveStepAction} className="stack">
                  <input type="hidden" name="tenantId" value={id} />
                  {fields(start)}
                  <div><SubmitButton className="btn" type="submit" disabled={steps.length >= STEP_LIMITS.count}>{T("wf.addButton")}</SubmitButton></div>
                </form>
              </Fold>
            </>
          )}

          {live.kind !== "none" && (
            <Fold id="remove" tone="danger" title={T("wf.remove")} hint={T("wf.remove.help")}>
              <ConfirmDelete action={removeWorkflowAction} summary={T("wf.remove")} warning={T("wf.remove.warning")} tick={T("wf.remove.tick")} button={T("wf.remove.button")} fields={{ tenantId: id }} />
            </Fold>
          )}
        </div>
      )}
    </>
  );
}
