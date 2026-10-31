import { describe, expect, it } from "vitest";
import { setupChecklist, type ChecklistFacts } from "@/lib/checklist";
import { rulesOf, type BusinessProfile } from "@/lib/business-types";
import { isPhase, missingForLive, PHASES, wizardPhases } from "@/lib/wizard";
import { firstOpenStep } from "@/lib/steps";
import { DEFAULT_RULES } from "@/lib/flags";
import type { Tenant } from "@/lib/types";

const tenant = (o: Partial<Tenant> = {}): Tenant => ({
  id: "t", slug: "t", name: "T", status: "live", branding: { displayName: "T", displayNameAr: "T", primaryColor: "#000000" },
  plans: [], alertRules: structuredClone(DEFAULT_RULES), permissions: { editPrompt: true, editVoice: true, editBehaviour: true, editKnowledge: true },
  allowedDomains: [], zeroBalancePolicy: "pause", lowBalanceThreshold: 0.15, retentionDays: 90, calendarConnected: false, openingHours: {},
  channels: { website: "pending", whatsapp: "off", instagram: "off", phone: "off" }, onboarding: { done: [] }, integrations: {}, createdAt: "2026-01-01T00:00:00Z", ...o,
});
const none: ChecklistFacts = { knowledgeCount: 0, doctorCount: 0, userCount: 0, conversationCount: 0, agentId: "", balance: 0 };
const plan = { id: "p", name: "P", type: "package", active: true, includedCredits: 100, monthlyPriceBhd: 10, periodStart: "2026-01-01T00:00:00Z" } as unknown as Tenant["plans"][number];

/** A client with everything done except what `skip` names. */
function setUp(business: BusinessProfile | undefined, o: { catalog?: number; knowledge?: number; doctors?: number; calendar?: boolean } = {}) {
  const t = tenant({
    business, plans: [plan], calendarConnected: o.calendar ?? true,
    branding: { displayName: "T", displayNameAr: "T", primaryColor: "#000000", domain: "t.bh", supportPhone: "+973 1700 0000" },
    channels: { website: "connected", whatsapp: "off", instagram: "off", phone: "off" },
  });
  const f = { ...none, knowledgeCount: o.knowledge ?? 1, doctorCount: o.doctors ?? 1, userCount: 1, conversationCount: 1, agentId: "agent_1", balance: 50 };
  return wizardPhases(setupChecklist(t, f), rulesOf(t), { knowledgeCount: f.knowledgeCount, catalogCount: o.catalog ?? 0 });
}

describe("setup wizard phases", () => {
  it("has five phases in order, and a new client starts at the first", () => {
    const t = tenant();
    const phases = wizardPhases(setupChecklist(t, none), rulesOf(t), { knowledgeCount: 0, catalogCount: 0 });
    expect(phases.map((p) => p.id)).toEqual([...PHASES]);
    expect(phases.every((p) => !p.done)).toBe(true);
    expect(firstOpenStep(phases.map((p) => ({ id: p.id, done: p.done })))).toBe("business");
  });

  it("puts every checklist item in exactly one phase (nothing is lost)", () => {
    const t = tenant();
    const ids = wizardPhases(setupChecklist(t, none), rulesOf(t), { knowledgeCount: 0, catalogCount: 0 }).flatMap((p) => p.items.map((i) => i.id));
    for (const c of setupChecklist(t, none)) if (c.id !== "knowledge") expect(ids.filter((x) => x === c.id)).toHaveLength(1);
    // the knowledge item becomes the content rule (knowledge or catalogue)
    expect(ids).toContain("content");
  });

  it("an existing client resumes at its first unfinished phase", () => {
    const t = tenant({ branding: { displayName: "T", displayNameAr: "T", primaryColor: "#000000", domain: "t.bh", supportEmail: "a@t.bh" }, plans: [plan] });
    const phases = wizardPhases(setupChecklist(t, { ...none, balance: 5 }), rulesOf(t), { knowledgeCount: 0, catalogCount: 0 });
    expect(firstOpenStep(phases.map((p) => ({ id: p.id, done: p.done })))).toBe("people");
  });

  it("branding and hours are recommended, never blocking", () => {
    const phases = setUp(undefined);
    expect(phases.every((p) => p.done)).toBe(true);
    expect(missingForLive(phases)).toEqual([]);
    const opt = phases.flatMap((p) => p.items).filter((i) => !i.required).map((i) => i.id).sort();
    expect(opt).toEqual(["branding", "hours"]);
  });

  it("a clinic needs a doctor with a calendar", () => {
    expect(missingForLive(setUp(undefined, { doctors: 0 }))).toEqual([{ phase: "people", item: "calendar" }]);
    expect(missingForLive(setUp({ type: "clinic" }, { calendar: false }))).toEqual([{ phase: "people", item: "calendar" }]);
  });

  it("a shop needs no staff but does need a catalogue item", () => {
    const shop = setUp({ type: "retail" }, { doctors: 0, calendar: false, knowledge: 3 });
    const cal = shop.find((p) => p.id === "people")!.items.find((i) => i.id === "calendar")!;
    expect(cal).toMatchObject({ required: false, notNeeded: true });
    expect(missingForLive(shop)).toEqual([{ phase: "assistant", item: "content" }]);
    expect(missingForLive(setUp({ type: "retail" }, { doctors: 0, calendar: false, knowledge: 0, catalog: 2 }))).toEqual([]);
  });

  it("a shop that books staff time needs calendars again", () => {
    expect(missingForLive(setUp({ type: "retail", staffScheduling: true }, { doctors: 0, catalog: 1 }))).toEqual([{ phase: "people", item: "calendar" }]);
  });

  it("a salon needs staff and catalogue; a service business takes knowledge or catalogue", () => {
    expect(missingForLive(setUp({ type: "salon" }, { doctors: 0 })).map((m) => m.item)).toEqual(["calendar", "content"]);
    expect(missingForLive(setUp({ type: "service" }, { knowledge: 0, catalog: 1 }))).toEqual([]);
    expect(missingForLive(setUp({ type: "service" }, { knowledge: 2, catalog: 0 }))).toEqual([]);
    expect(missingForLive(setUp({ type: "service" }, { knowledge: 0, catalog: 0 }))).toEqual([{ phase: "assistant", item: "content" }]);
  });

  it("knows its phase names", () => {
    expect(isPhase("plan")).toBe(true);
    expect(isPhase("doctors")).toBe(false);
    expect(isPhase(undefined)).toBe(false);
  });
});
