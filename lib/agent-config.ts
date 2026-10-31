import { variablePlaceholders } from "./agent-context";
import { acceptsTemperature, defaultLlm } from "./agent-catalog";
import { STUDIO_DEFAULTS, studioOf } from "./agent-studio";
import { resolveVoiceId } from "./voices";
import { relabel, roleName, roleOf, rolesOf, vocabOf } from "./business-types";
import { ID_CPR, asksId, idRuleOf, idify, type IdRule } from "./id-rule";
import type { AgentSettings, Doctor, KnowledgeItem, Tenant } from "./types";

const REPLY_LENGTH = {
  short: "Keep every reply to one or two short sentences.",
  normal: "Keep replies brief: usually two or three sentences.",
  detailed: "Give complete answers, but stay clear and well organised.",
} as const;
const FORMALITY = {
  casual: "Be friendly and relaxed.",
  polite: "Be polite and warm.",
  formal: "Be formal and respectful.",
} as const;
const ARABIC_STYLE = {
  gulf: "When you speak or write Arabic, use natural Gulf (Bahraini) dialect.",
  msa: "When you speak or write Arabic, use clear Modern Standard Arabic.",
} as const;

/**
 * Raise when the prompt rules or the tools change in a way a clinic's agent must pick up. The client screens ask for a
 * Sync while the agent's last sync was at an older version. 2: CPR numbers for booking, finding, moving and cancelling.
 * 3: the widget hides its "Powered by" line, and a booking can carry the patient's language for the WhatsApp confirmation.
 * 4: lookup_customer and save_customer, so the assistant knows returning customers and keeps their details.
 * 5: the clinic chooses whether customers are found by phone number or CPR number; find_item looks up the catalogue and show_image
 *    shows a photo in website chat.
 * 6: send_item_photo sends a catalogue photo in a WhatsApp chat; Instagram and other chats get a link with a picture preview.
 * 7: find_item also finds doctors (with their photo, when one was added) and lists what the clinic offers when asked with no name.
 * 8: show_image answers the assistant (so a chat that cannot draw it gets the link instead), and a doctor with a photo is shown
 *    the first time they are named in a website chat.
 * 9: in a typed website chat the photo goes inside the reply as a markdown image (ElevenLabs' widget draws it in the chat);
 *    show_image stays for spoken website conversations.
 * 11: find_record searches the business's custom tables (stock, menu, price list) that the admin marked for the assistant.
 * 12: the built-in instructions use the client's own words and roles (a salon's stylists, a clinic's doctors and nurses), and the
 *     shared tools describe team members and customers instead of doctors and patients.
 * 13: each client chooses the ID number customers give (the CPR number, another ID, or none: the phone number finds a booking),
 *     and the shared tools describe patient_cpr as that ID.
 */
export const AGENT_VERSION = 13;

/**
 * How the assistant finds and saves returning customers, which depends on what the clinic chose on its Customers screen, and on
 * the ID number it asks for (lib/id-rule.ts): written for the CPR number and reworded for another ID; with none, by phone only.
 */
export function customerRules(mode: "phone" | "cpr", rule: IdRule = ID_CPR): string[] {
  const keep = "Put only preferences and practical notes in note, never medical details. Never tell a customer what another customer's record holds.";
  if (!asksId(rule)) return [
    "When the caller's phone number is known (a phone call or WhatsApp chat), call lookup_customer with it as patient_phone before you greet them. On the website, call it once the customer has given their number. If the customer is found, greet them by their first name. Share nothing else about them: this business asks for no ID number, so nobody can be checked.",
    `Once you know a customer's name, or learn something worth remembering (their language, email, a preference), call save_customer with their phone number as patient_phone, their patient_name, the language and the conversation_id. ${keep}`,
  ];
  return (mode === "cpr" ? [
    "This clinic knows its customers by CPR number. When someone starts to need their own details (a booking, a change, or a returning customer), ask for their CPR number (9 digits), read it back digit by digit, and call lookup_customer with it as patient_cpr. If it returns found:true, greet them by name and use the details it returns. If not, carry on and learn their name.",
    `Once you know a customer's name and CPR number, or learn something worth remembering (their language, email, a preference), call save_customer with patient_cpr, patient_name, their phone number as patient_phone if you know it, the language and the conversation_id. ${keep}`,
  ] : [
    "When the caller's phone number is known (a phone call or WhatsApp chat), call lookup_customer with it as patient_phone before you greet them. On the website, call it once the customer has given their number. If the customer is found, greet them by their first name. Share nothing else about them unless lookup_customer returns verified:true; it only does so when you also pass their CPR number as patient_cpr, which you ask for only when they need their own notes or earlier conversations.",
    `Once you know a customer's name, or learn something worth remembering (their language, email, a preference), call save_customer with their phone number as patient_phone, their patient_name, the language and the conversation_id. ${keep}`,
  ]).map((r) => idify(r, rule));
}

/** The booking rules for the client's ID number: as written for the CPR number, reworded for another ID, or by phone number with none. */
export function bookingRules(rule: IdRule = ID_CPR): string[] {
  if (asksId(rule)) return BOOKING_RULES.map((r) => idify(r, rule));
  return [
    BOOKING_RULES[0],
    "To book, ask for the patient's full name and phone number, then confirm doctor, time, name and phone with the patient before calling book_appointment. This business asks for no ID number: pass patient_cpr as an empty string.",
    BOOKING_RULES[2], BOOKING_RULES[3],
    "When someone asks about their booking, or wants to move or cancel it, first ask for the phone number the booking was made with and call find_patient_booking with it as patient_phone (patient_cpr empty). Only talk about the bookings it returns. Use their booking_id and the same patient_phone for cancel_appointment or reschedule_appointment, and confirm the change with the patient before calling the tool.",
    BOOKING_RULES[5],
    "Never read out a phone number except to confirm the one the patient just gave.",
  ];
}

const BOOKING_RULES = [
  "Always call check_availability before offering times. Never invent slots. Leave from_date empty to start from today.",
  "To book, ask for the patient's full name, phone number and CPR number (the 9-digit personal number on the Bahraini ID card). Read the CPR number back digit by digit, then confirm doctor, time, name, phone and CPR with the patient before calling book_appointment.",
  "Call book_appointment with the doctor_id and starts_at exactly as check_availability returned them; never rewrite the time yourself. Always pass language (en or ar): the language the patient is speaking or writing, because their WhatsApp confirmation is sent in it.",
  "Only say an appointment is booked after book_appointment returns ok:true, then read back its label. If it returns whatsappConfirmation:true, add that a confirmation with all the details is being sent to the phone number they gave, on WhatsApp. If it is false or missing, do not mention WhatsApp.",
  "When someone asks about their booking, or wants to move or cancel it, first ask for their CPR number and call find_patient_booking with it. Only talk about the bookings it returns. Use their booking_id and the same CPR number for cancel_appointment or reschedule_appointment, and confirm the change with the patient before calling the tool.",
  "To move a booking, call check_availability first with the doctor_id that find_patient_booking returned for the booking (or another doctor's doctor_id if the patient wants a different doctor), then call reschedule_appointment with the chosen starts_at as new_starts_at, and doctor_id only when the doctor changes. Pass language, and mention the WhatsApp confirmation the same way as for a new booking.",
  "If find_patient_booking finds nothing but the patient says they have a booking, ask for the phone number it was made with and call find_patient_booking again with both patient_cpr and patient_phone; give the same patient_phone to cancel_appointment or reschedule_appointment for that booking.",
  "Never say a CPR number aloud except to read back the one the patient just gave. If the patient has no CPR number (for example a visitor), use take_message so the team can book for them.",
];

/** Catalogue rules: what to look up, what to say, and when a photo may be shown (only the website chat can draw one). */
const CATALOGUE_RULES = [
  "When a customer asks about a product, treatment or package the clinic offers, call find_item with what they asked, then answer only from the details it returns. If it finds nothing, do not guess; say it is not listed and offer to take a message.",
  "When a customer asks what the clinic offers, or asks for photos or pictures without naming one thing (for example any product photos), call find_item with an empty query to get a short list, then describe those items and show their photos the way the rules below say. Never say you have no photos before you have called find_item.",
  "When a customer asks for a photo or picture of a doctor, call find_item with the doctor's name. An entry whose kind is `doctor` and that has an image_url is shown like any other photo. If it has no image_url, say there is no photo of that doctor on file and offer to help with an appointment.",
  "If find_item returns an image_url and the customer is on the website (Channel: website) and typing (Typed chat: true), show the photo inside your reply: after describing the item, put it on a line of its own exactly as ![short caption](image_url), using the image_url exactly as find_item returned it. The chat draws it as a picture inside the conversation. Do not also call show_image, and do not add the page_url link.",
  "If find_item returns an image_url and the customer is on the website but talking (Typed chat: false), never write a markdown image; call show_image with that image_url and a short caption after you describe the item. Only the website chat can use show_image. It answers Shown. when the picture is on the customer's screen. If it answers that the photo is not shown on this screen, put it inside your reply as a markdown image on its own line instead. If it answers anything else, or fails, the chat cannot draw pictures: put the page_url link from find_item in your reply instead, and do not say a photo is shown. Never write a markdown image on any channel other than the website.",
  "In the website chat, the first time in a conversation that a doctor marked [has a photo] in the Doctors list is named (by the customer or by you, for example when offering times), call find_item with the doctor's name and show the doctor's photo the way the two rules above say (inside your reply when typing, show_image when talking), with the doctor's name as caption, once per doctor per conversation and never again for the same doctor.",
  "When a customer asks about stock or availability, a menu, prices, or anything else that may be in the business's own lists, or when find_item finds nothing, call find_record with what they asked (and the list's name in table, if you know it). Answer only from the records it returns; a record showing 0 in stock is not available now. If it finds nothing, do not guess; say it is not listed and offer to take a message. Call find_record with an empty query to see which lists exist.",
  "If find_item returns an image_url and the customer is on WhatsApp (Channel: whatsapp), describe the item, then call send_item_photo with its item_id. If it returns sent:true, say the photo is being sent; do not add a link. If it returns sent:false, put the link it gives in your reply instead.",
  "On Instagram, if find_item returns a page_url, put it in your reply after describing the item (the app shows a picture preview for it). On a phone call, describe the item in words and never read out a link.",
];

const CLOSING_RULES = [
  "If a tool returns ok:false, follow its message. Never promise a booking that a tool did not confirm.",
  "Use take_message when the patient wants staff to call back. Use handoff_to_staff when a person must take over; there is no live transfer, so say that staff will call back.",
  "For a medical emergency tell the caller to call 999 immediately and also call handoff_to_staff with urgent set to true.",
];

type DoctorLine = Pick<Doctor, "id" | "name" | "specialty" | "active"> & Partial<Pick<Doctor, "photoAt" | "role">>;

/**
 * The people who take bookings, with the id the tools expect, so the agent can name them and pass the right id. With more than one
 * role (Doctor and Nurse) each line says the person's role, so "a nurse" is matched to the right people.
 */
function doctorSection(doctors: DoctorLine[], tenant?: Pick<Tenant, "business"> | null, ours: (s: string) => string = (x) => x) {
  const active = doctors.filter((d) => d.active !== false);
  if (!active.length) return "";
  const roles = rolesOf(tenant);
  const many = roles.length > 1;
  const intro = many
    ? `${ours("Each person has one role:")} ${roles.map((r) => `${roleName(r, "en")} (in Arabic ${roleName(r, "ar")})`).join(", ")}. When a customer asks for a role, offer only people with that role, and check_availability with each of their doctor_id values.\n`
    : "";
  return `${ours("# Doctors")}\n${intro}${active.map((d) => `- ${d.name}${many ? ` [role: ${roleName(roleOf(roles, d.role), "en")}]` : ""}${d.specialty ? `, ${d.specialty}` : ""} (doctor_id: ${d.id})${d.photoAt ? " [has a photo]" : ""}`).join("\n")}`;
}

/**
 * The agent's instructions: the client's own sections, the style settings, live context, the team and the tool rules. The built-in
 * parts are written with clinic words (doctor, patient, clinic); with `tenant` they are rewritten in the client's own words and
 * roles (lib/business-types.ts), so a salon's assistant talks about stylists and customers. The client's own sections stay as written.
 */
export function buildPrompt(settings: AgentSettings, doctors: DoctorLine[] = [], tenant?: Pick<Tenant, "business"> | null): string {
  const p = settings.prompt;
  const id = idRuleOf(tenant);
  // `quoted` words are values the tools return (kind `doctor`) and stay as they are
  const ours = (text: string) => (tenant ? text.split(/(`[^`]*`)/g).map((x) => (x.startsWith("`") ? x : relabel(x, "en", vocabOf(tenant, "en")))).join("") : text);
  return [
    `# Role\n${p.identity}`,
    `# Languages\n${p.languages}\n${ARABIC_STYLE[settings.arabicWrittenStyle]}`,
    `# You may\n${p.mayDo}`,
    `# You must never\n${p.neverDo}`,
    `# Emergencies\n${p.emergencies}`,
    `# Handing over\n${p.handoff}`,
    `# Style\n${REPLY_LENGTH[settings.replyLength]} ${FORMALITY[settings.formality]} Answer only from the knowledge base and the facts below; if you do not know, say so and offer to take a message.`,
    ours(`# Facts for this conversation\nToday is {{today}}. The clinic is open now: {{open_now}}. Opening hours today: {{hours_today}}. If closed, it next opens {{next_opening}}. Channel: {{channel}}. Typed chat: {{system__is_text_only}}. The caller's phone number, if known: {{caller_phone}} (ask them to confirm it before booking).`),
    doctorSection(doctors, tenant, ours),
    ours(`# Tools\n${[...bookingRules(id), ...customerRules(settings.customerLookup === "cpr" ? "cpr" : "phone", id), ...CATALOGUE_RULES, ...CLOSING_RULES].map((r) => `- ${r}`).join("\n")}`),
  ].filter(Boolean).join("\n\n");
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * The first thing the assistant says. An admin may write their own in the Assistant studio; `{name}` stands for the clinic's
 * display name in that language. Left blank, the built-in greeting (with the recording notice) is used.
 */
export function greeting(tenant: Pick<Tenant, "name" | "branding">, lang: "en" | "ar", style: "gulf" | "msa", custom = ""): string {
  if (custom.trim()) return custom.replaceAll("{name}", lang === "en" ? tenant.branding.displayName || tenant.name : tenant.branding.displayNameAr || tenant.name);
  if (lang === "en") return `Hello, you are speaking with the AI assistant of ${tenant.branding.displayName || tenant.name}. This conversation is recorded to help us serve you. How can I help?`;
  const name = tenant.branding.displayNameAr || tenant.name;
  return style === "gulf"
    ? `هلا والله، معك المساعد الذكي لـ ${name}. المحادثة مسجلة لتحسين خدمتك. شلون أقدر أساعدك؟`
    : `مرحباً بك، معك المساعد الذكي لـ ${name}. تُسجَّل هذه المحادثة لتحسين خدمتك. كيف يمكنني مساعدتك؟`;
}

/** A sentence an admin can add to a greeting of their own, per language. */
export const RECORDING_NOTICE = { en: "This conversation is recorded to help us serve you.", ar: "تُسجَّل هذه المحادثة لتحسين خدمتك." } as const;

/** True when a greeting tells the caller the conversation is recorded, in English or in Arabic (vowel marks do not matter). */
export function mentionsRecording(text: string): boolean {
  const plain = text.replace(/[\u064B-\u0652\u0670\u0640]/g, "");
  return /record/i.test(plain) || /سج[يل]/.test(plain);
}

/** The knowledge base as one text document, question and answer pairs, for ElevenLabs to index. */
export function knowledgeText(items: Pick<KnowledgeItem, "question" | "answer">[]): string {
  return items.map((k) => `Q: ${clean(k.question)}\nA: ${clean(k.answer)}`).join("\n\n");
}

export interface AgentConfigInput {
  tenant: Tenant;
  settings: AgentSettings;
  doctors?: DoctorLine[];
  toolIds: string[];
  knowledgeDoc?: { id: string; name: string };
  appUrl: string;
  /** Sent by ElevenLabs to the conversation-start webhook as a bearer token. */
  initSecret?: string;
  llm?: string;
}

/** Hostnames the website widget may run on: the client's websites, plus this app so the admin Test page and the client's preview work. */
export function widgetHostnames(t: Pick<Tenant, "allowedDomains">, appUrl?: string) {
  let own = "";
  try { own = appUrl ? new URL(appUrl).hostname.toLowerCase() : ""; } catch { /* not a URL: leave it out */ }
  return [...new Set([...t.allowedDomains, own].map((d) => d.trim().toLowerCase()).filter(Boolean))];
}

// ElevenLabs requires the English-only v2 model for an agent whose main language is English; Arabic needs the multilingual v2.5 model, set on the Arabic preset.

export const OUTCOME_ITEM = {
  type: "string", enum: ["booked", "answered", "handed_off", "abandoned"],
  description: "How the conversation ended: booked (an appointment was booked or changed), answered (questions answered), handed_off (staff will follow up or a message was taken), abandoned (the person left without a request).",
};

/** The body for creating or updating the client's agent in ElevenLabs. Updating sends the same body, so a sync brings the agent back in line with CallsDash. */
export function buildAgentConfig(i: AgentConfigInput) {
  const { tenant, settings } = i;
  const style = settings.arabicWrittenStyle;
  const studio = studioOf(settings);
  const llm = i.llm ?? (studio.llm || defaultLlm());
  return {
    name: `CallsDash: ${tenant.name}`.slice(0, 120),
    tags: ["callsdash", tenant.slug],
    conversation_config: {
      agent: {
        first_message: greeting(tenant, "en", style, studio.greetingEn),
        language: "en",
        dynamic_variables: { dynamic_variable_placeholders: variablePlaceholders() },
        prompt: {
          prompt: buildPrompt(settings, i.doctors, i.tenant),
          llm,
          temperature: acceptsTemperature(llm) ? settings.temperature : null, // the newest Claude models reject a custom temperature: null leaves it out
          tool_ids: i.toolIds,
          built_in_tools: { language_detection: { name: "language_detection", description: "", params: { system_tool_type: "language_detection" } } },
          knowledge_base: i.knowledgeDoc ? [{ type: "text", name: i.knowledgeDoc.name, id: i.knowledgeDoc.id, usage_mode: "auto" }] : [],
        },
      },
      language_presets: {
        ar: {
          overrides: {
            agent: { first_message: greeting(tenant, "ar", style, studio.greetingAr), language: "ar" },
            tts: { voice_id: resolveVoiceId(settings.voiceAr, "ar"), model_id: studio.ttsModelAr },
          },
        },
      },
      tts: { voice_id: resolveVoiceId(settings.voiceEn, "en"), model_id: studio.ttsModelEn },
      conversation: { max_duration_seconds: studio.maxDurationSeconds },
    },
    platform_settings: {
      auth: { enable_auth: false, allowlist: widgetHostnames(tenant, i.appUrl).map((hostname) => ({ hostname })) },
      overrides: {
        enable_conversation_initiation_client_data_from_webhook: true,
        conversation_config_override: {
          agent: { first_message: true, language: true, prompt: { prompt: true } },
          tts: { voice_id: true },
          conversation: { text_only: true },
        },
      },
      workspace_overrides: {
        conversation_initiation_client_data_webhook: {
          url: `${i.appUrl}/api/webhooks/elevenlabs/init`,
          request_headers: i.initSecret ? { Authorization: `Bearer ${i.initSecret}` } : {},
        },
      },
      // lib/elevenlabs.ts reads this to record how each conversation ended
      data_collection: { outcome: OUTCOME_ITEM },
    },
  };
}

// ElevenLabs accepts only one of description, dynamic_variable, constant_value, is_system_provided or is_omitted per property.
type Prop = { type: "string" | "boolean" | "integer"; description?: string; dynamic_variable?: string };
const str = (description: string): Prop => ({ type: "string", description });
const agentId: Prop = { type: "string", dynamic_variable: "system__agent_id" };
const conversationId: Prop = { type: "string", dynamic_variable: "system__conversation_id" };
const CPR_HELP = "The customer's ID number, the one your instructions name (for example the CPR number), exactly as they gave it. If your instructions say the business asks for no ID number, pass an empty string.";

/** The booking, customer, catalogue and hand-over tools (docs/agent-tools.md), as ElevenLabs webhook tool configs. One shared set serves every client; `agent_id` tells them apart. */
export function toolDefinitions(appUrl: string, secret: string): Record<string, Record<string, unknown>> {
  const tool = (name: string, description: string, properties: Record<string, Prop>, required: string[]) => ({
    type: "webhook", name, description,
    api_schema: {
      url: `${appUrl}/api/agent-tools/${name}`, method: "POST",
      request_headers: { Authorization: `Bearer ${secret}` },
      request_body_schema: { type: "object", required: ["agent_id", ...required], properties: { agent_id: agentId, ...properties } },
    },
  });
  return {
    check_availability: tool("check_availability", "List free appointment slots. Call before offering any time.", {
      doctor_id: str("The doctor_id of a team member from your instructions, if the customer asked for a specific person or role, or to move a booking with the person it is with."), from_date: str("First day to look at, YYYY-MM-DD."),
      days: { type: "integer", description: "How many days to look at, 1 to 30." }, language: str("en or ar, the language the slot labels should be in."),
    }, []),
    book_appointment: tool("book_appointment", "Book an appointment in a slot returned by check_availability.", {
      doctor_id: str("The doctor_id from the slot."), starts_at: str("Slot start (ISO) exactly as returned by check_availability."),
      patient_name: str("The customer's full name."), patient_phone: str("The customer's phone number."), patient_cpr: str(CPR_HELP),
      service: str("What the booking is for."), language: str("en or ar, the language the customer is speaking or writing. Their WhatsApp confirmation is sent in it."), conversation_id: conversationId,
    }, ["doctor_id", "starts_at", "patient_name", "patient_phone", "patient_cpr"]),
    find_patient_booking: tool("find_patient_booking", "Find a customer's upcoming bookings by their ID number, or by phone number when your instructions say so.", {
      patient_cpr: str(CPR_HELP), patient_phone: str("The phone number the booking was made with, when your instructions say to pass it (a booking made before ID numbers were asked, or a business that asks for none)."),
      language: str("en or ar, the language the time labels should be in."),
    }, ["patient_cpr"]),
    cancel_appointment: tool("cancel_appointment", "Cancel a booking found with find_patient_booking.", {
      booking_id: str("booking_id from find_patient_booking."), patient_cpr: str(CPR_HELP), patient_phone: str("Only if find_patient_booking needed the phone number too."),
    }, ["booking_id", "patient_cpr"]),
    reschedule_appointment: tool("reschedule_appointment", "Move a booking found with find_patient_booking to a new slot returned by check_availability, with the same or another team member.", {
      booking_id: str("booking_id from find_patient_booking."), patient_cpr: str(CPR_HELP), new_starts_at: str("New slot start (ISO), the starts_at of the chosen slot."),
      doctor_id: str("Only when the customer wants another team member: the doctor_id of the chosen slot."), patient_phone: str("Only if find_patient_booking needed the phone number too."),
      language: str("en or ar, the language the customer is speaking or writing. Their WhatsApp confirmation is sent in it."),
    }, ["booking_id", "patient_cpr", "new_starts_at"]),
    lookup_customer: tool("lookup_customer", "Look up a returning customer the way your instructions say: by phone number, or by ID number.", {
      patient_phone: str("The customer's phone number. Pass it when the instructions say customers are found by phone number."),
      patient_cpr: str("The customer's ID number (the one your instructions name). Pass it when the instructions say customers are found by it; otherwise only when the customer gave it, to unlock their notes and recent conversations."),
    }, []),
    save_customer: tool("save_customer", "Save or update a customer's details (name, language, email, a short note), so they are known next time.", {
      patient_phone: str("The customer's phone number."), patient_name: str("The customer's name."), patient_cpr: str("Their ID number (the one your instructions name) if they gave it. Never guess it."),
      email: str("Their email address, if they gave one."), note: str("A short practical note to remember (a preference). No medical details."),
      language: str("en or ar, the language the customer speaks or writes."), conversation_id: conversationId,
    }, []),
    find_item: tool("find_item", "Look up something the business offers (a product, service or package) or a team member, with details, price and a photo address. With no query it lists what the business offers.", {
      query: str("What the customer asked about, or a team member's name, in a few words, in their own language. Leave empty to list what the business offers."), language: str("en or ar, the language to answer in."),
    }, []),
    find_record: tool("find_record", "Search the business's own lists (for example stock, a menu or a price list) and get matching records. With an empty query it names the lists and their columns.", {
      query: str("What the customer asked about, in a few words, in their own language. Leave empty to see the lists."),
      table: str("The list's name, if you know which list to search. Leave empty to search them all."), language: str("en or ar, the language to answer in."),
    }, []),
    send_item_photo: tool("send_item_photo", "Send the photo of a catalogue item or a team member to the customer in their WhatsApp chat. Use it only on WhatsApp.", {
      item_id: str("The item_id from find_item (for a team member, their item_id)."), language: str("en or ar, the language of the caption."),
      // filled from the chat's own variable, never chosen by the assistant, so a photo can only go to the person in the chat
      caller_phone: { type: "string", dynamic_variable: "caller_phone" },
    }, ["item_id"]),
    // not a webhook: the customer's browser runs it (public/widget.js draws the photo), so it needs no address or secret
    show_image: {
      type: "client", name: "show_image", expects_response: true,
      description: "Show a photo to the customer in the website chat. Use the image_url that find_item returned, exactly as it is, and a short caption in the customer's language.",
      parameters: {
        type: "object", required: ["image_url"],
        properties: { image_url: str("The image_url from find_item, unchanged."), caption: str("A short caption, such as the item's name, in the customer's language.") },
      },
    },
    take_message: tool("take_message", "Take a message for the staff to answer later.", {
      patient_name: str("Caller's name."), patient_phone: str("Caller's phone number."), message: str("What the caller wants."), language: str("en or ar."), conversation_id: conversationId,
    }, ["patient_name", "patient_phone", "message"]),
    handoff_to_staff: tool("handoff_to_staff", "Ask staff to take over. There is no live transfer: staff call the customer back.", {
      patient_name: str("Caller's name."), patient_phone: str("Caller's phone number."), reason: str("Why a person is needed."),
      urgent: { type: "boolean", description: "True when it cannot wait, for example a medical emergency." }, language: str("en or ar."), conversation_id: conversationId,
    }, ["reason"]),
  };
}
