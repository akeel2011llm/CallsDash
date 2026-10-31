import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { dictionaries, getT } from "@/lib/i18n";
import * as store from "@/lib/data";
import { explainCatalogError } from "@/lib/elevenlabs-catalog";
import { TEST_LIMITS, agentTestsFromEnv, readSuite, testsFailKey, testsKey, type AgentTestInput, type TestInvocation, type TestRunResult } from "@/lib/agent-tests";
import { failureToShow } from "@/lib/procedures";
import { addStarterTestsAction, deleteTestAction, runTestsAction, saveTestAction } from "@/lib/agent-test-actions";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ConfirmDelete } from "@/components/Confirm";
import { Fold } from "@/components/Fold";
import { Guide } from "@/components/Guide";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge, Notice, PageHead } from "@/components/ui";
import { text } from "@/components/studio/text";

type Query = { done?: string; err?: string; n?: string };
const DONE = ["added", "saved", "deleted", "starters", "started"];
const ERR = ["no_key", "no_agent", "name", "says", "success", "long", "confirm", "refused", "full", "none", "gone"];
const TONE: Record<TestRunResult["status"], "ok" | "bad" | "info" | "neutral"> = { passed: "ok", failed: "bad", pending: "info", cancelled: "neutral" };

export default async function AgentTestsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const tenant = await store.getTenant(id);
  if (!tenant) notFound();
  const { locale } = await getT(tenant);
  const T = text(dictionaries[locale] as Record<string, string>);
  const agent = await store.getAgent(id);
  const api = agentTestsFromEnv();
  const suite = readSuite(await store.getSetting(testsKey(id)).catch(() => undefined));
  const back = `/admin/clients/${id}/assistant`;
  const fmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-BH" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bahrain" });

  // the last run's results, straight from ElevenLabs
  let run: TestInvocation | null = null;
  let problem: string | null = null;
  if (api && suite.lastRun) {
    try {
      const r = await api.results(suite.lastRun.id, Object.fromEntries(suite.tests.map((t) => [t.id, t.name])));
      const kept = r.runs.filter((x) => suite.tests.some((t) => t.id === x.testId)); // a deleted test's result is not counted
      run = { ...r, runs: kept, done: r.done || kept.every((x) => x.status !== "pending") };
    }
    catch (e) { problem = explainCatalogError(e); }
  }
  const resultOf = (testId: string) => run?.runs.find((r) => r.testId === testId);
  const refused = sp.err === "refused" ? failureToShow(await store.getSetting(testsFailKey(id)).catch(() => undefined)) : null;
  const ready = Boolean(api && agent.elevenLabsAgentId);
  const counts = run ? { passed: run.runs.filter((r) => r.status === "passed").length, failed: run.runs.filter((r) => r.status === "failed").length, total: run.runs.length } : null;

  const fields = (t: AgentTestInput) => (
    <>
      <label>{T("tests.f.name")}<input name="name" required maxLength={TEST_LIMITS.name} defaultValue={t.name} dir="auto" /></label>
      <label>{T("tests.f.says")}<textarea name="says" required rows={2} maxLength={TEST_LIMITS.says} defaultValue={t.says} dir="auto" /><small className="muted">{T("tests.h.says")}</small></label>
      <label>{T("tests.f.success")}<textarea name="success" required rows={3} maxLength={TEST_LIMITS.success} defaultValue={t.success} dir="auto" /><small className="muted">{T("tests.h.success")}</small></label>
      <label>{T("tests.f.good")}<input name="good" maxLength={TEST_LIMITS.example} defaultValue={t.good} dir="auto" /><small className="muted">{T("tests.h.good")}</small></label>
      <label>{T("tests.f.bad")}<input name="bad" maxLength={TEST_LIMITS.example} defaultValue={t.bad} dir="auto" /><small className="muted">{T("tests.h.bad")}</small></label>
    </>
  );
  const runButton = (testId?: string, label = T("tests.runAll")) => (
    <form action={runTestsAction}>
      <input type="hidden" name="tenantId" value={id} />
      {testId && <input type="hidden" name="testId" value={testId} />}
      <SubmitButton className={testId ? "btn ghost small" : "btn"} type="submit" disabled={!ready}>{label}</SubmitButton>
    </form>
  );
  const statusBadge = (r: TestRunResult | undefined) => r ? <Badge tone={TONE[r.status]}>{T(`tests.status.${r.status}`)}</Badge> : <Badge tone="neutral">{T("tests.status.notRun")}</Badge>;

  return (
    <>
      <PageHead title={T("tests.title")} subtitle={T("tests.subtitle")} actions={<Link className="btn ghost" href={back}>{T("proc.back")}</Link>} />
      <Guide id="agentTests">
        <ol className="notes">{[1, 2, 3, 4].map((i) => <li key={i}>{T(`tests.guide.${i}`)}</li>)}</ol>
      </Guide>

      {sp.done && DONE.includes(sp.done) && <Notice tone="ok">{T(`tests.done.${sp.done}`, { n: Number(sp.n) || 0 })}</Notice>}
      {sp.err && ERR.includes(sp.err) && <Notice tone="warn">{T(`tests.err.${sp.err}`)}{refused ? ` ${refused}` : ""}</Notice>}
      {!api && sp.err !== "no_key" && <Notice tone="warn">{T("tests.err.no_key")}</Notice>}
      {api && !agent.elevenLabsAgentId && sp.err !== "no_agent" && <Notice tone="warn">{T("tests.err.no_agent")}</Notice>}

      {api && (
        <div className="stack">
          <section id="results" className="card stack">
            <div className="row" style={{ justifyContent: "space-between", gap: ".5rem", flexWrap: "wrap" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "1.05rem" }}>{T("tests.results")}</h2>
                <small className="muted">
                  {suite.lastRun ? T("tests.lastRun", { when: fmt.format(new Date(suite.lastRun.at)) }) : T("tests.neverRun")}
                  {counts && ` · ${T("tests.summary", { passed: counts.passed, failed: counts.failed, total: counts.total })}`}
                </small>
              </div>
              {suite.tests.length > 0 && runButton()}
            </div>
            {run && !run.done && <><Notice tone="info">{T("tests.running")}</Notice><AutoRefresh /></>}
            {problem && <Notice tone="warn">{T("tests.readFailed")} {problem}</Notice>}
            <small className="muted">{T("tests.cost")}</small>
          </section>

          <h2 style={{ margin: 0, fontSize: "1.05rem" }}>{T("tests.list", { n: suite.tests.length })}</h2>
          {!suite.tests.length && <p className="muted">{T("tests.none")}</p>}
          {suite.tests.map((t) => {
            const r = resultOf(t.id);
            return (
              <Fold key={t.id} id={`t-${t.id}`} title={<span dir="auto">{t.name}</span>} hint={<span dir="auto">{t.says}</span>} badge={statusBadge(r)} open={r?.status === "failed"}>
                {r && r.status !== "pending" && (
                  <div className={`notice ${r.status === "passed" ? "ok" : "warn"}`} role="status">
                    {r.reply && <p style={{ margin: 0 }}><strong>{T("tests.reply")}</strong> <span dir="auto">{r.reply}</span></p>}
                    {r.why && <p style={{ margin: ".35rem 0 0" }}><strong>{T("tests.why")}</strong> <span dir="auto">{r.why}</span></p>}
                  </div>
                )}
                {runButton(t.id, T("tests.runOne"))}
                <form action={saveTestAction} className="stack">
                  <input type="hidden" name="tenantId" value={id} /><input type="hidden" name="testId" value={t.id} />
                  {fields(t)}
                  <div><SubmitButton className="btn" type="submit">{T("tests.save")}</SubmitButton></div>
                </form>
                <ConfirmDelete action={deleteTestAction} summary={T("tests.delete.summary")} warning={T("tests.delete.warning")} tick={T("tests.delete.tick")} button={T("tests.delete.button")} fields={{ tenantId: id, testId: t.id }} />
              </Fold>
            );
          })}

          <Fold id="starters" title={T("tests.starters")} hint={T("tests.starters.help")}>
            <form action={addStarterTestsAction}>
              <input type="hidden" name="tenantId" value={id} />
              <SubmitButton className="btn" type="submit" disabled={suite.tests.length >= TEST_LIMITS.count}>{T("tests.starters.button")}</SubmitButton>
            </form>
          </Fold>

          <Fold id="new" open={["name", "says", "success", "long", "full"].includes(sp.err ?? "")} title={T("tests.add")} hint={T("tests.add.help")}>
            <form action={saveTestAction} className="stack">
              <input type="hidden" name="tenantId" value={id} />
              {fields({ name: "", says: "", success: "", good: "", bad: "" })}
              <div><SubmitButton className="btn" type="submit" disabled={suite.tests.length >= TEST_LIMITS.count}>{T("tests.addButton")}</SubmitButton></div>
            </form>
          </Fold>
        </div>
      )}
    </>
  );
}
