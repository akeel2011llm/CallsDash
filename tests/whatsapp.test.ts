import { describe, expect, it } from "vitest";
import {
  TEMPLATES, addressLine, cleanValue, clinicPhone, confirmationOptions, confirmationValues, confirmationsActive, failureHint, mainLanguage, messageOf,
  pickLanguage, planConfirmation, renderTemplate, sendBookingConfirmation, slotDate, slotTime, templateLanguages, templateParams, testFailToShow,
  whatsappUserId, wordingOf,
} from "@/lib/whatsapp";
import type { ElevenLabsApi } from "@/lib/elevenlabs-api";
import { DEFAULT_RULES } from "@/lib/flags";
import { agent } from "@/lib/seed";
import { DEFAULT_OPENING_HOURS } from "@/lib/availability";
import { VARIABLE_NAMES } from "@/lib/agent-context";
import type { Tenant, WhatsappSettings } from "@/lib/types";

describe("whatsappUserId", () => {
  it("keeps digits with the country code", () => {
    expect(whatsappUserId("+973 3600 1122")).toBe("97336001122");
    expect(whatsappUserId("0097336001122")).toBe("97336001122");
    expect(whatsappUserId("36001122")).toBe("97336001122");
    expect(whatsappUserId("+44 7700 900123")).toBe("447700900123");
  });
  it("reads a number typed with Arabic digits", () => {
    expect(whatsappUserId("٣٦٠٠ ١١٢٢")).toBe("97336001122");
    expect(whatsappUserId("+٩٧٣ ۳۶۰۰ ۱۱۲۲")).toBe("97336001122");
  });
  it("rejects things that are not phone numbers", () => {
    for (const p of ["", "abc", "123", "+1234567890123456789"]) expect(whatsappUserId(p), p).toBe("");
  });
});

const FULL: WhatsappSettings = {
  phoneNumberId: "524", confirmTemplate: "appointment_confirmation", confirmTemplateLang: "en", confirmWording: "full", templateLangs: ["en", "ar"],
  address: "Building 12, Road 3, Manama", addressAr: "مبنى 12، طريق 3، المنامة", mapUrl: "https://maps.google.com/?q=26.22,50.58", phone: "+973 1700 0000",
};
const tenant = (w: WhatsappSettings | undefined = FULL, o: Partial<Tenant> = {}): Tenant => ({
  id: "t", slug: "s", name: "Al Noor Medical Center", status: "live",
  branding: { displayName: "Al Noor", displayNameAr: "النور", primaryColor: "#000000" },
  plans: [], alertRules: structuredClone(DEFAULT_RULES), permissions: { editPrompt: true, editVoice: true, editBehaviour: true, editKnowledge: true },
  allowedDomains: [], zeroBalancePolicy: "pause", lowBalanceThreshold: 0.15, retentionDays: 90, calendarConnected: false, openingHours: DEFAULT_OPENING_HOURS,
  channels: { website: "connected", whatsapp: "connected", instagram: "off", phone: "off" }, onboarding: { done: [] },
  integrations: w ? { whatsapp: w } : {}, createdAt: "2026-01-01T00:00:00Z", ...o,
});
// Wednesday 21 October 2026, 10:30 in Bahrain
const booking = { patientName: "Sara", patientPhone: "+973 3600 1122", doctorName: "Dr. Ali", startsAt: "2026-10-21T07:30:00.000Z", service: "Dental check", reference: "3F2A9C1E" };
const NOW = new Date("2026-10-21T05:00:00Z");

describe("the wording to create at Meta", () => {
  const VAR = /\{\{(\w+)\}\}/g;
  for (const wording of ["full", "short"] as const) {
    for (const lang of ["en", "ar"] as const) {
      const spec = TEMPLATES[wording], text = spec.text[lang];
      it(`${wording} (${lang}) uses exactly its variables, each once, with fixed words around them`, () => {
        const used = [...text.matchAll(VAR)].map((m) => m[1]);
        expect(new Set(used)).toEqual(new Set(spec.variables));
        expect(used.length).toBe(spec.variables.length);
        // Meta refuses a template that starts or ends with a variable, or whose variables touch each other
        expect(text.trimStart().startsWith("{{")).toBe(false);
        expect(text.trimEnd().endsWith("}}")).toBe(false);
        expect(text).not.toMatch(/\}\}\s*\{\{/);
        expect(text.length).toBeLessThanOrEqual(1024);
      });
      it(`${wording} (${lang}) has an example for every variable and renders without leftovers`, () => {
        expect(Object.keys(spec.samples[lang]).sort()).toEqual([...spec.variables].sort());
        for (const v of Object.values(spec.samples[lang])) expect(v.trim()).not.toBe("");
        expect(renderTemplate(wording, lang, spec.samples[lang])).not.toContain("{{");
      });
    }
    it(`${wording} uses the same variables in both languages`, () => {
      const names = (l: "en" | "ar") => [...TEMPLATES[wording].text[l].matchAll(VAR)].map((m) => m[1]);
      expect(names("ar")).toEqual(names("en"));
    });
  }
  it("names are what Meta allows: lowercase letters and underscores", () => {
    for (const w of ["full", "short"] as const) for (const v of TEMPLATES[w].variables) expect(v).toMatch(/^[a-z_]+$/);
    expect(TEMPLATES.full.name).toMatch(/^[a-z0-9_]+$/);
    expect(TEMPLATES.full.name).not.toBe(TEMPLATES.short.name);
  });
  it("carries every booking detail in the full version, and no CPR number", () => {
    expect(TEMPLATES.full.variables).toEqual(["name", "clinic", "doctor", "service", "date", "time", "address", "phone", "reference"]);
    expect(TEMPLATES.full.variables).not.toContain("cpr");
    expect(JSON.stringify(TEMPLATES.full)).not.toMatch(/cpr/i);
  });
});

describe("which wording and language", () => {
  it("keeps the short wording for a clinic that had a template before, and gives new clinics the full one", () => {
    expect(wordingOf(undefined)).toBe("full");
    expect(wordingOf({})).toBe("full");
    expect(wordingOf({ confirmTemplate: "booking_confirmation" })).toBe("short");
    expect(wordingOf({ confirmTemplate: "booking_confirmation", confirmWording: "full" })).toBe("full");
    expect(wordingOf({ confirmWording: "short" })).toBe("short");
  });
  it("always has the main language, plus the ticked ones for the full wording", () => {
    expect(templateLanguages(undefined)).toEqual(["en"]);
    expect(templateLanguages({ confirmTemplateLang: "ar" })).toEqual(["ar"]);
    expect(templateLanguages({ confirmWording: "full", confirmTemplateLang: "en", templateLangs: ["ar"] })).toEqual(["en", "ar"]);
    expect(templateLanguages({ confirmWording: "full", confirmTemplateLang: "ar", templateLangs: ["en"] })).toEqual(["en", "ar"]);
    // the short template exists in one language only
    expect(templateLanguages({ confirmWording: "short", confirmTemplateLang: "en", templateLangs: ["en", "ar"] })).toEqual(["en"]);
    expect(mainLanguage({ confirmTemplateLang: "fr" })).toBe("en");
  });
  it("uses the patient's language when the clinic has a template in it, otherwise the main one", () => {
    expect(pickLanguage(FULL, "ar")).toBe("ar");
    expect(pickLanguage(FULL, undefined)).toBe("en");
    expect(pickLanguage({ ...FULL, templateLangs: ["en"] }, "ar")).toBe("en");
    expect(pickLanguage({ ...FULL, confirmTemplateLang: "ar", templateLangs: ["ar"] }, "en")).toBe("ar");
  });
});

describe("values for the template", () => {
  it("makes every value one tidy line, never empty", () => {
    expect(cleanValue("  Dr.\n  Hana\t Ali  ")).toBe("Dr. Hana Ali");
    expect(cleanValue("")).toBe("-");
    expect(cleanValue(undefined)).toBe("-");
    expect(cleanValue(" \n ")).toBe("-");
    expect(cleanValue("x".repeat(500), 40)).toHaveLength(40);
    expect(cleanValue("4:00 PM")).toBe("4:00 PM"); // the narrow no-break space newer Node versions print before PM
  });
  it("writes the date and time the way patients read them", () => {
    expect(slotDate(booking.startsAt, "en")).toMatch(/Wednesday,? 21 October 2026/);
    expect(cleanValue(slotTime(booking.startsAt, "en"))).toBe("10:30 AM");
    expect(slotDate(booking.startsAt, "ar")).toContain("2026");
    expect(slotDate(booking.startsAt, "ar")).toContain("21");
    expect(cleanValue(slotTime("2026-10-24T13:00:00.000Z", "en"))).toBe("4:00 PM");
    expect(cleanValue(slotTime("2026-10-24T13:00:00.000Z", "ar"))).toMatch(/^4:00 \S+$/); // Latin digits, then the Arabic PM mark
  });
  it("fills all nine details of the full wording", () => {
    const v = confirmationValues("full", tenant(), FULL, "en", booking);
    expect(v).toMatchObject({ name: "Sara", clinic: "Al Noor", doctor: "Dr. Ali", service: "Dental check", time: "10:30 AM", phone: "+973 1700 0000", reference: "3F2A9C1E" });
    expect(v.date).toMatch(/21 October 2026/);
    expect(v.address).toBe("Building 12, Road 3, Manama - https://maps.google.com/?q=26.22,50.58");
    expect(Object.keys(v).sort()).toEqual([...TEMPLATES.full.variables].sort());
  });
  it("uses the Arabic clinic name and address for an Arabic message, and the Arabic word for the default service", () => {
    const v = confirmationValues("full", tenant(), FULL, "ar", { ...booking, service: "Consultation" });
    expect(v.clinic).toBe("النور");
    expect(v.service).toBe("استشارة");
    expect(v.address.startsWith("مبنى 12")).toBe(true);
    expect(confirmationValues("full", tenant(), FULL, "en", { ...booking, service: undefined }).service).toBe("Consultation");
  });
  it("falls back to the other language's address, then to a dash", () => {
    expect(addressLine({ address: "Road 3" }, "ar")).toBe("Road 3");
    expect(addressLine({ addressAr: "طريق 3" }, "en")).toBe("طريق 3");
    expect(addressLine({ mapUrl: "https://maps.example/x" }, "en")).toBe("https://maps.example/x");
    expect(confirmationValues("full", tenant({}), {}, "en", booking).address).toBe("-");
  });
  it("shows the clinic phone, else the support phone, else the WhatsApp number", () => {
    const t = tenant(FULL, { branding: { displayName: "Al Noor", displayNameAr: "النور", primaryColor: "#000000", supportPhone: "+973 1111 2222" } });
    expect(clinicPhone(t, FULL)).toBe("+973 1700 0000");
    expect(clinicPhone(t, { ...FULL, phone: undefined })).toBe("+973 1111 2222");
    expect(clinicPhone(tenant(), { displayNumber: "+973 3333 4444" })).toBe("+973 3333 4444");
    expect(confirmationValues("full", tenant({}), {}, "en", booking).phone).toBe("-");
  });
  it("never lets a value break the template: lines, tabs and long runs of spaces are squeezed, and a missing doctor is a dash", () => {
    const v = confirmationValues("full", tenant(), FULL, "en", { ...booking, patientName: "Sara\n\nAhmed", service: "Check\t\tup      now", doctorName: "" });
    expect(v.name).toBe("Sara Ahmed");
    expect(v.service).toBe("Check up now");
    expect(v.doctor).toBe("-");
    for (const value of Object.values(v)) expect(value).not.toMatch(/[\n\t]|\s{2,}/);
  });
  it("keeps the earlier four values for the short wording", () => {
    const v = confirmationValues("short", tenant({ confirmTemplate: "booking_confirmation" }), { confirmTemplate: "booking_confirmation" }, "en", booking);
    expect(Object.keys(v)).toEqual(["name", "clinic", "doctor", "time"]);
    expect(v.time).toContain("21 October");
  });
  it("builds the parameters in the template's order, with their names", () => {
    const params = templateParams("full", confirmationValues("full", tenant(), FULL, "en", booking));
    expect(params).toHaveLength(1);
    expect(params[0].type).toBe("body");
    expect(params[0].parameters.map((p) => p.parameter_name)).toEqual([...TEMPLATES.full.variables]);
    expect(params[0].parameters.every((p) => p.type === "text" && p.text.length > 0)).toBe(true);
  });
});

const run = (t: Tenant, agentId = "agent_1", api?: Partial<ElevenLabsApi>, b: Partial<typeof booking> & { language?: "en" | "ar" } = {}) => {
  const sent: unknown[] = [];
  const full = { sendWhatsappTemplate: async (i: unknown) => { sent.push(i); return { conversation_id: "c1" }; }, ...api } as ElevenLabsApi;
  return { sent, result: sendBookingConfirmation({ api: full, now: () => NOW, data: { getTenant: async () => t, getAgent: async () => agent(agentId, "x") } }, "t", { ...booking, ...b }) };
};
type Sent = { params: ReturnType<typeof templateParams>; dynamicVariables: Record<string, string> };

describe("booking confirmation", () => {
  it("sends the full template with every booking detail", async () => {
    const { sent, result } = run(tenant());
    expect(await result).toEqual({ status: "sent", conversationId: "c1", lang: "en" });
    expect(sent[0]).toMatchObject({ phoneNumberId: "524", userId: "97336001122", templateName: "appointment_confirmation", languageCode: "en", agentId: "agent_1" });
    const params = (sent[0] as Sent).params[0].parameters;
    expect(params.map((p) => p.parameter_name)).toEqual(["name", "clinic", "doctor", "service", "date", "time", "address", "phone", "reference"]);
    const by = Object.fromEntries(params.map((p) => [p.parameter_name, p.text]));
    expect(by).toMatchObject({ name: "Sara", doctor: "Dr. Ali", service: "Dental check", time: "10:30 AM", reference: "3F2A9C1E", phone: "+973 1700 0000" });
    expect(by.date).toContain("21 October 2026");
    expect(by.address).toContain("Building 12");
    expect(by.address).toContain("https://maps.google.com");
  });
  it("never sends the CPR number, whatever the booking holds", async () => {
    const { sent, result } = run(tenant(), "agent_1", undefined, { ...booking, patientCpr: "850123456" } as never);
    await result;
    expect(JSON.stringify(sent)).not.toContain("850123456");
  });
  it("gives the reply conversation everything the assistant reads, so it can answer the patient", async () => {
    const { sent, result } = run(tenant());
    await result;
    const vars = (sent[0] as Sent).dynamicVariables;
    for (const name of VARIABLE_NAMES) expect(vars, name).toHaveProperty(name);
    expect(vars).toMatchObject({ channel: "whatsapp", caller_phone: "+97336001122", open_now: "yes" });
    expect(vars.today).toContain("21 October 2026");
  });
  it("uses the patient's language when the template exists in it", async () => {
    const { sent, result } = run(tenant(), "agent_1", undefined, { language: "ar" });
    expect(await result).toMatchObject({ status: "sent", lang: "ar" });
    expect(sent[0]).toMatchObject({ languageCode: "ar" });
    const by = Object.fromEntries((sent[0] as Sent).params[0].parameters.map((p) => [p.parameter_name, p.text]));
    expect(by.clinic).toBe("النور");
    expect(by.address.startsWith("مبنى 12")).toBe(true);
  });
  it("uses the main language when the patient's has no template", async () => {
    const { sent, result } = run(tenant({ ...FULL, templateLangs: ["en"] }), "agent_1", undefined, { language: "ar" });
    expect(await result).toMatchObject({ status: "sent", lang: "en" });
    expect(sent[0]).toMatchObject({ languageCode: "en" });
  });
  it("still sends the earlier four details to a clinic whose template was made from the short wording", async () => {
    const t = tenant({ phoneNumberId: "524", confirmTemplate: "booking_confirmation", confirmTemplateLang: "ar" });
    const { sent, result } = run(t, "agent_1", undefined, { language: "en" });
    expect(await result).toMatchObject({ status: "sent", lang: "ar" });
    expect(sent[0]).toMatchObject({ templateName: "booking_confirmation", languageCode: "ar" });
    const params = (sent[0] as Sent).params[0].parameters;
    expect(params.map((p) => p.parameter_name)).toEqual(["name", "clinic", "doctor", "time"]);
    expect(params.find((p) => p.parameter_name === "clinic")!.text).toBe("النور");
  });
  it("skips quietly when the channel is off, switched off, unset, the phone is bad or there is no agent", async () => {
    expect(await run(tenant(FULL, { channels: { website: "connected", whatsapp: "pending", instagram: "off", phone: "off" } })).result).toEqual({ status: "skipped", reason: "channel_off" });
    expect(await run(tenant({ ...FULL, confirmations: false })).result).toEqual({ status: "skipped", reason: "confirmations_off" });
    expect(await run(tenant(FULL, { integrations: {} })).result).toEqual({ status: "skipped", reason: "not_configured" });
    expect(await run(tenant({ ...FULL, confirmTemplate: undefined })).result).toEqual({ status: "skipped", reason: "not_configured" });
    expect(await run(tenant(), "").result).toEqual({ status: "skipped", reason: "no_agent" });
    expect(await run(tenant(), "agent_1", undefined, { patientPhone: "n/a" }).result).toEqual({ status: "skipped", reason: "bad_phone" });
  });
  it("never throws when WhatsApp refuses, and says why in plain words", async () => {
    const r = await run(tenant(), "agent_1", { sendWhatsappTemplate: async () => { throw new Error("template not approved"); } }).result;
    expect(r).toEqual({ status: "failed", error: "template not approved", lang: "en" });
    const json = await run(tenant(), "agent_1", { sendWhatsappTemplate: async () => { throw new Error('ElevenLabs 422: {"detail":[{"loc":["body","template_name"],"msg":"Template does not exist"}]}'); } }).result;
    expect(json).toMatchObject({ status: "failed", error: "Template does not exist (template_name)" });
  });
  it("can be planned without sending anything", async () => {
    const data = { getTenant: async () => tenant(), getAgent: async () => agent("agent_1", "x") };
    expect(await planConfirmation({ data }, "t", "+973 3600 1122", "ar")).toMatchObject({ send: true, lang: "ar", userId: "97336001122", wording: "full" });
    expect(await planConfirmation({ data }, "t", "oops")).toEqual({ send: false, reason: "bad_phone" });
  });
});

describe("what is recorded on the booking", () => {
  const at = "2026-10-21T05:00:00.000Z";
  it("records a sent message with its conversation and language", () => {
    expect(messageOf({ status: "sent", conversationId: "c1", lang: "ar" }, at)).toEqual({ status: "sent", at, lang: "ar", conversationId: "c1" });
    expect(messageOf({ status: "sent", lang: "en" }, at)).toEqual({ status: "sent", at, lang: "en" });
  });
  it("records a failure with its reason", () => {
    expect(messageOf({ status: "failed", error: "nope", lang: "en" }, at)).toEqual({ status: "failed", at, detail: "nope", lang: "en" });
  });
  it("records why a message was not sent when someone can fix it, and nothing when WhatsApp is simply not used", () => {
    for (const reason of ["bad_phone", "not_configured", "no_agent"] as const) expect(messageOf({ status: "skipped", reason }, at)).toEqual({ status: "skipped", at, detail: reason });
    expect(messageOf({ status: "skipped", reason: "channel_off" }, at)).toBeNull();
    expect(messageOf({ status: "skipped", reason: "confirmations_off" }, at)).toBeNull();
  });
});

describe("reading a failure", () => {
  it("recognises what Meta's codes mean", () => {
    expect(failureHint("(#132001) Template name does not exist in the translation")).toBe("template");
    expect(failureHint("Template does not exist (template_name)")).toBe("template");
    expect(failureHint("template is not approved")).toBe("template");
    expect(failureHint("132000: parameter count does not match")).toBe("params");
    expect(failureHint("Error 131042: payment issue")).toBe("payment");
    expect(failureHint("131037 display name")).toBe("name");
    expect(failureHint("Access token expired")).toBe("token");
    expect(failureHint("something else entirely")).toBeNull();
    expect(failureHint(undefined)).toBeNull();
  });
});

describe("what the screens offer", () => {
  it("is active only when connected, set up and not switched off", () => {
    expect(confirmationsActive(tenant())).toBe(true);
    expect(confirmationsActive(tenant({ ...FULL, confirmations: false }))).toBe(false);
    expect(confirmationsActive(tenant({ ...FULL, phoneNumberId: undefined }))).toBe(false);
    expect(confirmationsActive(tenant(FULL, { channels: { website: "connected", whatsapp: "pending", instagram: "off", phone: "off" } }))).toBe(false);
    expect(confirmationOptions(tenant())).toEqual({ active: true, languages: ["en", "ar"], main: "en" });
  });
  it("shows a failed test only for a few minutes", () => {
    const at = "2026-10-21T05:00:00.000Z";
    const now = Date.parse(at);
    expect(testFailToShow({ detail: "refused", at }, now + 60_000)).toBe("refused");
    expect(testFailToShow({ detail: "refused", at }, now + 11 * 60_000)).toBeNull();
    expect(testFailToShow({ detail: "", at }, now)).toBeNull();
    expect(testFailToShow(null, now)).toBeNull();
    expect(testFailToShow({ detail: "x", at: "garbage" }, now)).toBeNull();
  });
});
