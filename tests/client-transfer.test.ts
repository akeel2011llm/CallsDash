import { afterEach, describe, expect, it, vi } from "vitest";
import { createDemoData, type Data } from "@/lib/data/demo";
import { createPgData, type Db, type Q } from "@/lib/data/pg";
import { PARTS, applyList, applySettings, applyVoiceMode, buildClientExport, namesOf, readExportFile, type ImportOptions, type ListPart, type PartId } from "@/lib/client-transfer";
import { readServices, servicesKey } from "@/lib/services";
import { studioOf } from "@/lib/agent-studio";
import { makeDb } from "./helpers/pgdb";
import { findKey, mapLiveAgent } from "@/lib/elevenlabs-catalog";

vi.mock("server-only", () => ({}));

async function backend(kind: "demo" | "postgres"): Promise<Data> {
  if (kind === "demo") return createDemoData();
  const pg = await makeDb();
  const q: Q = async (sql, params) => (await pg.query(sql, params as unknown[])).rows as never;
  const db: Db = { q, tx: (fn) => pg.transaction((tx) => fn(async (sql, params) => (await tx.query(sql, params as unknown[])).rows as never)) };
  return createPgData(db) as Data;
}

const PHOTO = "data:image/png;base64,iVBORw0KGgo=";

describe("readExportFile", () => {
  it("refuses other files and newer versions, and drops unknown parts", () => {
    expect(readExportFile({ hello: 1 })).toEqual({ ok: false, error: "format" });
    expect(readExportFile({ format: "callsdash-client", version: 99, parts: {} })).toEqual({ ok: false, error: "version" });
    const r = readExportFile({ format: "callsdash-client", version: 1, parts: { knowledge: [], evil: 1 }, from: { id: "t1", name: "A" } });
    expect(r.ok && Object.keys(r.file.parts)).toEqual(["knowledge"]);
  });
  it("names every part once", () => expect(new Set(PARTS).size).toBe(PARTS.length));
});

describe("Voice mode", () => {
  it("finds realtime_model wherever ElevenLabs keeps it", () => {
    expect(findKey({ agent: { prompt: { realtime_model: "eleven_realtime_v1_max" } } }, "realtime_model")).toEqual({ path: ["agent", "prompt", "realtime_model"], value: "eleven_realtime_v1_max" });
    expect(mapLiveAgent({ conversation_config: { agent: { realtime_model: null } } }).realtime).toEqual({ path: ["agent", "realtime_model"], model: null });
    expect(mapLiveAgent({ conversation_config: { agent: {} } }).realtime).toBeUndefined();
  });
  it("sends the mode at the same place, or reports that the place is unknown", async () => {
    const calls: unknown[] = [];
    const api = { updateAgent: async (_id: string, body: Record<string, unknown>) => { calls.push(body); } };
    expect(await applyVoiceMode(api, "a1", { model: "eleven_realtime_v1_mini", path: ["agent", "realtime_model"] })).toBe("set");
    expect(await applyVoiceMode(api, "a1", { model: null }, ["agent", "prompt", "realtime_model"])).toBe("set");
    expect(await applyVoiceMode(api, "a1", { model: "bad value", path: ["x", "realtime_model"] })).toBe("set");
    expect(await applyVoiceMode(api, "a1", { model: null })).toBe("unknown");
    expect(calls).toEqual([
      { conversation_config: { agent: { realtime_model: "eleven_realtime_v1_mini" } } },
      { conversation_config: { agent: { prompt: { realtime_model: null } } } },
      { conversation_config: { x: { realtime_model: null } } },
    ]);
  });
});

describe.each(["demo", "postgres"] as const)("client Import/Export (%s)", (kind) => {
  afterEach(async () => {
    if (kind !== "demo") return;
    const data = await createDemoData();
    for (const t of await data.listTenants()) if (["MioCclinic", "Almosawi Center"].includes(t.name)) await data.deleteTenant(t.id, "x");
  });

  async function source(data: Data) {
    const t = await data.createTenant({ name: "MioCclinic", nameAr: "ميو", color: "#112233", domain: "mioc.example.bh", planType: "package", actor: "x" });
    await data.updateTenant(t.id, { retentionDays: 30, branding: { welcome: "Welcome to MioCclinic", supportEmail: "desk@mioc.bh", pattern: "dots" } }, "x");
    await data.setOpeningHours(t.id, { "6": [["09:00", "13:00"]] }, "x");
    const agent = await data.getAgent(t.id);
    await data.saveAgent(t.id, {
      ...agent, elevenLabsAgentId: "agent_source123", temperature: 0.6, voiceEn: "voice_en_1",
      prompt: { ...agent.prompt, identity: "You are the receptionist of MioCclinic." },
      studio: { greetingEn: "Hello from MioCclinic", llm: "gemini-2.5-flash", touched: ["conversation", "model"] },
    }, "x", "setup");
    await data.addKnowledge(t.id, "Where is MioCclinic?", "MioCclinic is in Manama.", "en", "x");
    await data.addKnowledge(t.id, "Parking?", "Free parking.", "en", "x");
    const doc = await data.addDoctor(t.id, { name: "Dr. Ali", specialty: "GP" }, "x");
    await data.updateDoctor(t.id, doc.id, { hours: { "6": [["10:00", "12:00"]] } }, "x");
    await data.setDoctorCalendar(t.id, doc.id, "ali@group.calendar.google.com", "x");
    await data.setDoctorImage(t.id, doc.id, PHOTO, "x");
    await data.putItem(t.id, { name: "Whitening kit", details: "Sold at MioCclinic", keywords: "teeth", active: true, createdAt: new Date().toISOString() }, PHOTO, "x");
    await data.setSetting(servicesKey(t.id), [{ id: "svc_a", name: "Check-up", nameAr: "فحص", minutes: 30, price: "BHD 10", active: true }]);
    await data.putCustomer(t.id, { phone: "+97336001122", name: "Fatima", notes: "", conversationIds: ["conv_1"], history: [], createdAt: "2031-01-01", updatedAt: "2031-01-01" }, "x");
    await data.setIntegrations(t.id, { whatsapp: { phoneNumberId: "pn_1", confirmTemplate: "booking_ok", address: "Road 1" }, instagram: { accountId: "ig_1" } }, "x", "setup");
    await data.setSecrets(t.id, { instagramToken: "secret-token" });
    return t;
  }

  async function importAll(data: Data, targetId: string, parts: Partial<Record<PartId, unknown>>, o: ImportOptions) {
    const settings = Object.fromEntries(Object.entries(parts).filter(([k]) => !["team", "services", "knowledge", "catalogue", "tables", "customers"].includes(k)));
    await applySettings(data, targetId, settings, o, "admin");
    const out: Record<string, unknown> = {};
    for (const p of ["team", "services", "knowledge", "catalogue", "tables", "customers"] as ListPart[]) {
      if (!Array.isArray(parts[p])) continue;
      out[p] = await applyList(data, targetId, p, parts[p] as unknown[], o, "admin", o.mode === "replace" ? namesOf(p, parts[p] as unknown[]) : undefined);
    }
    return out;
  }

  it("exports the ticked parts without secrets or connections, and imports them into another client under its own name", async () => {
    const data = await backend(kind);
    const src = await source(data);
    const file = await buildClientExport(data, (await data.getTenant(src.id))!, PARTS.filter((p) => p !== "customers"), true, "2031-02-01T00:00:00Z");
    const text = JSON.stringify(file);
    for (const secret of ["agent_source123", "secret-token", "pn_1", "ig_1", "ali@group.calendar.google.com", "Fatima"]) expect(text).not.toContain(secret);
    expect(file.parts.customers).toBeUndefined();
    expect((file.parts.team as { photo?: string }[])[0].photo).toBe(PHOTO);

    const parsed = readExportFile(JSON.parse(text));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const target = await data.createTenant({ name: "Almosawi Center", nameAr: "الموسوي", color: "#223344", domain: "almosawi.example.bh", planType: "package", actor: "x" });
    const r = await importAll(data, target.id, parsed.file.parts, { mode: "merge", rename: true, photos: true, from: parsed.file.from });
    expect(r.knowledge).toMatchObject({ added: 2, updated: 0 });

    const t = (await data.getTenant(target.id))!;
    expect(t.branding).toMatchObject({ welcome: "Welcome to Almosawi Center", supportEmail: "desk@mioc.bh", pattern: "dots", displayName: "Almosawi Center" });
    expect(t.openingHours["6"]).toEqual([["09:00", "13:00"]]);
    expect(t.retentionDays).toBe(30);
    expect(t.integrations.whatsapp).toMatchObject({ confirmTemplate: "booking_ok", address: "Road 1" });
    expect(t.integrations.whatsapp?.phoneNumberId).toBeUndefined();
    expect(t.integrations.instagram).toBeUndefined();

    const a = await data.getAgent(target.id);
    expect(a.elevenLabsAgentId).toBe("");
    expect(a.prompt.identity).toBe("You are the receptionist of Almosawi Center.");
    expect(a.temperature).toBe(0.6);
    expect(a.voiceEn).toBe("voice_en_1");
    expect(studioOf(a)).toMatchObject({ greetingEn: "Hello from Almosawi Center", llm: "gemini-2.5-flash" });
    expect(studioOf(a).touched).toEqual(expect.arrayContaining(["conversation", "model"]));

    expect((await data.getKnowledge(target.id)).map((k) => k.answer)).toContain("Almosawi Center is in Manama.");
    const docs = await data.getDoctors(target.id);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ name: "Dr. Ali", hours: { "6": [["10:00", "12:00"]] } });
    expect(docs[0].googleCalendarId).toBeUndefined();
    expect(await data.getDoctorImage(target.id, docs[0].id)).toBe(PHOTO);
    const items = await data.getItems(target.id);
    expect(items[0]).toMatchObject({ name: "Whitening kit", details: "Sold at Almosawi Center", hasImage: true });
    expect(readServices(await data.getSetting(servicesKey(target.id))).map((s) => s.name)).toEqual(["Check-up"]);
    expect(await data.getCustomers(target.id)).toHaveLength(0);

    // the same file again merges: nothing doubles
    const again = await importAll(data, target.id, parsed.file.parts, { mode: "merge", rename: true, photos: true, from: parsed.file.from });
    expect(again.knowledge).toMatchObject({ added: 0, updated: 2 });
    expect(again.team).toMatchObject({ added: 0, updated: 1 });
    expect(await data.getKnowledge(target.id)).toHaveLength(2);
  });

  it("uses the settings read from ElevenLabs, replaces every listed name (English and Arabic) and carries the Voice mode", async () => {
    const data = await backend(kind);
    const src = await source(data);
    const stored = await data.getAgent(src.id);
    const liveAgent = { ...stored, voiceEn: "voice_live", temperature: 0.2, studio: { ...stored.studio, llm: "gpt-live", greetingEn: "Hi, Al Mosawi here", greetingAr: "أهلاً بكم في ميو" } };
    const file = await buildClientExport(data, (await data.getTenant(src.id))!, ["voices", "voiceMode", "studio.model", "studio.conversation", "services"], false, "2031-02-01T00:00:00Z",
      { agent: liveAgent, realtime: { path: ["agent", "realtime_model"], model: "eleven_realtime_v1_max" } });
    expect(file.assistantFrom).toBe("live");
    expect(file.parts.voiceMode).toEqual({ model: "eleven_realtime_v1_max", path: ["agent", "realtime_model"] });
    const target = await data.createTenant({ name: "Almosawi Center", nameAr: "الموسوي", color: "#223344", domain: "almosawi.example.bh", planType: "package", actor: "x" });
    await data.setSetting(servicesKey(src.id), [{ id: "svc_b", name: "MioCclinic package", nameAr: "باقة ميو", minutes: 30, price: "", active: true }]);
    const parts = (await buildClientExport(data, (await data.getTenant(src.id))!, ["services"], false, "x")).parts;
    const o: ImportOptions = { mode: "merge", rename: true, photos: false, from: file.from, oldNames: ["MioCclinic", "Al Mosawi", "ميو"], newName: "Almosawi Center", newNameAr: "الموسوي" };
    const s = await applySettings(data, target.id, file.parts, o, "admin");
    const l = await applyList(data, target.id, "services", parts.services as unknown[], o, "admin");
    expect(s.renamed).toBe(2);
    expect(l.renamed).toBe(2);
    const a = await data.getAgent(target.id);
    expect(a).toMatchObject({ voiceEn: "voice_live", temperature: 0.2 });
    expect(studioOf(a)).toMatchObject({ llm: "gpt-live", greetingEn: "Hi, Almosawi Center here", greetingAr: "أهلاً بكم في الموسوي" });
    expect(readServices(await data.getSetting(servicesKey(target.id)))[0]).toMatchObject({ name: "Almosawi Center package", nameAr: "باقة الموسوي" });
  });

  it("replace removes what the file does not have, archives people and never deletes customers", async () => {
    const data = await backend(kind);
    const src = await source(data);
    await data.addDoctor(src.id, { name: "Dr. Extra", specialty: "ENT" }, "x");
    const o: ImportOptions = { mode: "replace", rename: false, photos: false, from: { id: src.id, name: src.name, nameAr: "", displayName: src.name } };
    const r = await importAll(data, src.id, {
      knowledge: [{ question: "Parking?", answer: "Paid parking.", language: "en" }],
      team: [{ name: "Dr. Ali", specialty: "GP" }],
      catalogue: [],
      customers: [{ phone: "+97339998877", name: "New person" }],
    }, o);
    expect(r.knowledge).toMatchObject({ removed: 1, updated: 1 });
    expect((await data.getKnowledge(src.id)).map((k) => k.answer)).toEqual(["Paid parking."]);
    const docs = await data.getDoctors(src.id);
    expect(docs.find((d) => d.name === "Dr. Extra")?.active).toBe(false);
    expect(docs.find((d) => d.name === "Dr. Ali")?.active).not.toBe(false);
    expect(await data.getItems(src.id)).toHaveLength(0);
    expect((await data.getCustomers(src.id)).map((c) => c.name).sort()).toEqual(["Fatima", "New person"]);
  });
});
