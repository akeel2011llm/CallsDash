import { afterEach, describe, expect, it, vi } from "vitest";
import { createDemoData, type Data } from "@/lib/data/demo";
import { createPgData, type Db, type Q } from "@/lib/data/pg";
import { duplicateClient, renamer, type CopyInput } from "@/lib/client-copy";
import { DuplicateError } from "@/lib/errors";
import { PLAN_PRESETS } from "@/lib/plans";
import { makeDb } from "./helpers/pgdb";

vi.mock("server-only", () => ({}));

async function backend(kind: "demo" | "postgres"): Promise<Data> {
  if (kind === "demo") return createDemoData();
  const pg = await makeDb();
  const q: Q = async (sql, params) => (await pg.query(sql, params as unknown[])).rows as never;
  const db: Db = { q, tx: (fn) => pg.transaction((tx) => fn(async (sql, params) => (await tx.query(sql, params as unknown[])).rows as never)) };
  return createPgData(db) as Data;
}

const input = (over: Partial<CopyInput> = {}): CopyInput => ({
  name: "Almosawi Clinic", nameAr: "", domain: "almosawi.example.bh", color: "#223344", plan: { ...PLAN_PRESETS.clinic }, copyDoctors: true, copyKnowledge: true, ...over,
});

describe("renamer", () => {
  it("replaces the old names in any case, longest first, and counts", () => {
    const r = renamer({ names: ["MioCclinic", "MioC"], namesAr: ["ميو"] }, { name: "Almosawi Clinic", nameAr: "" });
    expect(r.text("Welcome to MIOCCLINIC. Call mioCclinic, or MioC.")).toBe("Welcome to Almosawi Clinic. Call Almosawi Clinic, or Almosawi Clinic.");
    expect(r.count()).toBe(3);
    expect(r.deep({ a: ["x MioC"], b: { c: "no match", n: 4 } })).toEqual({ a: ["x Almosawi Clinic"], b: { c: "no match", n: 4 } });
  });
  it("leaves short names alone and does nothing when the name is unchanged", () => {
    const r = renamer({ names: ["Al", "Same"], namesAr: [] }, { name: "Same", nameAr: "" });
    expect(r.text("Al Noor and Same")).toBe("Al Noor and Same");
    expect(r.count()).toBe(0);
  });
});

describe.each(["demo", "postgres"] as const)("duplicating a client (%s)", (kind) => {
  // the demo store is one shared object for the whole file: remove what a test made
  afterEach(async () => {
    if (kind !== "demo") return;
    const data = await createDemoData();
    for (const t of await data.listTenants()) if (["MioCclinic", "Almosawi Clinic"].includes(t.name)) await data.deleteTenant(t.id, "x");
  });
  async function source(data: Data) {
    const t = await data.createTenant({ name: "MioCclinic", nameAr: "ميو", color: "#112233", domain: "mioc.example.bh", planType: "package", actor: "x" });
    await data.updateTenant(t.id, { retentionDays: 30, zeroBalancePolicy: "overdraft", lowBalanceThreshold: 0.3, branding: { welcome: "Welcome to MioCclinic", supportPhone: "+97311111111", logoUrl: "data:image/png;base64,AAAA", pattern: "dots", hidePoweredBy: true } }, "x");
    await data.setOpeningHours(t.id, { "6": [["09:00", "13:00"]] }, "x");
    await data.setPermissions(t.id, { editPrompt: false, editVoice: true, editBehaviour: true, editKnowledge: false }, "x");
    const agent = await data.getAgent(t.id);
    await data.saveAgent(t.id, { ...agent, elevenLabsAgentId: "agent_source123", prompt: { ...agent.prompt, identity: "You are the receptionist of MioCclinic." }, studio: { greetingEn: "Hello from MioCclinic" } }, "x", "setup");
    await data.addKnowledge(t.id, "Where is MioCclinic?", "MioCclinic is in Manama.", "en", "x");
    const doc = await data.addDoctor(t.id, { name: "Dr. Ali", specialty: "GP" }, "x");
    await data.updateDoctor(t.id, doc.id, { hours: { "6": [["10:00", "12:00"]] }, timeOff: [{ from: "2031-01-01", to: "2031-01-05" }] }, "x");
    await data.setDoctorCalendar(t.id, doc.id, "ali@group.calendar.google.com", "x");
    await data.setIntegrations(t.id, { whatsapp: { phoneNumberId: "pn_1", displayNumber: "+97312345678" }, instagram: { accountId: "ig_1" }, elevenlabs: { kbDocId: "kb_1" } }, "x", "setup");
    await data.setSecrets(t.id, { instagramToken: "secret-token" });
    await data.createBooking(t.id, { doctorId: doc.id, patientName: "Fatima", patientPhone: "+973 3600 1122", service: "Check-up", startsAt: "2031-01-05T08:00:00.000Z", durationMin: 30, status: "confirmed", source: "ai" }, "x");
    return t;
  }

  it("copies the settings under the new name and none of the people, money or connections", async () => {
    const data = await backend(kind);
    const src = await source(data);
    const r = await duplicateClient(data, src.id, input(), "admin");
    expect(r).toMatchObject({ doctors: 1, knowledge: 1 });
    expect(r.renamed).toBeGreaterThanOrEqual(4);

    const t = (await data.getTenant(r.tenantId))!;
    expect(t).toMatchObject({ name: "Almosawi Clinic", retentionDays: 30, zeroBalancePolicy: "overdraft", lowBalanceThreshold: 0.3, allowedDomains: ["almosawi.example.bh"] });
    expect(t.openingHours).toEqual({ "6": [["09:00", "13:00"]] });
    expect(t.permissions).toMatchObject({ editPrompt: false, editKnowledge: false });
    expect(t.branding).toMatchObject({ displayName: "Almosawi Clinic", displayNameAr: "Almosawi Clinic", primaryColor: "#223344", welcome: "Welcome to Almosawi Clinic", pattern: "dots", hidePoweredBy: true, domain: "almosawi.example.bh" });
    expect(t.branding.logoUrl).toBeUndefined();
    expect(t.branding.supportPhone).toBeUndefined();
    expect(t.integrations).toEqual({});
    expect(t.channels).toMatchObject({ whatsapp: "off", instagram: "off", phone: "off" });
    expect(t.plans).toHaveLength(1);
    expect(t.plans[0].contractRef).toBeUndefined();

    const a = await data.getAgent(r.tenantId);
    expect(a.elevenLabsAgentId).toBe("");
    expect(a.prompt.identity).toBe("You are the receptionist of Almosawi Clinic.");
    expect(a.studio?.greetingEn).toBe("Hello from Almosawi Clinic");

    const k = await data.getKnowledge(r.tenantId);
    expect(k.map((x) => [x.question, x.answer])).toEqual([["Where is Almosawi Clinic?", "Almosawi Clinic is in Manama."]]);
    const docs = await data.getDoctors(r.tenantId);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ name: "Dr. Ali", specialty: "GP", hours: { "6": [["10:00", "12:00"]] } });
    expect(docs[0].googleCalendarId).toBeUndefined();
    expect(docs[0].timeOff ?? []).toEqual([]);

    expect(await data.getBookings(r.tenantId)).toEqual([]);
    expect(await data.getSecrets(r.tenantId)).toEqual({});
    expect(await data.listProfiles(r.tenantId)).toEqual([]);
    expect(await data.findTenantByAgent("agent_source123")).toMatchObject({ id: src.id });

    // the source is untouched
    expect((await data.getTenant(src.id))!.name).toBe("MioCclinic");
    expect((await data.getAgent(src.id)).elevenLabsAgentId).toBe("agent_source123");
    expect((await data.getKnowledge(src.id))[0].question).toBe("Where is MioCclinic?");
  });

  it("can leave the doctors and the knowledge base out", async () => {
    const data = await backend(kind);
    const src = await source(data);
    const r = await duplicateClient(data, src.id, input({ copyDoctors: false, copyKnowledge: false }), "admin");
    expect(await data.getDoctors(r.tenantId)).toEqual([]);
    expect(await data.getKnowledge(r.tenantId)).toEqual([]);
  });

  it("refuses a name or website that another client already has, and makes nothing", async () => {
    const data = await backend(kind);
    const src = await source(data);
    const before = (await data.listTenants()).length;
    await expect(duplicateClient(data, src.id, input({ name: "mioc clinic".replace(" ", "") }), "admin")).rejects.toBeInstanceOf(DuplicateError);
    await expect(duplicateClient(data, src.id, input({ domain: "mioc.example.bh" }), "admin")).rejects.toMatchObject({ field: "domain" });
    expect((await data.listTenants()).length).toBe(before);
  });
});
