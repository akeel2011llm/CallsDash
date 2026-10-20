import { describe, expect, it } from "vitest";
import { progress, setupChecklist } from "@/lib/checklist";
import { DEFAULT_RULES } from "@/lib/flags";
import type { Tenant } from "@/lib/types";

const tenant = (o: Partial<Tenant> = {}): Tenant => ({
  id: "t", slug: "t", name: "T", status: "live", branding: { displayName: "T", displayNameAr: "T", primaryColor: "#000000" },
  plans: [], alertRules: structuredClone(DEFAULT_RULES), permissions: { editPrompt: true, editVoice: true, editBehaviour: true, editKnowledge: true },
  allowedDomains: [], zeroBalancePolicy: "pause", lowBalanceThreshold: 0.15, retentionDays: 90, calendarConnected: false, openingHours: {},
  channels: { website: "pending", whatsapp: "off", instagram: "off", phone: "off" }, onboarding: { done: [] }, integrations: {}, createdAt: "2026-01-01T00:00:00Z", ...o,
});
const facts = { knowledgeCount: 0, doctorCount: 0, userCount: 0, conversationCount: 0, agentId: "", balance: 0 };
const done = (items: ReturnType<typeof setupChecklist>) => items.filter((i) => i.done).map((i) => i.id);

describe("setup checklist", () => {
  it("starts empty for a new client", () => {
    expect(done(setupChecklist(tenant(), facts))).toEqual([]);
  });
  it("turns items green from the data", () => {
    const t = tenant({
      branding: { displayName: "T", displayNameAr: "T", primaryColor: "#000000", domain: "t.bh", supportPhone: "+97311", logoUrl: "data:image/png;base64,AA" },
      plans: [{ id: "p", active: true, type: "package", name: "P", includedCredits: 1, monthlyPriceBhd: 1, pricePerCreditBhd: 1, rolloverCap: 0, periodStart: "2026-01-01" }],
      calendarConnected: true, channels: { website: "connected", whatsapp: "off", instagram: "off", phone: "off" },
    });
    expect(done(setupChecklist(t, { knowledgeCount: 3, doctorCount: 2, userCount: 1, conversationCount: 4, agentId: "agent_1", balance: 10 })).sort())
      .toEqual(["agent", "branding", "calendar", "channel", "details", "knowledge", "plan", "team", "test"]);
  });
  it("needs credits as well as a plan, and doctors as well as a connected calendar", () => {
    const t = tenant({ calendarConnected: true, plans: [{ id: "p", active: true, type: "payg", name: "P", includedCredits: 0, monthlyPriceBhd: 1, pricePerCreditBhd: 1, rolloverCap: 0, periodStart: "2026-01-01" }] });
    expect(done(setupChecklist(t, facts))).toEqual([]);
  });
  it("lets an admin tick only the manual items", () => {
    const items = setupChecklist(tenant({ onboarding: { done: ["hours", "agent"] } }), facts);
    expect(done(items)).toEqual(["hours"]); // "agent" is worked out from data, so ticking it by hand does nothing
    expect(progress(items)).toEqual({ done: 1, total: 10 });
  });
});
