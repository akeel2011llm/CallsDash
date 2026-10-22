/**
 * Why ElevenLabs refused the last save of a studio section. The reason is kept here and the address only says there is one,
 * so the page shows words this app wrote, never words that came in through a link someone else made.
 */
import { SECTIONS, type SectionId } from "./agent-studio";

export const failKey = (tenantId: string) => `studio.fail.${tenantId}`;

export interface SavedFail { section: SectionId; detail: string; at: string }

/** A refusal is only shown for a few minutes: an old link must not bring back a reason that no longer applies. */
const FRESH_MS = 10 * 60_000;
const MAX_DETAIL = 300;

export const failRecord = (section: SectionId, detail: string, now = new Date()): SavedFail => ({ section, detail: detail.slice(0, MAX_DETAIL), at: now.toISOString() });

/** The reason to show for `section`, or null when there is none, it belongs to another section, or it is no longer fresh. */
export function failToShow(saved: unknown, section: SectionId, now = Date.now()): string | null {
  if (!saved || typeof saved !== "object") return null;
  const { section: was, detail, at } = saved as Partial<SavedFail>;
  if (was !== section || !SECTIONS.includes(was) || typeof detail !== "string" || !detail.trim() || typeof at !== "string") return null;
  const age = now - Date.parse(at);
  return Number.isFinite(age) && age >= 0 && age <= FRESH_MS ? detail.slice(0, MAX_DETAIL) : null;
}
