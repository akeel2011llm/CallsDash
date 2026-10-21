export type Locale = "en" | "ar";
export type Channel = "website" | "whatsapp" | "instagram" | "phone";
export type Outcome = "booked" | "answered" | "handed_off" | "abandoned";
export type BookingStatus = "confirmed" | "rescheduled" | "cancelled" | "no_show";
export type ArabicStyle = "gulf" | "msa";
export type BatchKind = "rollover" | "package" | "topup" | "payg";
export type ZeroBalancePolicy = "pause" | "overdraft";

export interface CreditBatch {
  id: string;
  tenantId: string;
  kind: BatchKind;
  amount: number;
  remaining: number;
  purchasedAt: string; // ISO
  expiresAt: string; // ISO
  note?: string;
  /** The package this batch belongs to (package and rollover batches). Empty on top-ups and on batches created before multi-package support. */
  planId?: string;
}

export interface Plan {
  id: string;
  /** Ended plans no longer renew or count towards billing; credits already paid for stay usable until they expire. */
  active: boolean;
  /** Catalogue package this plan was assigned from, and the signed contract it belongs to. Terms below are a copy: later catalogue edits never change a signed client. */
  packageId?: string;
  contractRef?: string;
  type: "package" | "payg";
  name: string;
  includedCredits: number; // package only
  monthlyPriceBhd: number; // package fee or PAYG dashboard fee
  pricePerCreditBhd: number; // top-up price (PAYG: the prepaid credit price)
  rolloverCap: number; // fraction of included credits that may roll over (0.5)
  periodStart: string; // ISO start of the current package period
}

/** A package AqeelLLM offers. Assigning one to a client copies its terms into the client's plans. */
export interface CatalogPackage {
  id: string;
  name: string;
  nameAr: string;
  description: string;
  type: "package" | "payg";
  includedCredits: number;
  monthlyPriceBhd: number;
  pricePerCreditBhd: number;
  rolloverCap: number;
  archived: boolean;
}

/** A message left for staff, or a request for a person to call the patient back (the agent could not or should not handle it). */
export interface StaffRequest {
  id: string;
  tenantId: string;
  kind: "message" | "handoff";
  name: string;
  phone: string;
  text: string;
  urgent: boolean;
  language: Locale;
  conversationId?: string;
  status: "open" | "done";
  createdAt: string;
  handledAt?: string;
}

export interface Permissions {
  editPrompt: boolean;
  editVoice: boolean;
  editBehaviour: boolean;
  editKnowledge: boolean;
}

export type SidebarStyle = "light" | "dark" | "brand";
export type RadiusStyle = "sharp" | "soft" | "round";
export type FontStyle = "modern" | "classic" | "friendly";
export type PatternStyle = "none" | "waves" | "dots" | "mesh";

/**
 * How a client's portal looks and what it says. Everything is optional beyond the name and colour;
 * an empty string means "not set" (that is how a field is cleared).
 */
export interface Branding {
  displayName: string;
  displayNameAr: string;
  primaryColor: string;
  accentColor?: string;
  /** A small image stored inline as a data: URL (PNG, JPEG, WebP or SVG, at most 150 KB). */
  logoUrl?: string;
  /** A photo or artwork (data: URL, at most 300 KB) behind the welcome banner and the sign-in cover. */
  coverUrl?: string;
  /** Decorative pattern over the banner and sign-in cover. */
  pattern?: PatternStyle;
  sidebar?: SidebarStyle;
  radius?: RadiusStyle;
  font?: FontStyle;
  welcome?: string;
  welcomeAr?: string;
  /** Shown under the sign-in form on the client's own login page. */
  tagline?: string;
  taglineAr?: string;
  supportPhone?: string;
  supportEmail?: string;
  supportWhatsapp?: string;
  /** Printed at the bottom of reports. */
  reportFooter?: string;
  hidePoweredBy?: boolean;
  domain?: string;
}

export type FlagKind = "emergency" | "complaint" | "lead";
export interface FlagRule {
  enabled: boolean;
  /** Extra words and phrases (any language) on top of the built-in ones. */
  keywords: string[];
  /** Also put an urgent entry in the Messages inbox when a call is flagged. */
  notifyStaff: boolean;
}
export type AlertRules = Record<FlagKind, FlagRule>;

export interface PromptSections {
  identity: string;
  languages: string;
  mayDo: string;
  neverDo: string;
  emergencies: string;
  handoff: string;
}

export interface AgentSettings {
  elevenLabsAgentId: string;
  prompt: PromptSections;
  temperature: number; // 0..1
  replyLength: "short" | "normal" | "detailed";
  formality: "casual" | "polite" | "formal";
  arabicWrittenStyle: ArabicStyle;
  voiceEn: string;
  voiceAr: string;
}

export interface AgentVersion {
  id: string;
  tenantId: string;
  createdAt: string;
  author: string;
  summary: string;
  settings: AgentSettings;
}

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: "live" | "error" | "suspended";
  branding: Branding;
  /** One or more packages / pay-as-you-go plans. All of their credits go into one shared wallet. */
  plans: Plan[];
  alertRules: AlertRules;
  permissions: Permissions;
  allowedDomains: string[];
  zeroBalancePolicy: ZeroBalancePolicy;
  lowBalanceThreshold: number; // fraction, 0.15
  retentionDays: number;
  calendarConnected: boolean;
  /** Local (Bahrain) opening intervals per weekday, keys "0" (Sunday) to "6" (Saturday), as ["HH:MM", "HH:MM"]. */
  openingHours: Record<string, [string, string][]>;
  channels: Record<Channel, "connected" | "pending" | "off">;
  /** Progress through the admin setup wizard and the checklist items an admin ticked by hand. */
  onboarding: Onboarding;
  /** Per-channel settings that are not secret (account ids, template names). Secrets live in `TenantSecrets`. */
  integrations: Integrations;
  createdAt: string;
}

export interface Integrations {
  elevenlabs?: { kbDocId?: string; syncedAt?: string; error?: string; /** Extra settings ElevenLabs refused on the last sync; the agent still works without them. */ warnings?: { group: string; detail: string }[] };
  whatsapp?: { phoneNumberId?: string; displayNumber?: string; confirmTemplate?: string; confirmTemplateLang?: string };
  /** `accountId` is the Instagram business account id Meta sends in webhooks; `inboundUrl` is the custom channel address copied from ElevenLabs. */
  instagram?: { accountId?: string; username?: string; inboundUrl?: string };
  phone?: { number?: string; provider?: "twilio" | "sip" | "other" };
}

/** Tokens and shared secrets for a client's channels. Stored apart from the tenant row, never shown again after saving. */
export interface TenantSecrets {
  /** Instagram messaging access token (Meta). */
  instagramToken?: string;
  /** ElevenLabs custom channel: the secret we send with each inbound message. */
  instagramInboundSecret?: string;
  /** ElevenLabs custom channel: the secret that signs replies to our reply webhook. */
  instagramReplySecret?: string;
}

/** Remembers which ElevenLabs conversation a person on a chat channel is in, so a chat continues instead of restarting. */
export interface ChatSession {
  tenantId: string;
  channel: Channel;
  /** The person's id on that channel (Instagram-scoped id). */
  externalId: string;
  conversationId: string;
  lastAt: string;
}

/** What the admin has confirmed by hand during setup; everything else on the checklist is worked out from the data. */
export interface Onboarding {
  /** Checklist items an admin marked as done (for things CallsDash cannot see, such as "hours confirmed with the clinic"). */
  done: string[];
  /** The last website scan, kept so the admin can review it before anything is applied. */
  scan?: SiteScan;
}

/** What a website scan found. Nothing here is applied to the client until the admin accepts it. */
export interface SiteScan {
  url: string;
  at: string;
  title: string;
  description: string;
  phones: string[];
  emails: string[];
  languages: Locale[];
  headings: string[];
  /** Readable page text, trimmed, ready to become knowledge items. */
  text: string;
}

export type Role = "admin" | "manager" | "receptionist";

/** A person who can sign in. The password itself lives only in Supabase Auth. */
export interface Profile {
  id: string;
  /** Null for admins. */
  tenantId: string | null;
  role: Role;
  fullName: string;
  email: string;
  /** A disabled person is refused at the next request even if their sign-in session is still valid. */
  disabled: boolean;
  /** Set when an admin gave a temporary password: the person must choose their own before doing anything else. */
  mustChangePassword: boolean;
  createdAt: string;
}

export interface Doctor {
  id: string;
  tenantId: string;
  name: string;
  specialty: string;
  color: string;
  googleCalendarId?: string;
}

export interface Booking {
  id: string;
  tenantId: string;
  doctorId: string;
  patientName: string;
  patientPhone: string;
  service: string;
  startsAt: string;
  durationMin: number;
  status: BookingStatus;
  conversationId?: string;
  calendarEventId?: string;
}

export interface TranscriptLine {
  role: "agent" | "patient";
  text: string;
  atSec: number;
}

export interface Conversation {
  id: string;
  tenantId: string;
  channel: Channel;
  mode: "voice" | "text";
  language: Locale;
  startedAt: string;
  durationSec: number;
  messages: number;
  outcome: Outcome;
  summary: string;
  sentiment: "positive" | "neutral" | "negative";
  transcript: TranscriptLine[];
  recordingUrl?: string;
  creditsCharged: number;
  costUsd: number;
  elevenLabsConversationId?: string;
  /** Why this conversation needs a person to look at it, found by the alert rules when it was recorded. */
  flags: FlagKind[];
  /** A person has looked at the flags. */
  reviewed: boolean;
}

/** A finished conversation as it arrives from ElevenLabs, before it is charged and stored. */
export type NewConversation = Omit<Conversation, "id" | "tenantId" | "creditsCharged" | "costUsd" | "flags" | "reviewed"> & {
  /** Flags ElevenLabs' own post-call analysis raised (the intent and urgency it read from the conversation). */
  aiFlags?: FlagKind[];
};

export interface KnowledgeItem {
  id: string;
  tenantId: string;
  question: string;
  answer: string;
  language: Locale;
}

export interface UnansweredQuestion {
  id: string;
  tenantId: string;
  text: string;
  count: number;
}

export interface LedgerEntry {
  id: string;
  tenantId: string;
  at: string;
  kind: "topup" | "package_renewal" | "rollover" | "usage" | "expiry";
  credits: number; // positive adds, negative deducts
  channel?: Channel;
  conversationId?: string;
  note?: string;
}

export interface Alert {
  id: string;
  tenantId: string;
  at: string;
  severity: "info" | "warning" | "error";
  message: string;
  resolved: boolean;
}

export interface AuditEntry {
  id: string;
  tenantId?: string;
  at: string;
  actor: string;
  action: string;
}

export interface Voice {
  id: string;
  name: string;
  language: Locale;
  gender: "female" | "male";
  sampleUrl?: string;
}

export type Session =
  | { role: "admin"; viewAsTenantId?: string; userId?: string; mustChangePassword?: boolean }
  | { role: "client"; tenantId: string; userId?: string; staffRole?: "manager" | "receptionist"; mustChangePassword?: boolean };
