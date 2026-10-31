import Link from "next/link";
import { getT, type Key } from "@/lib/i18n";
import { fmtDateTime } from "@/lib/format";
import { getAgent, getDoctors, getItems, getToolCalls } from "@/lib/data";
import { assistantChecks } from "@/lib/assistant-check";
import type { Tenant } from "@/lib/types";
import { Fold } from "./Fold";
import { Badge } from "./ui";

const TONE = { ok: "ok", warn: "warn", bad: "bad" } as const;

/** Admin client page: why the assistant may not do what the screens say (see lib/assistant-check.ts), plus its latest tool calls. */
export async function AssistantCheck({ tenant }: { tenant: Tenant }) {
  const [{ t, locale }, agent, doctors, items, calls] = await Promise.all([
    getT(tenant), getAgent(tenant.id), getDoctors(tenant.id), getItems(tenant.id), getToolCalls(tenant.id, 15),
  ]);
  const checks = assistantChecks({ tenant, agentId: agent.elevenLabsAgentId, doctors, items, calls });
  const bad = checks.filter((c) => c.state === "bad").length;
  const warn = checks.filter((c) => c.state === "warn").length;
  const say = (k: string, vars: Record<string, string | number> = {}) =>
    Object.entries(vars).reduce((s, [n, v]) => s.replaceAll(`{${n}}`, n === "at" ? fmtDateTime(String(v), locale) : String(v)), t(k as Key));
  const channels = `/admin/clients/${tenant.id}/channels`;
  return (
    <Fold id="check" open={bad > 0} title={t("check.title")} hint={t("check.help")}
      badge={<Badge tone={bad ? "bad" : warn ? "warn" : "ok"}>{bad ? say("check.badge.bad", { n: bad }) : warn ? say("check.badge.warn", { n: warn }) : t("check.badge.ok")}</Badge>}>
      <ul className="check-list">
        {checks.map((c) => (
          <li key={c.id}>
            <Badge tone={TONE[c.state]}>{t(`check.state.${c.state}` as Key)}</Badge>
            <span>{say(`check.${c.id}.${c.state}`, c.vars)}</span>
          </li>
        ))}
      </ul>
      <p className="muted" style={{ margin: 0 }}><Link href={channels}>{t("nav.channels")}</Link> · <Link href={`/admin/clients/${tenant.id}/data`}>{t("check.data")}</Link></p>
      <h3 style={{ margin: 0 }}>{t("check.calls")}</h3>
      {calls.length === 0 ? <p className="muted" style={{ margin: 0 }}>{t("check.calls.none")}</p> : (
        <div className="table-wrap">
          <table>
            <tbody>
              {calls.map((c) => (
                <tr key={c.id}>
                  <td><small>{fmtDateTime(c.at, locale)}</small></td>
                  <td><code>{c.tool}</code></td>
                  <td><Badge tone={c.ok ? "ok" : "bad"}>{t(c.ok ? "check.call.ok" : "check.call.failed")}</Badge></td>
                  <td><small className="muted">{c.detail}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Fold>
  );
}
