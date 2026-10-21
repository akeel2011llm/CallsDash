import { createHash } from "node:crypto";
import { buildAgentConfig, knowledgeText, toolDefinitions, widgetHostnames } from "./agent-config";
import { buildExtras, withExtras, type ExtraGroup } from "./agent-extras";
import { ElevenLabsError, type ElevenLabsApi } from "./elevenlabs-api";
import type { Data } from "./data/demo";

export class SyncError extends Error {
  constructor(public code: "no_api_key" | "no_secret" | "bad_secret" | "no_app_url" | "unknown_client" | "failed", detail?: string) { super(detail ?? code); }
}

export interface SyncDeps {
  api: ElevenLabsApi;
  data: Pick<Data, "getTenant" | "getDoctors" | "getAgent" | "getKnowledge" | "saveAgent" | "getSetting" | "setSetting" | "setIntegrations" | "setChannelStatus">;
  /** Public address of this app, e.g. https://www.callsdash.com (no trailing slash). ElevenLabs calls back here. */
  appUrl: string;
  toolsSecret: string;
  initSecret: string;
}

export const TOOLS_KEY = "elevenlabs.tools";
/** `url` is the address the tools call, so the Test page can show it when it differs from this app's address. */
export interface ToolsSetting { ids: Record<string, string>; hash: string; url?: string }

const toolsHash = (appUrl: string, secret: string) => createHash("sha256").update(JSON.stringify(toolDefinitions(appUrl, secret))).digest("hex");

/**
 * Whether the booking tools in ElevenLabs match this app: created, calling `appUrl`, with today's secret and definitions.
 * When `current` is false, ElevenLabs is still calling an old address or sending an old secret until the next Sync.
 */
export async function toolsStatus(data: Pick<Data, "getSetting">, appUrl: string, secret: string | undefined) {
  const saved = (await data.getSetting(TOOLS_KEY)) as ToolsSetting | undefined;
  const created = Boolean(saved && Object.keys(saved.ids).length);
  return { created, url: saved?.url, current: Boolean(created && secret && saved?.hash === toolsHash(appUrl, secret)) };
}

/** The booking tools are shared by every client's agent, so they are created once and updated when their definition changes. */
async function ensureTools(d: SyncDeps): Promise<string[]> {
  const defs = toolDefinitions(d.appUrl, d.toolsSecret);
  const hash = toolsHash(d.appUrl, d.toolsSecret);
  const saved = (await d.data.getSetting(TOOLS_KEY)) as ToolsSetting | undefined;
  const ids: Record<string, string> = { ...(saved?.ids ?? {}) };
  const stale = saved?.hash !== hash;
  for (const [name, def] of Object.entries(defs)) {
    if (!ids[name]) ids[name] = (await d.api.createWebhookTool(def)).id;
    else if (stale) await d.api.updateTool(ids[name], def);
  }
  if (stale || saved?.url !== d.appUrl || Object.keys(ids).length !== Object.keys(saved?.ids ?? {}).length) await d.data.setSetting(TOOLS_KEY, { ids, hash, url: d.appUrl } satisfies ToolsSetting);
  return Object.values(ids);
}

/**
 * Applies the optional settings. First tries them all together with the core settings. If ElevenLabs refuses, the core
 * settings are applied alone and each group is added one by one, so one refused group costs only itself.
 */
export async function applyExtras(api: ElevenLabsApi, agentId: string, core: Record<string, unknown>, groups: ExtraGroup[]): Promise<{ group: string; detail: string }[]> {
  try {
    await api.updateAgent(agentId, withExtras(core, groups));
    return [];
  } catch {
    /* find out which group it was */
  }
  await api.updateAgent(agentId, core); // the core agent must always be accepted
  const accepted: ExtraGroup[] = [];
  const warnings: { group: string; detail: string }[] = [];
  for (const g of groups) {
    try {
      await api.updateAgent(agentId, withExtras(core, [...accepted, g]));
      accepted.push(g);
    } catch (e) {
      warnings.push({ group: g.name, detail: (e instanceof Error ? e.message : "refused").slice(0, 300) });
    }
  }
  return warnings;
}

/**
 * Makes the client's ElevenLabs agent match CallsDash: prompt and style, voices, booking tools, knowledge base and widget
 * allow-list. Creates the agent the first time. Safe to run again at any time.
 */
export async function syncAgent(d: SyncDeps, tenantId: string, actor: string): Promise<{ agentId: string; created: boolean; warnings: { group: string; detail: string }[] }> {
  const tenant = await d.data.getTenant(tenantId);
  if (!tenant) throw new SyncError("unknown_client");
  const settings = await d.data.getAgent(tenantId);
  const prevDoc = tenant.integrations.elevenlabs?.kbDocId;
  let newDoc: { id: string; name: string } | undefined;
  try {
    const toolIds = await ensureTools(d);
    const items = await d.data.getKnowledge(tenantId);
    if (items.length) {
      const name = `Knowledge: ${tenant.name}`.slice(0, 100);
      newDoc = { id: (await d.api.createKnowledgeText({ name, text: knowledgeText(items) })).id, name };
    }
    const doctors = await d.data.getDoctors(tenantId);
    const config = buildAgentConfig({ tenant, settings, doctors, toolIds, knowledgeDoc: newDoc, appUrl: d.appUrl, initSecret: d.initSecret });
    let agentId = settings.elevenLabsAgentId;
    const created = !agentId;
    if (!agentId) {
      agentId = (await d.api.createAgent(config)).agent_id;
      await d.data.saveAgent(tenantId, { ...settings, elevenLabsAgentId: agentId }, actor, "Created the ElevenLabs agent");
    }
    const warnings = await applyExtras(d.api, agentId, config, buildExtras({ tenant, doctors }));
    if (prevDoc && prevDoc !== newDoc?.id) await d.api.deleteKnowledge(prevDoc).catch(() => undefined); // the old copy is no longer attached
    await d.data.setIntegrations(tenantId, { ...tenant.integrations, elevenlabs: { kbDocId: newDoc?.id, syncedAt: new Date().toISOString(), widgetHosts: widgetHostnames(tenant, d.appUrl), ...(warnings.length ? { warnings } : {}) } }, actor, created ? "Created the ElevenLabs agent" : "Synced the agent to ElevenLabs");
    if (tenant.allowedDomains.length) await d.data.setChannelStatus(tenantId, "website", "connected", actor);
    return { agentId, created, warnings };
  } catch (e) {
    if (newDoc) await d.api.deleteKnowledge(newDoc.id).catch(() => undefined);
    const detail = e instanceof ElevenLabsError ? e.message : e instanceof Error ? e.message : "unknown error";
    await d.data.setIntegrations(tenantId, { ...tenant.integrations, elevenlabs: { ...tenant.integrations.elevenlabs, error: detail.slice(0, 300) } }, actor, `ElevenLabs sync failed: ${detail.slice(0, 120)}`);
    if (e instanceof SyncError) throw e;
    throw new SyncError("failed", detail);
  }
}
