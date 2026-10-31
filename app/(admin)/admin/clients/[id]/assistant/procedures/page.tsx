import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { dictionaries, getT } from "@/lib/i18n";
import * as store from "@/lib/data";
import { vocabOf } from "@/lib/business-types";
import { explainCatalogError } from "@/lib/elevenlabs-catalog";
import {
  PROCEDURE_LIMITS, PROCEDURE_TEMPLATES, PROCEDURE_TYPES, failureToShow, procedureFailKey, procedureTemplate, proceduresFromEnv,
  type Procedure, type ProcedureInput, type ProcedureTemplate,
} from "@/lib/procedures";
import { deleteProcedureAction, saveProcedureAction } from "@/lib/procedure-actions";
import { ConfirmDelete } from "@/components/Confirm";
import { Fold } from "@/components/Fold";
import { Guide } from "@/components/Guide";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge, Notice, PageHead } from "@/components/ui";
import { text } from "@/components/studio/text";

type Query = { done?: string; err?: string; p?: string; template?: string };
const DONE = ["added", "saved", "deleted"];
const ERR = ["no_key", "no_agent", "name", "content", "long", "confirm", "refused"];

export default async function ProceduresPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const tenant = await store.getTenant(id);
  if (!tenant) notFound();
  const { locale } = await getT(tenant);
  const T = text(dictionaries[locale] as Record<string, string>);
  const agent = await store.getAgent(id);
  const api = proceduresFromEnv();
  const back = `/admin/clients/${id}/assistant`;

  // what ElevenLabs holds now: the list, then each procedure's steps
  let list: Procedure[] = [];
  let problem: string | null = null;
  if (api && agent.elevenLabsAgentId) {
    try {
      const branch = await api.mainBranch(agent.elevenLabsAgentId);
      const items = (await api.list(agent.elevenLabsAgentId, branch)).filter((p) => p.type !== "folder").slice(0, PROCEDURE_LIMITS.count);
      list = await Promise.all(items.map((p) => api.get(agent.elevenLabsAgentId, branch, p.id).then((full) => ({ ...p, content: full.content })).catch(() => ({ ...p, content: "" }))));
    } catch (e) {
      problem = explainCatalogError(e);
    }
  }
  const refused = sp.err === "refused" ? failureToShow(await store.getSetting(procedureFailKey(id)).catch(() => undefined)) : null;
  const v = vocabOf(tenant, "en");
  const template = PROCEDURE_TEMPLATES.find((x) => x === sp.template) as ProcedureTemplate | undefined;
  const start: ProcedureInput = template ? procedureTemplate(template, { customer: v.customerOne, staff: v.staffMany, place: v.place }) : { name: "", trigger: "", type: "free_form", content: "" };

  const fields = (p: ProcedureInput) => (
    <>
      <label>{T("proc.f.name")}<input name="name" required maxLength={PROCEDURE_LIMITS.name} defaultValue={p.name} dir="auto" /></label>
      <label>{T("proc.f.trigger")}<input name="trigger" maxLength={PROCEDURE_LIMITS.trigger} defaultValue={p.trigger} dir="auto" /><small className="muted">{T("proc.h.trigger")}</small></label>
      <fieldset className="stack" style={{ gap: ".35rem" }}>
        <legend style={{ fontWeight: 600, fontSize: ".88rem" }}>{T("proc.f.type")}</legend>
        <div className="radio-cards">
          {PROCEDURE_TYPES.map((ty) => <label key={ty}><input type="radio" name="type" value={ty} defaultChecked={p.type === ty} />{T(`proc.type.${ty}`)}</label>)}
        </div>
        <small className="muted">{T("proc.h.type")}</small>
      </fieldset>
      <label>{T("proc.f.content")}<textarea name="content" required rows={8} maxLength={PROCEDURE_LIMITS.content} defaultValue={p.content} dir="auto" /><small className="muted">{T("proc.h.content")}</small></label>
    </>
  );

  return (
    <>
      <PageHead title={T("proc.title")} subtitle={T("proc.subtitle")} actions={<Link className="btn ghost" href={back}>{T("proc.back")}</Link>} />
      <Guide id="procedures">
        <ol className="notes">{[1, 2, 3, 4].map((i) => <li key={i}>{T(`proc.guide.${i}`)}</li>)}</ol>
      </Guide>

      {sp.done && DONE.includes(sp.done) && <Notice tone="ok">{T(`proc.done.${sp.done}`)}</Notice>}
      {sp.err && ERR.includes(sp.err) && <Notice tone="warn">{T(`proc.err.${sp.err}`)}{refused ? ` ${refused}` : ""}</Notice>}
      {!api && <Notice tone="warn">{T("proc.err.no_key")}</Notice>}
      {api && !agent.elevenLabsAgentId && <Notice tone="warn">{T("proc.err.no_agent")}</Notice>}
      {problem && <Notice tone="warn">{T("proc.readFailed")} {problem}</Notice>}

      {api && agent.elevenLabsAgentId && !problem && (
        <div className="stack">
          <h2 style={{ margin: 0, fontSize: "1.05rem" }}>{T("proc.list", { n: list.length })}</h2>
          {!list.length && <p className="muted">{T("proc.none")}</p>}
          {list.map((p) => (
            <Fold key={p.id} id={`p-${p.id}`} open={sp.p === p.id} title={p.name} hint={p.trigger || T("proc.sub")}
              badge={<Badge tone={p.draft ? "warn" : "neutral"}>{T(p.draft ? "proc.draft" : `proc.type.${p.type === "deterministic" ? "deterministic" : "free_form"}`)}</Badge>}>
              <form action={saveProcedureAction} className="stack">
                <input type="hidden" name="tenantId" value={id} /><input type="hidden" name="procedureId" value={p.id} />
                {fields({ name: p.name, trigger: p.trigger, type: p.type === "deterministic" ? "deterministic" : "free_form", content: p.content })}
                <div><SubmitButton className="btn" type="submit">{T("proc.save")}</SubmitButton></div>
              </form>
              <ConfirmDelete action={deleteProcedureAction} summary={T("proc.delete.summary")} warning={T("proc.delete.warning")} tick={T("proc.delete.tick")} button={T("proc.delete.button")} fields={{ tenantId: id, procedureId: p.id, name: p.name }} />
            </Fold>
          ))}

          <Fold id="new" open={Boolean(template) || sp.err === "name" || sp.err === "content"} title={T("proc.add")} hint={T("proc.add.help")}>
            <div className="row" style={{ gap: ".4rem" }}>
              <small className="muted">{T("proc.templates")}</small>
              {PROCEDURE_TEMPLATES.map((x) => <Link key={x} className={`btn small${x === template ? "" : " ghost"}`} href={`?template=${x}#new`}>{T(`proc.tpl.${x}`)}</Link>)}
            </div>
            <form key={template ?? "blank"} action={saveProcedureAction} className="stack">
              <input type="hidden" name="tenantId" value={id} />
              {fields(start)}
              <div><SubmitButton className="btn" type="submit">{T("proc.addButton")}</SubmitButton></div>
            </form>
          </Fold>
        </div>
      )}
    </>
  );
}
