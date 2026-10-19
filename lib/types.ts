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
}

export interface Plan {
  type: "package" | "payg";
  name: string;
  includedCredits: number; // package only
  monthlyPriceBhd: number; // package fee or PAYG dashboard fee
  pricePerCreditBhd: number; // top-up price (PAYG: the prepaid credit price)
  rolloverCap: number; // fraction of included credits that may roll over (0.5)
  periodStart: string; // ISO start of the current package period
}

export interface Permissions {
  editPrompt: boolean;
  editVoice: boolean;
  editBehaviour: boolean;
  editKnowledge: boolean;
}

export interface Branding {
  displayName: string;
  displayNameAr: string;
  primaryColor: string;
  logoUrl?: string;
  domain?: string;
}

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
  plan: Plan;
  permissions: Permissions;
  allowedDomains: string[];
  zeroBalancePolicy: ZeroBalancePolicy;
  lowBalanceThreshold: number; // fraction, 0.15
  retentionDays: number;
  calendarConnected: boolean;
  channels: Record<Channel, "connected" | "pending" | "off">;
  createdAt: string;
}

export interface Doctor {
  id: string;
  tenantId: string;
  name: string;
  specialty: string;
  color: string;
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
}

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
  | { role: "admin"; viewAsTenantId?: string }
  | { role: "client"; tenantId: string };
