import { requireClient } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { getAgent } from "@/lib/data";
import { saveAgentAction } from "@/lib/actions";
import { Notice, PageHead } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";

export default async function AgentPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const { tenant } = await requireClient();
  const { saved } = await searchParams;
  const { t } = await getT(tenant);
  const agent = await getAgent(tenant.id);
  const sections = ["identity", "languages", "mayDo", "neverDo", "emergencies", "handoff"] as const;
  const lockPrompt = !tenant.permissions.editPrompt;
  const lockBeh = !tenant.permissions.editBehaviour;
  return (
    <>
      <PageHead title={t("agent.title")} />
      {saved && <Notice tone="ok">{t("agent.saved")}</Notice>}
      <form action={saveAgentAction} className="card stack">
        <input type="hidden" name="returnTo" value="/app/agent" />
        <h2>{t("agent.prompt")}</h2>
        {lockPrompt && <Notice tone="warn">{t("common.locked")}</Notice>}
        <fieldset disabled={lockPrompt}>
          {sections.map((s) => (
            <label key={s}>
              {t(`agent.prompt.${s}` as "agent.prompt.identity")}
              <textarea name={`prompt.${s}`} defaultValue={agent.prompt[s]} maxLength={2000} />
            </label>
          ))}
        </fieldset>
        <div><SubmitButton className="btn" type="submit" disabled={lockPrompt}>{t("common.save")}</SubmitButton></div>
      </form>

      <form action={saveAgentAction} className="card stack">
        <input type="hidden" name="returnTo" value="/app/agent" />
        <h2>{t("agent.behaviour")}</h2>
        {lockBeh && <Notice tone="warn">{t("common.locked")}</Notice>}
        <fieldset disabled={lockBeh}>
          <label>
            {t("agent.temperature")}
            <input type="range" name="temperature" min="0" max="1" step="0.05" defaultValue={agent.temperature} />
            <span className="row" style={{ justifyContent: "space-between" }}>
              <small className="muted">{t("agent.precise")}</small><small className="muted">{t("agent.friendly")}</small>
            </span>
          </label>
          <label>{t("agent.replyLength")}
            <select name="replyLength" defaultValue={agent.replyLength}>
              <option value="short">{t("agent.short")}</option><option value="normal">{t("agent.normal")}</option><option value="detailed">{t("agent.detailed")}</option>
            </select>
          </label>
          <label>{t("agent.formality")}
            <select name="formality" defaultValue={agent.formality}>
              <option value="casual">{t("agent.casual")}</option><option value="polite">{t("agent.polite")}</option><option value="formal">{t("agent.formal")}</option>
            </select>
          </label>
          <label>{t("agent.arabicStyle")}
            <select name="arabicWrittenStyle" defaultValue={agent.arabicWrittenStyle}>
              <option value="gulf">{t("agent.gulf")}</option><option value="msa">{t("agent.msa")}</option>
            </select>
            <small className="muted">{t("agent.arabicStyle.help")}</small>
          </label>
        </fieldset>
        <div><SubmitButton className="btn" type="submit" disabled={lockBeh}>{t("common.save")}</SubmitButton></div>
      </form>
    </>
  );
}
