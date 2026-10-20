import type {
  AgentSettings, Alert, Booking, Channel, Conversation, CreditBatch, Doctor, KnowledgeItem,
  LedgerEntry, Outcome, Tenant, TranscriptLine, UnansweredQuestion,
} from "./types";
import { addMonths, creditsFor, round2 } from "./credits";
import { DEFAULT_OPENING_HOURS } from "./availability";
import { DEFAULT_CATALOGUE } from "./plans";

export interface DB {
  tenants: Tenant[];
  agents: Record<string, AgentSettings>;
  agentVersions: import("./types").AgentVersion[];
  doctors: Doctor[];
  bookings: Booking[];
  conversations: Conversation[];
  knowledge: KnowledgeItem[];
  unanswered: UnansweredQuestion[];
  batches: CreditBatch[];
  ledger: LedgerEntry[];
  alerts: Alert[];
  audit: import("./types").AuditEntry[];
  staffRequests: import("./types").StaffRequest[];
  packages: import("./types").CatalogPackage[];
  topUpRequests: { id: string; tenantId: string; at: string; credits: number; status: "open" | "done" }[];
  seq: number;
}

export const USD_TO_BHD = 0.377;
export const ELEVENLABS_USD_PER_MIN = 0.08 + 0.05; // minute fee + estimated LLM cost per minute
export const ELEVENLABS_USD_PER_MSG = 0.003 + 0.002; // message fee + estimated LLM cost per message

const DAY = 86_400_000;

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export const defaultPrompt = (clinic: string) => ({
  identity: `You are the virtual receptionist of ${clinic}. Be warm, calm and concise. Introduce yourself as the clinic's AI assistant.`,
  languages: "Speak English or Gulf Arabic. Detect the language from the first words and stay in it. Switch if the patient switches.",
  mayDo: "Answer questions from the knowledge base, check availability, book, reschedule and cancel appointments, take messages.",
  neverDo: "Never give a diagnosis or medication advice. Never quote prices that are not in the knowledge base.",
  emergencies: "If the patient describes an emergency, tell them to call 999 immediately and stop the booking flow.",
  handoff: "Transfer to staff when the patient asks for a person, is upset, or you cannot help after two attempts.",
});

export function agent(id: string, clinic: string, over: Partial<AgentSettings> = {}): AgentSettings {
  return {
    elevenLabsAgentId: id,
    prompt: defaultPrompt(clinic),
    temperature: 0.3,
    replyLength: "normal",
    formality: "polite",
    arabicWrittenStyle: "gulf",
    voiceEn: "voice_en_f",
    voiceAr: "voice_ar_f",
    ...over,
  };
}

const transcripts = {
  booked: {
    en: (doc: string): TranscriptLine[] => [
      { role: "agent", text: "Hello, you are speaking with the clinic's AI assistant. This conversation is recorded to help us serve you. How can I help?", atSec: 0 },
      { role: "patient", text: "Hi, I would like to book an appointment with " + doc + " this week.", atSec: 9 },
      { role: "agent", text: "Of course. I have Wednesday at 10:30 or Thursday at 14:00. Which suits you?", atSec: 15 },
      { role: "patient", text: "Wednesday at 10:30 please.", atSec: 24 },
      { role: "agent", text: "Booked. You will receive a WhatsApp confirmation shortly. Anything else?", atSec: 30 },
      { role: "patient", text: "No, thank you.", atSec: 36 },
    ],
    ar: (doc: string): TranscriptLine[] => [
      { role: "agent", text: "هلا والله، معك المساعد الذكي للعيادة. المحادثة مسجلة لتحسين خدمتك. شلون أقدر أساعدك؟", atSec: 0 },
      { role: "patient", text: "أبي أحجز موعد مع " + doc + " هالأسبوع.", atSec: 8 },
      { role: "agent", text: "أبشر. عندي الأربعاء الساعة 10:30 أو الخميس الساعة 2:00. أيهم يناسبك؟", atSec: 15 },
      { role: "patient", text: "الأربعاء 10:30 زين.", atSec: 22 },
      { role: "agent", text: "تم الحجز، بتوصلك رسالة تأكيد على الواتساب. تبي شي ثاني؟", atSec: 28 },
    ],
  },
  answered: {
    en: (): TranscriptLine[] => [
      { role: "agent", text: "Hello, how can I help you today?", atSec: 0 },
      { role: "patient", text: "What are your opening hours on Friday?", atSec: 5 },
      { role: "agent", text: "On Fridays we are open from 4 pm to 9 pm.", atSec: 9 },
      { role: "patient", text: "Great, thanks.", atSec: 13 },
    ],
    ar: (): TranscriptLine[] => [
      { role: "agent", text: "هلا، كيف أقدر أخدمك؟", atSec: 0 },
      { role: "patient", text: "متى دوامكم يوم الجمعة؟", atSec: 5 },
      { role: "agent", text: "يوم الجمعة نفتح من 4 العصر إلى 9 المساء.", atSec: 9 },
    ],
  },
  handed_off: {
    en: (): TranscriptLine[] => [
      { role: "agent", text: "Hello, how can I help?", atSec: 0 },
      { role: "patient", text: "I need to speak with someone about my insurance claim.", atSec: 6 },
      { role: "agent", text: "I will pass you to our staff now and share what you told me.", atSec: 12 },
    ],
    ar: (): TranscriptLine[] => [
      { role: "agent", text: "هلا، كيف أقدر أساعدك؟", atSec: 0 },
      { role: "patient", text: "أبي أكلم أحد عن مطالبة التأمين.", atSec: 6 },
      { role: "agent", text: "بحولك لموظف الحين وبنقل له كلامك.", atSec: 12 },
    ],
  },
};

const summaries: Record<Outcome, { en: string[]; ar: string[] }> = {
  booked: {
    en: ["Patient booked a consultation and received a WhatsApp confirmation.", "New patient booked a check-up for next week."],
    ar: ["حجز المريض موعد استشارة ووصلته رسالة تأكيد على الواتساب.", "مريض جديد حجز فحص دوري للأسبوع القادم."],
  },
  answered: {
    en: ["Asked about Friday opening hours; answered from the knowledge base.", "Asked whether the clinic accepts Bupa insurance; confirmed."],
    ar: ["سأل عن دوام يوم الجمعة وتمت الإجابة من قاعدة المعرفة.", "سأل إذا العيادة تقبل تأمين بوبا وتم التأكيد."],
  },
  handed_off: {
    en: ["Insurance claim question; handed over to staff."],
    ar: ["سؤال عن مطالبة تأمين وتم التحويل إلى الموظفين."],
  },
  abandoned: {
    en: ["Caller left before stating a request."],
    ar: ["أنهى المتصل المحادثة قبل ذكر طلبه."],
  },
};

export function seed(): DB {
  const nowMs = Date.now();
  const today = new Date(nowMs);
  today.setUTCHours(0, 0, 0, 0);
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)).toISOString();
  const iso = (ms: number) => new Date(ms).toISOString();

  const tenants: Tenant[] = [
    {
      id: "t_alnoor", slug: "al-noor", name: "Al Noor Medical Center", status: "live",
      branding: { displayName: "Al Noor Medical Center", displayNameAr: "مركز النور الطبي", primaryColor: "#0e7c86", domain: "alnoor.example.bh" },
      plans: [{ id: "plan-1", active: true, type: "package", name: "Clinic package", includedCredits: 2500, monthlyPriceBhd: 199, pricePerCreditBhd: 0.08, rolloverCap: 0.5, periodStart: monthStart }],
      permissions: { editPrompt: true, editVoice: true, editBehaviour: true, editKnowledge: true },
      allowedDomains: ["alnoor.example.bh", "localhost"], zeroBalancePolicy: "pause", lowBalanceThreshold: 0.15,
      retentionDays: 90, calendarConnected: true, openingHours: DEFAULT_OPENING_HOURS,
      channels: { website: "connected", whatsapp: "connected", instagram: "pending", phone: "off" },
      createdAt: iso(nowMs - 40 * DAY),
    },
    {
      id: "t_smile", slug: "smile-dental", name: "Smile Dental Clinic", status: "live",
      branding: { displayName: "Smile Dental", displayNameAr: "عيادة الابتسامة", primaryColor: "#7c3aed", domain: "smile.example.bh" },
      plans: [{ id: "plan-1", active: true, type: "payg", name: "Pay as you go", includedCredits: 0, monthlyPriceBhd: 20, pricePerCreditBhd: 0.11, rolloverCap: 0, periodStart: monthStart }],
      permissions: { editPrompt: false, editVoice: true, editBehaviour: true, editKnowledge: true },
      allowedDomains: ["smile.example.bh", "localhost"], zeroBalancePolicy: "overdraft", lowBalanceThreshold: 0.15,
      retentionDays: 90, calendarConnected: false, openingHours: DEFAULT_OPENING_HOURS,
      channels: { website: "connected", whatsapp: "pending", instagram: "off", phone: "off" },
      createdAt: iso(nowMs - 12 * DAY),
    },
    {
      id: "t_physio", slug: "gulf-physio", name: "Gulf Physio Center", status: "error",
      branding: { displayName: "Gulf Physio", displayNameAr: "الخليج للعلاج الطبيعي", primaryColor: "#c2410c", domain: "physio.example.bh" },
      plans: [{ id: "plan-1", active: true, type: "package", name: "Clinic package", includedCredits: 2500, monthlyPriceBhd: 199, pricePerCreditBhd: 0.08, rolloverCap: 0.5, periodStart: monthStart }],
      permissions: { editPrompt: true, editVoice: true, editBehaviour: true, editKnowledge: true },
      allowedDomains: ["physio.example.bh"], zeroBalancePolicy: "pause", lowBalanceThreshold: 0.15,
      retentionDays: 90, calendarConnected: true, openingHours: DEFAULT_OPENING_HOURS,
      channels: { website: "connected", whatsapp: "connected", instagram: "off", phone: "off" },
      createdAt: iso(nowMs - 25 * DAY),
    },
  ];

  const agents: DB["agents"] = {
    t_alnoor: agent("agent_demo_alnoor", "Al Noor Medical Center"),
    t_smile: agent("agent_demo_smile", "Smile Dental Clinic", { formality: "casual", temperature: 0.45 }),
    t_physio: agent("agent_demo_physio", "Gulf Physio Center", { arabicWrittenStyle: "msa" }),
  };

  const doctors: Doctor[] = [
    { id: "d_hana", tenantId: "t_alnoor", name: "Dr. Hana Al Khalifa", specialty: "General practice", color: "#0e7c86" },
    { id: "d_omar", tenantId: "t_alnoor", name: "Dr. Omar Siddiqui", specialty: "Pediatrics", color: "#d97706" },
    { id: "d_layla", tenantId: "t_alnoor", name: "Dr. Layla Mansoor", specialty: "Dermatology", color: "#be185d" },
    { id: "d_sara", tenantId: "t_smile", name: "Dr. Sara Fakhro", specialty: "Dentistry", color: "#7c3aed" },
    { id: "d_yusuf", tenantId: "t_physio", name: "Yusuf Haddad", specialty: "Physiotherapy", color: "#c2410c" },
  ];

  const r = rng(42);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const names = ["Fatima Ahmed", "Mohammed Jasim", "Sara Hassan", "Ali Yusuf", "Maryam Salman", "Khalid Nasser", "Noor Abdulla", "Hassan Ebrahim"];
  const services = ["Consultation", "Check-up", "Follow-up", "Vaccination", "Skin review"];

  const bookings: Booking[] = [];
  const clinicDocs = (t: string) => doctors.filter((d) => d.tenantId === t);
  for (const t of ["t_alnoor", "t_smile", "t_physio"]) {
    const n = t === "t_alnoor" ? 26 : 8;
    for (let i = 0; i < n; i++) {
      const offset = Math.floor(r() * 16) - 5;
      const hourLocal = 9 + Math.floor(r() * 9);
      const startMs = today.getTime() + offset * DAY + (hourLocal - 3) * 3_600_000 + (r() > 0.5 ? 1_800_000 : 0);
      const past = startMs < nowMs;
      const status = past ? pick(["confirmed", "confirmed", "confirmed", "no_show", "cancelled"] as const)
        : pick(["confirmed", "confirmed", "confirmed", "rescheduled", "cancelled"] as const);
      bookings.push({
        id: `b_${t}_${i}`, tenantId: t, doctorId: pick(clinicDocs(t)).id,
        patientName: pick(names), patientPhone: `+973 3${Math.floor(1000000 + r() * 8999999)}`,
        service: pick(services), startsAt: iso(startMs), durationMin: 30, status,
      });
    }
  }

  const conversations: Conversation[] = [];
  const channels: Channel[] = ["website", "whatsapp", "whatsapp", "instagram", "website", "phone"];
  const outcomes: Outcome[] = ["booked", "booked", "answered", "answered", "answered", "handed_off", "abandoned"];
  for (const t of ["t_alnoor", "t_smile", "t_physio"]) {
    const n = t === "t_alnoor" ? 40 : 10;
    for (let i = 0; i < n; i++) {
      const channel = pick(channels.filter((c) => (t === "t_alnoor" ? c !== "phone" : c === "website" || c === "whatsapp")));
      const outcome = pick(outcomes);
      const lang = r() > 0.45 ? "en" : "ar";
      const mode = channel === "instagram" || (channel !== "phone" && r() > 0.55) ? "text" : "voice";
      const startedMs = nowMs - Math.floor(r() * 20 * DAY);
      const durationSec = mode === "voice" ? 40 + Math.floor(r() * 240) : 30 + Math.floor(r() * 200);
      const messages = mode === "text" ? 4 + Math.floor(r() * 14) : 0;
      const doc = pick(clinicDocs(t)).name;
      const tr = outcome === "booked" ? transcripts.booked[lang](doc)
        : outcome === "handed_off" ? transcripts.handed_off[lang]()
        : transcripts.answered[lang]();
      const credits = creditsFor({ mode, durationSec, messages });
      conversations.push({
        id: `c_${t}_${i}`, tenantId: t, channel, mode, language: lang, startedAt: iso(startedMs), durationSec, messages,
        outcome, summary: pick(summaries[outcome][lang]), sentiment: outcome === "handed_off" ? "negative" : pick(["positive", "positive", "neutral"] as const),
        transcript: outcome === "abandoned" ? [] : tr,
        recordingUrl: mode === "voice" ? undefined : undefined, // real URLs come from ElevenLabs via the webhook
        creditsCharged: credits,
        costUsd: round2(mode === "voice" ? (durationSec / 60) * ELEVENLABS_USD_PER_MIN : messages * ELEVENLABS_USD_PER_MSG),
      });
    }
  }
  conversations.sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  const used = (t: string, since: number) =>
    round2(conversations.filter((c) => c.tenantId === t && new Date(c.startedAt).getTime() >= since).reduce((s, c) => s + c.creditsCharged, 0));

  const monthMs = new Date(monthStart).getTime();
  const batches: CreditBatch[] = [
    // Al Noor: rollover first, then package, then a top-up
    { id: "cb_an_ro", tenantId: "t_alnoor", kind: "rollover", amount: 300, remaining: 300, purchasedAt: monthStart, expiresAt: addMonths(monthStart, 1), note: "Rollover from previous month" },
    { id: "cb_an_pk", tenantId: "t_alnoor", kind: "package", amount: 2500, remaining: round2(2500 - used("t_alnoor", monthMs)), purchasedAt: monthStart, expiresAt: addMonths(monthStart, 1), note: "Clinic package" },
    { id: "cb_an_tu", tenantId: "t_alnoor", kind: "topup", amount: 200, remaining: 200, purchasedAt: iso(nowMs - 60 * DAY), expiresAt: addMonths(iso(nowMs - 60 * DAY), 12), note: "Top-up" },
    // Smile: PAYG, nearly empty
    { id: "cb_sm_tu", tenantId: "t_smile", kind: "payg", amount: 100, remaining: 9.5, purchasedAt: iso(nowMs - 12 * DAY), expiresAt: addMonths(iso(nowMs - 12 * DAY), 12), note: "Prepaid credits" },
    { id: "cb_pt_pk", tenantId: "t_physio", kind: "package", amount: 2500, remaining: 1800, purchasedAt: monthStart, expiresAt: addMonths(monthStart, 1), note: "Clinic package" },
  ];

  const ledger: LedgerEntry[] = [
    { id: "l1", tenantId: "t_alnoor", at: monthStart, kind: "package_renewal", credits: 2500, note: "Clinic package" },
    { id: "l2", tenantId: "t_alnoor", at: monthStart, kind: "rollover", credits: 300, note: "Rollover from previous month" },
    { id: "l3", tenantId: "t_alnoor", at: iso(nowMs - 60 * DAY), kind: "topup", credits: 200, note: "Top-up" },
    { id: "l4", tenantId: "t_smile", at: iso(nowMs - 12 * DAY), kind: "topup", credits: 100, note: "Prepaid credits" },
    ...conversations
      .filter((c) => new Date(c.startedAt).getTime() >= nowMs - 20 * DAY)
      .map((c, i): LedgerEntry => ({ id: `lu${i}`, tenantId: c.tenantId, at: c.startedAt, kind: "usage", credits: -c.creditsCharged, channel: c.channel, conversationId: c.id })),
  ];

  const knowledge: KnowledgeItem[] = [
    { id: "k1", tenantId: "t_alnoor", language: "en", question: "What are your opening hours?", answer: "Saturday to Thursday 8 am to 9 pm. Friday 4 pm to 9 pm." },
    { id: "k2", tenantId: "t_alnoor", language: "en", question: "Which insurance do you accept?", answer: "We accept Bupa, GIG Gulf, Solidarity and Allianz. Bring your card and Bahraini CPR." },
    { id: "k3", tenantId: "t_alnoor", language: "ar", question: "وين موقعكم؟", answer: "نحن في المنامة، شارع الحكومة، مقابل مجمع السيف." },
    { id: "k4", tenantId: "t_smile", language: "en", question: "Do you offer teeth whitening?", answer: "Yes. Book a consultation first so the dentist can check suitability." },
  ];
  const unanswered: UnansweredQuestion[] = [
    { id: "u1", tenantId: "t_alnoor", text: "Do you do laser hair removal?", count: 5 },
    { id: "u2", tenantId: "t_alnoor", text: "هل يوجد موقف سيارات؟", count: 3 },
    { id: "u3", tenantId: "t_smile", text: "How much are braces?", count: 4 },
  ];

  const alerts: Alert[] = [
    { id: "a1", tenantId: "t_smile", at: iso(nowMs - 2 * 3_600_000), severity: "warning", message: "Low credit balance: 9.5 credits left (9.5% of last top-up).", resolved: false },
    { id: "a2", tenantId: "t_physio", at: iso(nowMs - 5 * 3_600_000), severity: "error", message: "WhatsApp channel returned authentication errors from Meta. Re-link the number.", resolved: false },
    { id: "a3", tenantId: "t_alnoor", at: iso(nowMs - 26 * 3_600_000), severity: "info", message: "Instagram messaging is waiting for Meta app review.", resolved: false },
  ];

  const settings = agents.t_alnoor;
  return {
    tenants, agents, doctors, bookings, conversations, knowledge, unanswered, batches, ledger, alerts,
    agentVersions: [{ id: "v1", tenantId: "t_alnoor", createdAt: iso(nowMs - 30 * DAY), author: "AqeelLLM", summary: "Initial clinic template", settings: structuredClone(settings) }],
    audit: [{ id: "au1", tenantId: "t_alnoor", at: iso(nowMs - 30 * DAY), actor: "AqeelLLM", action: "Created client from clinic template" }],
    topUpRequests: [],
    staffRequests: [
      { id: "sr1", tenantId: "t_alnoor", kind: "handoff", name: "Hessa Al Mannai", phone: "+97336001122", text: "Wants to speak to the doctor about test results.", urgent: true, language: "ar", status: "open", createdAt: iso(nowMs - 3 * 3_600_000) },
      { id: "sr2", tenantId: "t_alnoor", kind: "message", name: "Omar Yusuf", phone: "+97339887766", text: "Please call back about the invoice for last week's visit.", urgent: false, language: "en", status: "open", createdAt: iso(nowMs - 26 * 3_600_000) },
    ],
    packages: DEFAULT_CATALOGUE.map((p, i) => ({ ...p, id: `pkg_${i + 1}`, archived: false })),
    seq: 1000,
  };
}
