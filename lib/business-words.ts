import { defaultPrompt } from "./seed";
import { relabel, vocabOf, type BusinessProfile } from "./business-types";
import type { AgentSettings, Tenant } from "./types";

type PromptKey = keyof AgentSettings["prompt"];

/**
 * The assistant's own sections (Role, Languages, ...) start as clinic text. When a client's business words change, every section
 * still exactly as it was written for it (the clinic text, or that text in the previous words) follows the new words; a section
 * the admin or client wrote themselves is never touched. Returns the new sections, or null when nothing changes. Pure.
 */
export function promptForWords(settings: AgentSettings, tenant: Pick<Tenant, "name" | "business">, next: BusinessProfile): AgentSettings["prompt"] | null {
  const base = defaultPrompt(tenant.name);
  const before = vocabOf(tenant, "en"), after = vocabOf({ business: next }, "en");
  const out = { ...settings.prompt };
  let changed = false;
  for (const k of Object.keys(base) as PromptKey[]) {
    const cur = settings.prompt[k];
    if (cur !== base[k] && cur !== relabel(base[k], "en", before)) continue;
    const want = relabel(base[k], "en", after);
    if (want !== cur) { out[k] = want; changed = true; }
  }
  return changed ? out : null;
}
