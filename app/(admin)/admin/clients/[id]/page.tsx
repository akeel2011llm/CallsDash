import Link from "next/link";
import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n";
import { Notice, Stat } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { fmtDate, fmtNum } from "@/lib/format";
import { planNames } from "@/lib/plans";
import { getAgent, getTenant, getTopUpRequests, getWallet } from "@/lib/data";
import { adminTopUpAction } from "@/lib/actions";
import { adminDeclineTopUpAction } from "@/lib/manage-actions";
import { TryAssistant } from "@/components/TryAssistant";
import { AssistantCheck } from "@/components/AssistantCheck";
import { CopyChecklist } from "@/components/CopyChecklist";
import { Guide } from "@/components/Guide";
import { wizardFor } from "@/lib/setup-facts";

export default async function ClientOverview({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; error?: string; copied?: string }> }) {
  const { id } = await params;
  const { saved, error, copied } = await searchParams;
  const tenant = await getTenant(id);
  if (!tenant) notFound();
  const [{ t, locale }, w, agent, requests, wiz] = await Promise.all([getT(tenant), getWallet(id), getAgent(id), getTopUpRequests(), wizardFor(tenant)]);
  const phasesDone = wiz.phases.filter((p) => p.done).length;
  const asked = requests.filter((r) => r.tenantId === id);
  const returnTo = `/admin/clients/${id}`;
  return (
    <>
      {saved && saved !== "synced" && saved !== "created" && <Notice tone="ok">{t("agent.saved").split(".")[0]}.</Notice>}
      {copied && /^\d+\.\d+\.\d+$/.test(copied) && (() => {
        const [nd, nk, nr] = copied.split(".");
        return (
          <>
            <Notice tone="ok">{t("dup.done").replace("{doctors}", nd).replace("{knowledge}", nk).replace("{renamed}", nr)}</Notice>
            <Guide id="copy"><CopyChecklist t={t} /></Guide>
          </>
        );
      })()}
      {asked.length > 0 && (
        <Notice tone="warn">
          <Link href={`/admin/clients/${id}/billing`}>{t("ws.requests").replace("{n}", String(asked.length))}</Link>
          {asked.map((r) => (
            <span key={r.id} className="row" style={{ justifyContent: "space-between" }}>
              <span>{t("admin.request.line").replace("{n}", fmtNum(r.credits, locale, 0)).replace("{date}", fmtDate(r.at, locale))}</span>
              <span className="row">
                <form action={adminTopUpAction}>
                  <input type="hidden" name="tenantId" value={id} /><input type="hidden" name="returnTo" value={returnTo} />
                  <input type="hidden" name="credits" value={r.credits} /><input type="hidden" name="note" value="Top-up request" />
                  <SubmitButton className="btn small" type="submit">{t("admin.request.approve").replace("{n}", fmtNum(r.credits, locale, 0))}</SubmitButton>
                </form>
                <form action={adminDeclineTopUpAction}>
                  <input type="hidden" name="requestId" value={r.id} /><input type="hidden" name="returnTo" value={returnTo} />
                  <SubmitButton className="btn small ghost" type="submit">{t("admin.request.decline")}</SubmitButton>
                </form>
              </span>
            </span>
          ))}
        </Notice>
      )}
      {!tenant.onboarding.liveAt && (
        <Notice tone={phasesDone === wiz.phases.length ? "ok" : "warn"}>
          {t("wiz.overview").replace("{n}", String(phasesDone)).replace("{total}", String(wiz.phases.length))}{" "}
          <Link href={`/admin/clients/${id}/setup`}>{phasesDone === wiz.phases.length ? t("wiz.goLive") : t("wiz.continue")}</Link>
        </Notice>
      )}
      <div className="grid">
        <Stat label={t("admin.balance")} value={fmtNum(w.balance, locale, 1)} tone={w.low ? "warn" : undefined} hint={planNames(tenant.plans)} />
        <Stat label={t("common.status")} value={t(`status.${tenant.status}` as "status.live")} />
        <Stat label="Agent id" value={<code>{agent.elevenLabsAgentId || "–"}</code>} />
      </div>

      <TryAssistant tenant={tenant} admin returnTo={returnTo} sp={{ saved, error }} />
      <AssistantCheck tenant={tenant} />
    </>
  );
}
