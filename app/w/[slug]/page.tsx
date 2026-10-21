import type { Metadata } from "next";
import { headers } from "next/headers";
import { agentVariables } from "@/lib/agent-context";
import { getAgent, getWallet, listTenants } from "@/lib/data";
import { dictionaries } from "@/lib/i18n";
import { consoleLabels } from "@/lib/console-labels";
import { AgentConsole } from "@/components/AgentConsole";
import { WidgetFrame } from "@/components/WidgetFrame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const hostOf = (url: string | null) => { try { return url ? new URL(url).hostname.toLowerCase() : null; } catch { return null; } };
const onList = (host: string, domains: string[]) => domains.some((d) => host === d || host.endsWith(`.${d}`));

/**
 * The website widget's conversation, opened by public/widget.js in a frame on the clinic's site (after consent).
 * Runs CallsDash's own console so the voice can be made louder on phones. Only the clinic's own sites may show it.
 */
export default async function WidgetPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ lang?: string }> }) {
  const [{ slug }, sp, h] = await Promise.all([params, searchParams, headers()]);
  const lang = sp.lang === "ar" ? "ar" : "en";
  const d = dictionaries[lang];
  const tenant = (await listTenants()).find((t) => t.slug === slug);
  const parent = hostOf(h.get("referer"));
  const own = (h.get("x-forwarded-host") ?? h.get("host") ?? "").toLowerCase();
  const allowed = Boolean(tenant) && (!parent || parent === own || onList(parent, tenant!.allowedDomains));
  const agentId = tenant && allowed ? (await getAgent(tenant.id)).elevenLabsAgentId : undefined;
  const wallet = tenant && agentId ? await getWallet(tenant.id) : undefined;
  const paused = !tenant || tenant.status === "suspended" || (wallet !== undefined && wallet.balance <= 0 && tenant.zeroBalancePolicy === "pause");
  const name = tenant ? (lang === "ar" ? tenant.branding.displayNameAr || tenant.branding.displayName : tenant.branding.displayName) || tenant.name : "";
  return (
    <WidgetFrame lang={lang} title={name} color={tenant?.branding.primaryColor} closeLabel={d["console.close"]} allowedHosts={tenant && allowed ? [own, ...tenant.allowedDomains] : []}
      blocked={d["w.notAllowed"]}>
      {!tenant || !allowed ? <p>{d["w.notAllowed"]}</p>
        : paused ? <p>{d["widget.paused"]}</p>
        : !agentId ? <p>{d["w.notAllowed"]}</p>
        : <AgentConsole agentId={agentId} language={lang} labels={consoleLabels(lang)} height={220} variables={agentVariables(tenant, new Date(), { channel: "website" })} />}
    </WidgetFrame>
  );
}
