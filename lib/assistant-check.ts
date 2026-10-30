import { AGENT_VERSION } from "./agent-config";
import type { AgentToolCall, Doctor, Item, Tenant } from "./types";

export type CheckId = "agent" | "managed" | "version" | "syncError" | "fresh" | "photos" | "hidden" | "lookups";
export interface Check { id: CheckId; state: "ok" | "warn" | "bad"; vars?: Record<string, string | number> }

/**
 * What the admin needs to know when the assistant does not do what the client page says it should (for example "no photos"):
 * whether CallsDash can write to the agent, whether the agent has the latest rules and tools, what it has to show, and whether
 * it has actually looked anything up. Each line names the one button that fixes it (i18n keys check.<id>.<state>).
 */
export function assistantChecks(input: {
  tenant: Pick<Tenant, "integrations">;
  agentId?: string;
  doctors: Pick<Doctor, "active" | "photoAt">[];
  items: Pick<Item, "active" | "hasImage">[];
  calls: Pick<AgentToolCall, "tool" | "ok" | "at" | "detail">[];
}): Check[] {
  if (!input.agentId) return [{ id: "agent", state: "bad" }];
  const el = input.tenant.integrations.elevenlabs;
  const managed = el?.managed !== false;
  const out: Check[] = [{ id: "agent", state: "ok" }];
  out.push({ id: "managed", state: managed ? "ok" : "bad" });
  if (managed) {
    out.push({ id: "version", state: (el?.version ?? 1) >= AGENT_VERSION ? "ok" : "bad", vars: { have: el?.version ?? 1, need: AGENT_VERSION } });
    if (el?.error) out.push({ id: "syncError", state: "bad", vars: { error: el.error.slice(0, 200) } });
    // the instructions list which doctors have a photo, so a photo added after the last sync is unknown to the assistant
    const synced = el?.syncedAt ?? "";
    const late = input.doctors.filter((d) => d.active !== false && d.photoAt && d.photoAt > synced).length;
    out.push({ id: "fresh", state: late ? "warn" : "ok", vars: { n: late } });
  }
  const doctorPhotos = input.doctors.filter((d) => d.active !== false && d.photoAt).length;
  const itemPhotos = input.items.filter((i) => i.active && i.hasImage).length;
  out.push({ id: "photos", state: doctorPhotos + itemPhotos ? "ok" : "warn", vars: { doctors: doctorPhotos, items: itemPhotos } });
  const hidden = input.items.filter((i) => !i.active && i.hasImage).length;
  if (hidden) out.push({ id: "hidden", state: "warn", vars: { n: hidden } });
  const last = input.calls.filter((c) => c.tool === "find_item").sort((a, b) => b.at.localeCompare(a.at))[0];
  out.push(last
    ? { id: "lookups", state: last.ok ? "ok" : "bad", vars: { at: last.at, detail: last.detail.slice(0, 200) } }
    : { id: "lookups", state: "warn" });
  return out;
}
