import type { BusinessProfile } from "./business-types";
export type Locale = "en" | "ar";
export type Channel = "website" | "whatsapp" | "instagram" | "phone";
export type Outcome = "booked" | "answered" | "handed_off" | "abandoned";
export type BookingStatus = "confirmed" | "rescheduled" | "completed" | "cancelled" | "no_show";
export type BookingSource = "ai" | "staff" | "doctor";
export type BookingMessageStatus = "sending" | "sent" | "failed" | "skipped";
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

/** One conversation with a customer, kept on their record so staff and the assistant can see what happened before. */
export interface CustomerVisit {
  at: string;
  channel: Channel;
  conversationId?: string;
  summary: string;
}

/**
 * Someone the assistant has talked to, found again by phone number (the last 8 digits, so +973 and local forms match). The
 * assistant may greet a returning customer by first name; anything more (notes, history) is only given once the CPR number
 * the customer states matches the one on file.
 */
export interface Customer {
  id: string;
  tenantId: string;
  phone: string;
  name: string;
  /** The 9-digit CPR number, when the customer has given it. */
  cpr?: string;
  language?: Locale;
  email?: string;
  /** What staff or the assistant noted: preferences, things to remember. Not for medical details. */
  notes: string;
  createdAt: string;
  updatedAt: string;
  lastContactAt?: string;
  /** ElevenLabs conversation ids the assistant linked to this customer, so the post-call save finds them again. */
  conversationIds: string[];
  /** Newest first, at most 50. */
  history: CustomerVisit[];
  /** Answers to the client's own customer fields (lib/extra-fields.ts), by field key. */
  extra?: Record<string, string>;
}

/** Kinds of column a custom table can have (lib/custom-tables.ts checks and tidies each value). */
export type DataFieldType = "text" | "longtext" | "number" | "price" | "stock" | "yesno" | "choice" | "date" | "link";

/** One column of a custom table. `key` never changes once made, so renaming the label keeps every stored value. */
export interface DataField {
  key: string;
  label: string;
  labelAr?: string;
  type: DataFieldType;
  /** For "choice": the allowed answers. */
  options?: string[];
  required?: boolean;
}

/**
 * A table the admin designs for one client (milestone 6c of docs/reorganization.md): a price list, a stock list, a menu,
 * anything the catalogue's fixed columns do not fit. The first column names a row (import matches rows by it).
 */
export interface DataTable {
  id: string;
  tenantId: string;
  name: string;
  nameAr?: string;
  fields: DataField[];
  /** The client's managers may add, change and delete rows (the admin always may). */
  clientEdit: boolean;
  /** The assistant may search this table (find_record) and answer from it. */
  assistant: boolean;
  createdAt: string;
}

export interface DataRow {
  id: string;
  tableId: string;
  tenantId: string;
  /** By field key. Values are kept as tidy text ("12.5", "yes", "2026-11-03"). */
  values: Record<string, string>;
  updatedAt: string;
}

/**
 * Something the clinic offers that the assistant can look up and show: a product, treatment or package, with its details and
 * a photo. The photo is stored apart (see getItemImage) so lists stay light; `hasImage` says whether there is one.
 */
export interface Item {
  id: string;
  tenantId: string;
  name: string;
  nameAr?: string;
  details: string;
  detailsAr?: string;
  /** Free text, as the clinic wants it shown (for example "BHD 25" or "from BHD 40"). */
  price?: string;
  /** Extra words people may use for it, separated by commas, in either language. Helps the assistant find it. */
  keywords: string;
  /** Hidden items are never offered by the assistant or served as a picture. */
  active: boolean;
  hasImage: boolean;
  /** Changes whenever the item or its photo changes; makes the photo address new so caches never show an old picture. */
  updatedAt: string;
  createdAt: string;
}

export interface Permissions {
  editPrompt: boolean;
  editVoice: boolean;
  editBehaviour: boolean;
  editKnowledge: boolean;
  /** The Data screen (photos, texts, storage, import and export). The admin always has it; a clinic only when the admin grants it. Missing = no. */
  dataManager?: boolean;
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

/** An ElevenLabs agent a client is not using right now, with what CallsDash knew about it. */
export interface StashedAgent { id: string; name?: string; kbDocId?: string; syncedAt?: string; version?: number; managed?: boolean }

export interface AgentSettings {
  elevenLabsAgentId: string;
  /** What the assistant uses to find a returning customer: their phone number (the default) or their CPR number. Chosen by the clinic on the Customers screen. */
  customerLookup?: "phone" | "cpr";
  /** The Assistant studio's options (lib/agent-studio.ts). Read through `studioOf`, which fills in the defaults. */
  studio?: Partial<import("./agent-studio").AgentStudio>;
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
  /** Days the whole clinic is closed (public holidays). No one can book on them. */
  closures?: DateRange[];
  /** Local (Bahrain) opening intervals per weekday, keys "0" (Sunday) to "6" (Saturday), as ["HH:MM", "HH:MM"]. */
  openingHours: Record<string, [string, string][]>;
  channels: Record<Channel, "connected" | "pending" | "off">;
  /** Progress through the admin setup wizard and the checklist items an admin ticked by hand. */
  onboarding: Onboarding;
  /** Per-channel settings that are not secret (account ids, template names). Secrets live in `TenantSecrets`. */
  integrations: Integrations;
  /** Business type and its words (lib/business-types.ts). Missing on clients from before business types: they are clinics. */
  business?: BusinessProfile;
  createdAt: string;
}

export interface Integrations {
  elevenlabs?: { kbDocId?: string; syncedAt?: string; error?: string; /** Hostnames the widget was allowed on at the last sync. */ widgetHosts?: string[]; /** Extra settings ElevenLabs refused on the last sync; the agent still works without them. */ warnings?: { group: string; detail: string }[]; /** AGENT_VERSION (lib/agent-config.ts) at the last sync; older means the agent misses newer rules or tools. */ version?: number; /** Agents this client used before; each keeps its own knowledge document and sync state so the admin can switch back (lib/agent-switch.ts). */ others?: StashedAgent[]; /** False for an agent the admin connected by ID: CallsDash does not write to it on its own (auto-sync) until Sync is pressed. Missing means CallsDash manages it. */ managed?: boolean };
  whatsapp?: WhatsappSettings;
  /** `accountId` is the Instagram business account id Meta sends in webhooks; `inboundUrl` is the custom channel address copied from ElevenLabs. */
  instagram?: { accountId?: string; username?: string; inboundUrl?: string };
  phone?: { number?: string; provider?: "twilio" | "sip" | "other" };
}

/** A clinic's WhatsApp number and the booking confirmation it sends (lib/whatsapp.ts has the wording). */
export interface WhatsappSettings {
  /** From ElevenLabs: the WhatsApp page, the account menu, "Copy phone number ID". */
  phoneNumberId?: string;
  displayNumber?: string;
  /** The template's name in WhatsApp Manager. */
  confirmTemplate?: string;
  /** The template language used when a patient's own language has no template. */
  confirmTemplateLang?: string;
  /**
   * "full" sends every booking detail (the template of lib/whatsapp.ts FULL_TEMPLATE). "short" is the earlier four-detail
   * template. Missing = "short" for a clinic that already had a template saved, "full" for everyone else.
   */
  confirmWording?: "full" | "short";
  /** The languages the template was created in at Meta. Missing = only the main language. */
  templateLangs?: Locale[];
  /** False stops confirmations without disconnecting WhatsApp. Missing = on. */
  confirmations?: boolean;
  /** Printed in the confirmation: where the clinic is, how to call it, and a map link (added after the address). */
  address?: string;
  addressAr?: string;
  mapUrl?: string;
  phone?: string;
}

/** Tokens and shared secrets for a client's channels. Stored apart from the tenant row, never shown again after saving. */
export interface TenantSecrets {
  /** WhatsApp Cloud API access token (Meta), used only to send catalogue photos in a WhatsApp chat. */
  whatsappToken?: string;
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
  /** When the admin pressed Go live at the end of the setup wizard (only allowed once every required step is done). */
  liveAt?: string;
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

export type Role = "admin" | "manager" | "receptionist" | "doctor";

/** A person who can sign in. The password itself lives only in Supabase Auth. */
export interface Profile {
  id: string;
  /** Null for admins. */
  tenantId: string | null;
  role: Role;
  /** For a doctor: which of the clinic's doctors this sign-in belongs to. */
  doctorId?: string | null;
  fullName: string;
  email: string;
  /** A disabled person is refused at the next request even if their sign-in session is still valid. */
  disabled: boolean;
  /** Set when an admin gave a temporary password: the person must choose their own before doing anything else. */
  mustChangePassword: boolean;
  createdAt: string;
}

/** Whole local days, inclusive, as YYYY-MM-DD. Used for doctors' leave and clinic closures (holidays). */
export interface DateRange { from: string; to: string; note?: string }

export interface Doctor {
  id: string;
  tenantId: string;
  name: string;
  specialty: string;
  /** The key of the client's role this person has (lib/business-types.ts rolesOf). Missing = the client's first role. */
  role?: string;
  /** Answers to the client's own team member fields (lib/extra-fields.ts), by field key. */
  extra?: Record<string, string>;
  /** What the assistant tells customers about the doctor (experience, languages, what they treat), in English and Arabic. */
  about?: string;
  aboutAr?: string;
  color: string;
  googleCalendarId?: string;
  /** False while the doctor takes no new bookings (left, long leave). Existing bookings stay. Missing = true. */
  active?: boolean;
  /** The doctor's own weekly hours. Missing = the clinic's opening hours. */
  hours?: Record<string, [string, string][]> | null;
  timeOff?: DateRange[];
  /** When the doctor's photo was last set; missing means no photo. The photo itself is stored apart (getDoctorImage) so lists stay light. */
  photoAt?: string;
}

export interface Booking {
  id: string;
  tenantId: string;
  doctorId: string;
  patientName: string;
  patientPhone: string;
  /** The patient's 9-digit CPR number (Bahraini ID). Required for new bookings; bookings made before it was asked have none. */
  patientCpr?: string;
  service: string;
  startsAt: string;
  durationMin: number;
  status: BookingStatus;
  conversationId?: string;
  calendarEventId?: string;
  /** Free text kept by staff or the doctor. Also written into the Google Calendar event. */
  notes?: string;
  /** Who made the booking. Bookings made before this field existed read as "ai". */
  source?: BookingSource;
  /** The language the patient speaks or writes, for the WhatsApp confirmation. Missing = the clinic's main template language. */
  language?: Locale;
  /** The last attempt to send the patient their booking confirmation on WhatsApp. Missing = none was made. */
  message?: BookingMessage;
  /** Answers to the client's own booking fields (lib/extra-fields.ts), by field key. */
  extra?: Record<string, string>;
}

/** The booking confirmation sent on WhatsApp. "sent" means ElevenLabs accepted it; Meta can still decline it afterwards. */
export interface BookingMessage {
  status: BookingMessageStatus;
  /** When the attempt was made (ISO). */
  at: string;
  /** Why it failed, or why nothing was sent: a code such as bad_phone, or what the service answered. */
  detail?: string;
  /** The ElevenLabs conversation the message started; the patient's reply continues it. */
  conversationId?: string;
  /** The language of the template that was used. */
  lang?: Locale;
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
  /** When staff deleted the recording (the conversation's copy at ElevenLabs). The transcript and summary stay here. */
  recordingDeletedAt?: string;
}

/** A finished conversation as it arrives from ElevenLabs, before it is charged and stored. */
export type NewConversation = Omit<Conversation, "id" | "tenantId" | "creditsCharged" | "costUsd" | "flags" | "reviewed"> & {
  /** Flags ElevenLabs' own post-call analysis raised (the intent and urgency it read from the conversation). */
  aiFlags?: FlagKind[];
  /** What the conversation cost us in US dollars when the caller already worked it out with the client's AI model (lib/costing.ts); otherwise a flat estimate is recorded. */
  costUsd?: number;
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
  kind: "topup" | "package_renewal" | "rollover" | "usage" | "expiry" | "adjustment";
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

/** One call from the ElevenLabs agent to a booking tool, kept so the admin can see why a booking did or did not happen. */
export interface AgentToolCall {
  id: string;
  /** Empty when the call named an agent that belongs to no client. */
  tenantId?: string;
  at: string;
  tool: string;
  ok: boolean;
  /** The error code on failure (slot_taken, unknown_doctor, ...). */
  code?: string;
  /** What was asked and what came back, without the patient's full phone number. */
  detail: string;
  ms: number;
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
  | { role: "client"; tenantId: string; userId?: string; staffRole?: "manager" | "receptionist"; mustChangePassword?: boolean }
  | { role: "doctor"; tenantId: string; doctorId: string; userId?: string; mustChangePassword?: boolean };
