import type { Data } from "./data/demo";
import type { CatalogApi } from "./elevenlabs-catalog";
import { ElevenLabsError } from "./elevenlabs-api";
import type { StashedAgent } from "./types";

export class SwitchError extends Error {
  constructor(public code: "unknown_client" | "bad_id" | "same" | "no_api_key" | "not_found" | "in_use" | "failed", detail?: string) { super(detail ?? code); }
}

export interface SwitchDeps {
  catalog: Pick<CatalogApi, "getAgent"> | null;
  data: Pick<Data, "getTenant" | "getAgent" | "saveAgent" | "setIntegrations" | "listTenants">;
}

export const AGENT_ID = /^agent_[A-Za-z0-9_]+$/;

/**
 * Points a client at another ElevenLabs agent the admin already made. Nothing is written inside either agent. The agent being
 * left keeps its knowledge document and sync state in `integrations.elevenlabs.others`, so switching back restores them.
 */
export async function switchAgent(d: SwitchDeps, tenantId: string, rawId: string, actor: string): Promise<{ agentId: string; name: string }> {
  const id = rawId.trim();
  if (!AGENT_ID.test(id)) throw new SwitchError("bad_id");
  const tenant = await d.data.getTenant(tenantId);
  if (!tenant) throw new SwitchError("unknown_client");
  const settings = await d.data.getAgent(tenantId);
  if (settings.elevenLabsAgentId === id) throw new SwitchError("same");
  if (!d.catalog) throw new SwitchError("no_api_key");
  for (const t of await d.data.listTenants()) {
    if (t.id !== tenantId && (await d.data.getAgent(t.id)).elevenLabsAgentId === id) throw new SwitchError("in_use", t.name);
  }
  let name = "";
  try {
    name = (await d.catalog.getAgent(id)).name ?? "";
  } catch (e) {
    if (e instanceof ElevenLabsError && (e.status === 404 || e.status === 422)) throw new SwitchError("not_found");
    throw new SwitchError("failed", e instanceof Error ? e.message : "unknown error");
  }

  const el = tenant.integrations.elevenlabs ?? {};
  const target = (el.others ?? []).find((o) => o.id === id);
  const others: StashedAgent[] = (el.others ?? []).filter((o) => o.id !== id);
  if (settings.elevenLabsAgentId) {
    const old = (el.others ?? []).find((o) => o.id === settings.elevenLabsAgentId);
    let oldName = old?.name;
    try { oldName = (await d.catalog.getAgent(settings.elevenLabsAgentId)).name ?? oldName; } catch { /* the name is only a label */ }
    others.push({ id: settings.elevenLabsAgentId, ...(oldName ? { name: oldName } : {}), ...(el.kbDocId ? { kbDocId: el.kbDocId } : {}), ...(el.syncedAt ? { syncedAt: el.syncedAt } : {}), ...(el.version !== undefined ? { version: el.version } : {}), ...(el.managed === false ? { managed: false } : {}) });
  }
  await d.data.saveAgent(tenantId, { ...settings, elevenLabsAgentId: id }, actor, `Connected the ElevenLabs agent ${name || id}`);
  await d.data.setIntegrations(tenantId, {
    ...tenant.integrations,
    elevenlabs: { managed: target ? target.managed !== false : false, ...(target?.kbDocId ? { kbDocId: target.kbDocId } : {}), ...(target?.syncedAt ? { syncedAt: target.syncedAt } : {}), ...(target?.version !== undefined ? { version: target.version } : {}), others },
  }, actor, `Now using the ElevenLabs agent ${name || id}`);
  return { agentId: id, name };
}
