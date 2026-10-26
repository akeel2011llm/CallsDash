import Link from "next/link";
import { getT, type Key } from "@/lib/i18n";
import { appUrl } from "@/lib/app-url";
import { AGENT_VERSION } from "@/lib/agent-config";
import { getAgent, getWallet } from "@/lib/data";
import { syncAgentAction } from "@/lib/channel-actions";
import type { Tenant } from "@/lib/types";
import { AgentTry } from "./AgentTry";
import { SubmitButton } from "./SubmitButton";
import { Notice } from "./ui";

// Quick starts for the chat, in the language being tried (not the dashboard's): the usual questions a clinic gets.
const SUGGESTIONS_EN = ["What are your opening hours?", "I'd like to book an appointment", "I want to check my booking", "I need to cancel my appointment"];
const SUGGESTIONS_AR = ["متى أوقات الدوام؟", "أبغى أحجز موعد", "أبغى أتأكد من موعدي", "أبغى ألغي موعدي"];
const SYNC_ERRORS = ["no_api_key", "no_secret", "bad_secret", "no_app_url", "unknown_client", "connected", "failed"];

/**
 * "Try the assistant": the clinic's live agent on its own screen, for testing the knowledge base and bookings and for
 * showing to new clients. On the admin's client page (`admin`) it also offers Sync when the agent is behind.
 */
export async function TryAssistant({ tenant, admin, returnTo, sp = {} }: { tenant: Tenant; admin?: boolean; returnTo?: string; sp?: { saved?: string; error?: string } }) {
  const [{ t, locale }, agent, wallet, url] = await Promise.all([getT(), getAgent(tenant.id), getWallet(tenant.id), appUrl()]);
  const el = tenant.integrations.elevenlabs;
  let host = "";
  try { host = new URL(url).hostname; } catch { /* no address: nothing to compare */ }
  const agentId = agent.elevenLabsAgentId;
  // the widget only runs on hosts the agent allows; Sync adds this app's own address
  const connected = el?.managed === false; // an agent connected by ID: CallsDash does not change it
  const blocked = Boolean(agentId && !connected && host && !el?.widgetHosts?.includes(host));
  const outdated = Boolean(agentId && !connected && (el?.version ?? 1) < AGENT_VERSION);
  const paused = tenant.status === "suspended" || (wallet.balance <= 0 && tenant.zeroBalancePolicy === "pause");
  const syncError = sp.error && SYNC_ERRORS.includes(sp.error) ? sp.error : null;
  const sync = admin && agentId && !connected && (
    <form action={syncAgentAction}>
      <input type="hidden" name="tenantId" value={tenant.id} /><input type="hidden" name="returnTo" value={returnTo ?? `/admin/clients/${tenant.id}`} />
      <SubmitButton className={`btn small${blocked || outdated ? "" : " ghost"}`} type="submit">{t("try.update")}</SubmitButton>
    </form>
  );
  return (
    <section className="card stack" id="try">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>{t("try.title")}</h2>
        {sync}
      </div>
      {!agentId ? (
        <Notice tone="warn">
          {t(admin ? "try.noAgent.admin" : "try.noAgent.client")}{" "}
          {admin && <Link href={`/admin/clients/${tenant.id}/channels`}>{t("nav.channels")}</Link>}
        </Notice>
      ) : (
        <>
          <p className="muted" style={{ margin: 0 }}>{t("try.help")}</p>
          {(sp.saved === "synced" || sp.saved === "created") && <Notice tone="ok">{t("try.synced")}</Notice>}
          {syncError && <Notice tone="warn">{syncError === "failed" ? `${t("try.syncFailed")} ${el?.error ?? ""}` : t(`channels.err.${syncError}` as Key)}</Notice>}
          {admin && connected && <Notice tone="ok">{t("try.connected.admin")}</Notice>}
          {(blocked || outdated) && <Notice tone="warn">{t(admin ? "try.behind.admin" : "try.behind.client")}</Notice>}
          {paused && <Notice tone="warn">{t(admin ? "try.paused.admin" : "try.paused.client")}</Notice>}
          <AgentTry
            agentId={agentId}
            defaultLanguage={locale === "ar" ? "ar" : "en"}
            openingHours={tenant.openingHours}
            suggestions={{ en: SUGGESTIONS_EN, ar: SUGGESTIONS_AR }}
            labels={{
              suggestions: t("try.suggestions"), language: t("common.language"), widgetTitle: t("try.widget"), widgetHelp: t("try.widgetHelp"), chatTitle: t("try.chat"),
              chatHelp: t("try.chatHelp"), start: t("try.start"), placeholder: t("try.placeholder"), send: t("try.send"), newChat: t("try.new"),
              connecting: t("try.connecting"), working: t("try.working"), ended: t("try.ended"), failed: t("try.failed"), you: t("try.you"), assistant: t("try.assistant"),
            }}
          />
          <small className="muted">{t("try.realNote")}</small>
        </>
      )}
    </section>
  );
}
