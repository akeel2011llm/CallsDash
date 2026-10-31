import type { Key } from "./i18n";
import type { Session } from "./types";

/**
 * Every setup guide or list of precautions a person can fold away or hide. The value is the translation key of its title,
 * shown on the screen and in the account settings where hidden guides are brought back. To make a new guide hideable, add it
 * here and wrap it in `<Guide id="...">` (components/Guide.tsx).
 */
export const GUIDES = {
  copy: "dup.careful.title",
  whatsapp: "channels.wa.make.title",
  catalogue: "catalogue.guide.title",
  waPhotos: "channels.wa.photo.guide.title",
  studioProfiles: "prof.guide.title",
  procedures: "proc.guide.title",
  agentTests: "tests.guide.title",
  data: "data.guide.title",
  tables: "tables.guide.title",
} as const satisfies Record<string, Key>;

export type GuideId = keyof typeof GUIDES;

export const GUIDE_IDS = Object.keys(GUIDES) as GuideId[];
export const isGuideId = (v: unknown): v is GuideId => typeof v === "string" && Object.hasOwn(GUIDES, v);

/** Which guides a person hid is remembered per person, so one admin's choice never hides a guide from someone else. */
export const guideOwnerKey = (s: Session) =>
  `guides.hidden.${s.userId ?? (s.role === "admin" ? "demo-admin" : `demo-${s.role}-${s.tenantId}`)}`;

/** The stored list read safely: only known ids, no repeats, whatever was saved before. */
export function readHidden(v: unknown): GuideId[] {
  return Array.isArray(v) ? [...new Set(v.filter(isGuideId))] : [];
}

export const hideGuide = (hidden: GuideId[], id: GuideId): GuideId[] => (hidden.includes(id) ? hidden : [...hidden, id]);
export const showGuide = (hidden: GuideId[], id: GuideId): GuideId[] => hidden.filter((x) => x !== id);
