/**
 * Saving one section of the Assistant studio. The change is checked, sent to the client's agent in ElevenLabs, and only
 * stored in CallsDash once ElevenLabs has accepted it, so a refused change is not saved here. The two can still differ later
 * (an optional group ElevenLabs refused, an edit made inside ElevenLabs); the "Live in ElevenLabs" panel shows that.
 */
import { defaultLlm, ttsAllowed, type ModelRow } from "./agent-catalog";
import { applySection, describeStudioChange, parseSection, resetSection, studioOf, type ParsedSection, type SectionId } from "./agent-studio";
import { SyncError, syncAgent, type SyncDeps } from "./agent-sync";
import { plainDetail } from "./elevenlabs-api";
import type { AgentSettings } from "./types";

export interface FieldError { field: string; key: string }

export type StudioOutcome =
  /** Something in the form is not allowed. Nothing was saved. */
  | { kind: "invalid"; errors: FieldError[] }
  /** ElevenLabs accepted it and CallsDash saved it. `warnings` lists optional groups ElevenLabs did not accept. */
  | { kind: "applied"; warnings: { group: string; detail: string }[] }
  /** Saved in CallsDash only, because the assistant cannot be reached yet (`reason`). It is sent at the next sync. */
  | { kind: "saved"; reason: "no_agent" | "connected" | "no_api_key" | "no_secret" | "bad_secret" | "no_app_url" }
  /** ElevenLabs refused it. Nothing was saved. */
  | { kind: "refused"; detail: string };

export interface ApplyDeps {
  data: SyncDeps["data"];
  /** How to reach ElevenLabs, or the reason it cannot be reached yet. */
  sync: SyncDeps | Exclude<SyncError["code"], "unknown_client" | "failed">;
  /** The rows of the model picker. */
  models: ModelRow[];
  /** True when the rows are ElevenLabs' own list (live or saved), so a model outside them was never offered. */
  listed: boolean;
}

export interface Change { section: SectionId; form?: FormData; reset?: boolean }

/** The checks that need to know what ElevenLabs offers; the form's own checks are in `parseSection`. */
export function checkChoices(section: SectionId, parsed: ParsedSection, current: AgentSettings, d: Pick<ApplyDeps, "models" | "listed">): FieldError[] {
  const errors: FieldError[] = [];
  const st = parsed.studio;
  if (section === "model") {
    const llm = st.llm || defaultLlm();
    const row = d.models.find((m) => m.id === llm);
    if (row && d.listed) {
      if (st.reasoningEffort && row.reasoningEfforts.length && !row.reasoningEfforts.includes(st.reasoningEffort)) errors.push({ field: "reasoningEffort", key: "studio.err.effort" });
      if (st.maxTokens && row.maxOutputTokens && st.maxTokens > row.maxOutputTokens) errors.push({ field: "maxTokens", key: "studio.err.tokensModel" });
    }
    if (st.backupModels) st.backupModels = st.backupModels.filter((m) => m !== llm); // the main model is not its own backup
  }
  if (section === "voice") {
    const was = studioOf(current);
    if (st.ttsModelEn && !ttsAllowed("en", st.ttsModelEn, was.ttsModelEn)) errors.push({ field: "ttsModelEn", key: "studio.err.ttsLang" });
    if (st.ttsModelAr && !ttsAllowed("ar", st.ttsModelAr, was.ttsModelAr)) errors.push({ field: "ttsModelAr", key: "studio.err.ttsLang" });
  }
  return errors;
}

export async function applyStudioChange(d: ApplyDeps, tenantId: string, actor: string, change: Change): Promise<StudioOutcome> {
  const current = await d.data.getAgent(tenantId);
  let candidate: AgentSettings;
  if (change.reset) {
    candidate = resetSection(current, change.section);
  } else {
    if (!change.form) throw new Error("a section needs its form");
    const ids = d.models.map((m) => m.id);
    const parsed = parseSection(change.section, change.form, current, d.listed ? { llms: ids, backups: ids } : {});
    const errors = [...parsed.errors, ...checkChoices(change.section, parsed, current, d)];
    if (errors.length) return { kind: "invalid", errors };
    candidate = applySection(current, change.section, parsed);
  }
  return commitCandidate(d, tenantId, actor, current, candidate, describeStudioChange(current, candidate));
}

/**
 * Sends a candidate settings set to the client's agent and stores it once ElevenLabs accepted it (or only stores it, when the agent
 * cannot be reached yet). The sync is a full one, so it also puts CallsDash's values over anything edited by hand in ElevenLabs.
 */
export async function commitCandidate(d: ApplyDeps, tenantId: string, actor: string, current: AgentSettings, candidate: AgentSettings, summary: string): Promise<StudioOutcome> {
  const store = () => d.data.saveAgent(tenantId, candidate, actor, summary);
  if (!current.elevenLabsAgentId) { await store(); return { kind: "saved", reason: "no_agent" }; }
  if (typeof d.sync === "string") { await store(); return { kind: "saved", reason: d.sync }; }
  try {
    const r = await syncAgent(d.sync, tenantId, actor, { settings: candidate, keepKnowledge: true, quiet: true });
    await store();
    return { kind: "applied", warnings: r.warnings };
  } catch (e) {
    if (e instanceof SyncError && e.code !== "failed") {
      if (e.code === "unknown_client") throw e;
      await store();
      return { kind: "saved", reason: e.code };
    }
    return { kind: "refused", detail: plainDetail(e instanceof Error ? e.message : "refused").slice(0, 400) };
  }
}

/** The checks that need ElevenLabs' lists, for a whole settings set (a profile changes every section at once). */
export function checkCandidate(candidate: AgentSettings, current: AgentSettings, d: Pick<ApplyDeps, "models" | "listed">): FieldError[] {
  const st = studioOf(candidate);
  const parsed: ParsedSection = { studio: { ...st, backupModels: [...st.backupModels] }, top: {}, errors: [] };
  const errors: FieldError[] = [];
  if (d.listed && st.llm && !d.models.some((m) => m.id === st.llm)) errors.push({ field: "llm", key: "studio.err.model" });
  errors.push(...checkChoices("model", parsed, current, d), ...checkChoices("voice", parsed, current, d));
  return errors;
}
