import { afterEach, describe, expect, it, vi } from "vitest";
import { createDemoData, type Data } from "@/lib/data/demo";
import { createPgData, type Db, type Q } from "@/lib/data/pg";
import { CustomerError, cleanPhone, lookupCustomer, lookupModeOf, phoneKey, recordVisit, saveCustomerByStaff, saveCustomerFromAssistant } from "@/lib/customers";
import { parsePostCall } from "@/lib/elevenlabs";
import { buildPrompt, toolDefinitions } from "@/lib/agent-config";
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

describe("phone numbers", () => {
  it("match on the last 8 digits, whatever the form or digits used", () => {
    expect(phoneKey("+973 3600 1122")).toBe("36001122");
    expect(phoneKey("36001122")).toBe("36001122");
    expect(phoneKey("٣٦٠٠١١٢٢")).toBe("36001122");
    expect(phoneKey("12345")).toBe("");
  });
  it("shows a Bahrain number with +973 and refuses what is not a number", () => {
    expect(cleanPhone("3600 1122")).toBe("+97336001122");
    expect(cleanPhone("00971501234567")).toBe("+971501234567");
    expect(cleanPhone("abc")).toBeNull();
    expect(cleanPhone("1234567890123456")).toBeNull();
  });
});

describe.each(["demo", "postgres"] as const)("customers (%s)", (kind) => {
  const made: string[] = [];
  afterEach(async () => {
    if (kind !== "demo") return;
    const data = await createDemoData();
    for (const id of made.splice(0)) await data.deleteTenant(id, "x");
  });
  async function clinic(data: Data, name = "Cust Clinic") {
    const t = await data.createTenant({ name, nameAr: "", color: "#112233", domain: `${name.replace(/\W/g, "").toLowerCase()}.example.bh`, planType: "package", plan: { ...PLAN_PRESETS.clinic }, actor: "x" });
    made.push(t.id);
    return t.id;
  }

  it("saves a customer from the assistant and finds them again by phone, in any form", async () => {
    const d = await backend(kind);
    const t = await clinic(d);
    const r = await saveCustomerFromAssistant(d, t, { phone: "3600 1122", name: "Hessa Al Mannai", language: "ar", note: "Prefers mornings", conversationId: "conv_1" });
    expect(r.created).toBe(true);
    expect(r.customer.phone).toBe("+97336001122");
    const again = await d.findCustomer(t, { phoneKey: phoneKey("+973-36001122") });
    expect(again?.name).toBe("Hessa Al Mannai");
    expect(again?.notes).toContain("Prefers mornings");
    expect(await d.findCustomer(t, { conversationId: "conv_1" })).toMatchObject({ id: r.customer.id });
    expect((await d.getCustomers(t)).length).toBe(1);
  });

  it("CPR mode: finds the customer by CPR number whatever phone they use, and the CPR is the proof", async () => {
    const d = await backend(kind);
    const t = await clinic(d);
    await saveCustomerFromAssistant(d, t, { phone: "36001122", name: "Hessa Al Mannai", cpr: "850412345", note: "Prefers mornings" }, "cpr");
    expect(await lookupCustomer(d, t, { cpr: "850 412 345" }, "cpr")).toMatchObject({ found: true, verified: true, name: "Hessa Al Mannai" });
    expect(await lookupCustomer(d, t, { cpr: "111111112" }, "cpr")).toMatchObject({ found: false });
    expect(await lookupCustomer(d, t, { phone: "36001122" }, "cpr")).toMatchObject({ found: false }); // a phone number alone finds nobody
    expect(await lookupCustomer(d, t, { cpr: "12" }, "cpr")).toMatchObject({ found: false });
    // a new phone number, same CPR: the same customer, with the new note added and no second record
    const r = await saveCustomerFromAssistant(d, t, { phone: "39887766", name: "Hessa Al Mannai", cpr: "850412345", note: "Now on a new phone" }, "cpr");
    expect(r.created).toBe(false);
    expect((await d.getCustomers(t)).length).toBe(1);
    // the phone may be left out for a CPR the clinic already knows
    const again = await saveCustomerFromAssistant(d, t, { phone: "", cpr: "850412345", note: "third" }, "cpr");
    expect(again.customer.notes.split("\n")).toHaveLength(3);
  });

  it("CPR mode: a record made from a bare phone number gets the CPR, and its earlier conversations are dropped", async () => {
    const d = await backend(kind);
    const t = await clinic(d);
    await recordVisit(d, t, { conversationId: "conv_old", phone: "36001122", channel: "phone", language: "en", summary: "somebody else's call", at: new Date().toISOString() });
    const r = await saveCustomerFromAssistant(d, t, { phone: "36001122", name: "Omar", cpr: "850412345" }, "cpr");
    expect(r.cprSaved).toBe(true);
    expect(r.customer.history).toHaveLength(0);
    // in phone mode the same record would not take the CPR, because it holds conversations
    const d2 = await backend(kind);
    const t2 = await clinic(d2, "Cust Phone");
    await recordVisit(d2, t2, { conversationId: "conv_old", phone: "36001122", channel: "phone", language: "en", summary: "x", at: new Date().toISOString() });
    expect((await saveCustomerFromAssistant(d2, t2, { phone: "36001122", name: "Omar", cpr: "850412345" })).cprSaved).toBe(false);
  });

  it("saves the clinic's lookup choice and writes it into the assistant's instructions", async () => {
    const d = await backend(kind);
    const t = await clinic(d);
    const cur = await d.getAgent(t);
    expect(lookupModeOf(cur)).toBe("phone");
    await d.saveAgent(t, { ...cur, customerLookup: "cpr" }, "x", "test");
    const now = await d.getAgent(t);
    expect(lookupModeOf(now)).toBe("cpr");
    expect(buildPrompt(now)).toContain("knows its customers by CPR number");
    expect(buildPrompt({ ...now, customerLookup: "phone" })).not.toContain("knows its customers by CPR number");
    expect(buildPrompt({ ...now, customerLookup: "phone" })).toContain("lookup_customer with it as patient_phone");
  });

  it("keeps clients apart", async () => {
    const d = await backend(kind);
    const a = await clinic(d, "Cust A");
    const b = await clinic(d, "Cust B");
    const c = await saveCustomerFromAssistant(d, a, { phone: "36001122", name: "Only A" });
    expect(await d.findCustomer(b, { phoneKey: "36001122" })).toBeUndefined();
    expect(await d.getCustomer(b, c.customer.id)).toBeUndefined();
    await d.deleteCustomer(b, c.customer.id, "x"); // another client's id does nothing
    expect(await d.getCustomer(a, c.customer.id)).toBeDefined();
  });

  it("updates the same customer instead of making a second one, and appends notes", async () => {
    const d = await backend(kind);
    const t = await clinic(d);
    await saveCustomerFromAssistant(d, t, { phone: "36001122", name: "Omar", note: "one" });
    const r = await saveCustomerFromAssistant(d, t, { phone: "+973 3600 1122", email: "omar@example.com", note: "two" });
    expect(r.created).toBe(false);
    expect(r.customer.notes.split("\n")).toHaveLength(2);
    expect(r.customer.email).toBe("omar@example.com");
    expect((await d.getCustomers(t)).length).toBe(1);
  });

  it("only gives the first name until the CPR on file is repeated", async () => {
    const d = await backend(kind);
    const t = await clinic(d);
    await saveCustomerFromAssistant(d, t, { phone: "36001122", name: "Hessa Al Mannai", cpr: "850412345", note: "Allergic to nothing known" });
    const bare = await lookupCustomer(d, t, { phone: "36001122" });
    expect(bare).toMatchObject({ found: true, verified: false, first_name: "Hessa" });
    expect(JSON.stringify(bare)).not.toContain("Allergic");
    expect(JSON.stringify(bare)).not.toContain("Mannai");
    const wrong = await lookupCustomer(d, t, { phone: "36001122", cpr: "111111112" });
    expect(wrong).toMatchObject({ found: true, verified: false, cpr_mismatch: true });
    expect(JSON.stringify(wrong)).not.toContain("Hessa");
    const right = await lookupCustomer(d, t, { phone: "36001122", cpr: "850 412 345" });
    expect(right).toMatchObject({ found: true, verified: true, name: "Hessa Al Mannai" });
    expect(JSON.stringify(right)).toContain("Allergic");
    expect(await lookupCustomer(d, t, { phone: "36009999" })).toMatchObject({ found: false });
    expect(await lookupCustomer(d, t, { phone: "12" })).toMatchObject({ found: false });
  });

  it("says nothing more for a customer with no CPR on file", async () => {
    const d = await backend(kind);
    const t = await clinic(d);
    await saveCustomerFromAssistant(d, t, { phone: "36001122", name: "Omar Yusuf", note: "secret note" });
    const r = await lookupCustomer(d, t, { phone: "36001122", cpr: "850412345" });
    expect(r).toMatchObject({ found: true, verified: false, first_name: "Omar" });
    expect(JSON.stringify(r)).not.toContain("secret");
  });

  it("does not let someone who knows only the number rewrite a customer who has a CPR on file", async () => {
    const d = await backend(kind);
    const t = await clinic(d);
    await saveCustomerFromAssistant(d, t, { phone: "36001122", name: "Hessa", cpr: "850412345" });
    await expect(saveCustomerFromAssistant(d, t, { phone: "36001122", name: "Someone Else" })).rejects.toMatchObject({ code: "cpr_mismatch" });
    await expect(saveCustomerFromAssistant(d, t, { phone: "36001122", name: "Someone Else", cpr: "111111112" })).rejects.toBeInstanceOf(CustomerError);
    const ok = await saveCustomerFromAssistant(d, t, { phone: "36001122", name: "Hessa M", cpr: "850412345" });
    expect(ok.customer.name).toBe("Hessa M");
    // a note alone is always welcome
    const noted = await saveCustomerFromAssistant(d, t, { phone: "36001122", note: "likes tea" });
    expect(noted.customer.name).toBe("Hessa M");
    expect(noted.customer.notes).toContain("likes tea");
  });

  it("only attaches a CPR to a new customer or an empty record, never to one that already has notes or conversations", async () => {
    const d = await backend(kind);
    const t = await clinic(d);
    await saveCustomerFromAssistant(d, t, { phone: "36001122", name: "Hessa", note: "private note" });
    const r = await saveCustomerFromAssistant(d, t, { phone: "36001122", cpr: "111111112" });
    expect(r.cprSaved).toBe(false);
    expect(r.customer.cpr).toBeUndefined();
    expect(await lookupCustomer(d, t, { phone: "36001122", cpr: "111111112" })).toMatchObject({ verified: false });
    // an empty shell may get one
    await saveCustomerFromAssistant(d, t, { phone: "36002222", name: "Omar" });
    expect((await saveCustomerFromAssistant(d, t, { phone: "36002222", cpr: "850412345" })).cprSaved).toBe(true);
  });

  it("refuses a phone number that is not one, and ignores a CPR that is not 9 digits", async () => {
    const d = await backend(kind);
    const t = await clinic(d);
    await expect(saveCustomerFromAssistant(d, t, { phone: "hello" })).rejects.toMatchObject({ code: "bad_phone" });
    const r = await saveCustomerFromAssistant(d, t, { phone: "36001122", cpr: "12345" });
    expect(r.cprSaved).toBe(false);
    expect(r.customer.cpr).toBeUndefined();
  });

  it("adds a finished conversation to the history once, by phone or by the linked conversation id", async () => {
    const d = await backend(kind);
    const t = await clinic(d);
    const first = await saveCustomerFromAssistant(d, t, { phone: "36001122", name: "Omar", conversationId: "conv_web" });
    // a website chat has no number: found through the conversation id the assistant linked
    const viaId = await recordVisit(d, t, { conversationId: "conv_web", channel: "website", language: "en", summary: "Asked about prices", at: "2099-01-01T09:00:00.000Z" });
    expect(viaId?.id).toBe(first.customer.id);
    expect(viaId?.history).toHaveLength(1);
    // the same webhook twice changes nothing
    await recordVisit(d, t, { conversationId: "conv_web", channel: "website", language: "en", summary: "Asked about prices", at: "2099-01-01T09:00:00.000Z" });
    expect((await d.getCustomer(t, first.customer.id))?.history).toHaveLength(1);
    // by number
    const viaPhone = await recordVisit(d, t, { conversationId: "conv_2", phone: "+973 3600 1122", channel: "phone", language: "ar", summary: "Moved a booking", at: "2099-01-02T09:00:00.000Z" });
    expect(viaPhone?.history.map((h) => h.summary)).toEqual(["Moved a booking", "Asked about prices"]);
    expect(viaPhone?.lastContactAt).toBe("2099-01-02T09:00:00.000Z");
  });

  it("makes a customer of a caller's number with no record, and ignores a conversation it cannot tie to anyone", async () => {
    const d = await backend(kind);
    const t = await clinic(d);
    expect(await recordVisit(d, t, { conversationId: "conv_x", channel: "website", language: "en", summary: "hi", at: "2026-10-28T09:00:00.000Z" })).toBeNull();
    const c = await recordVisit(d, t, { conversationId: "conv_y", phone: "36001122", channel: "whatsapp", language: "ar", summary: "Opening hours?", at: "2026-10-28T09:00:00.000Z" });
    expect(c).toMatchObject({ phone: "+97336001122", name: "", language: "ar" });
    expect(c?.history).toHaveLength(1);
  });

  it("lets staff add, edit and delete, and keeps phone numbers unique", async () => {
    const d = await backend(kind);
    const t = await clinic(d);
    const c = await saveCustomerByStaff(d, t, { name: "Sara", phone: "3600 1122", cpr: "850412345", email: "s@example.com", language: "en", notes: "VIP" }, "staff");
    expect(c.phone).toBe("+97336001122");
    await expect(saveCustomerByStaff(d, t, { name: "Dup", phone: "36001122" }, "staff")).rejects.toMatchObject({ code: "duplicate_phone" });
    await expect(saveCustomerByStaff(d, t, { name: "X", phone: "1" }, "staff")).rejects.toMatchObject({ code: "bad_phone" });
    await expect(saveCustomerByStaff(d, t, { name: "X", phone: "36009999", cpr: "123" }, "staff")).rejects.toMatchObject({ code: "bad_cpr" });
    await expect(saveCustomerByStaff(d, t, { name: "X", phone: "36009999", email: "nope" }, "staff")).rejects.toMatchObject({ code: "bad_email" });
    const edited = await saveCustomerByStaff(d, t, { id: c.id, name: "Sara K", phone: "+973 3600 1122", notes: "" }, "staff");
    expect(edited).toMatchObject({ id: c.id, name: "Sara K", notes: "" });
    expect(edited.cpr).toBeUndefined(); // an emptied CPR box clears it
    await expect(saveCustomerByStaff(d, t, { id: "00000000-0000-0000-0000-000000000000", name: "Ghost", phone: "36007777" }, "staff")).rejects.toMatchObject({ code: "unknown" });
    await d.deleteCustomer(t, c.id, "staff");
    expect(await d.getCustomer(t, c.id)).toBeUndefined();
  });

  it("is removed with its client", async () => {
    const d = await backend(kind);
    const t = await clinic(d);
    const c = await saveCustomerFromAssistant(d, t, { phone: "36001122", name: "Omar" });
    await d.deleteTenant(t, "x");
    made.splice(made.indexOf(t), 1);
    expect(await d.getCustomer(t, c.customer.id)).toBeUndefined();
  });
});

describe("customers and the assistant", () => {
  it("offers lookup_customer and save_customer, and accept either a phone number or a CPR number", () => {
    const defs = toolDefinitions("https://app.example", "s3cret");
    for (const name of ["lookup_customer", "save_customer"]) {
      const schema = (defs[name].api_schema as { request_body_schema: { required: string[] } }).request_body_schema;
      expect(schema.required).toEqual(["agent_id"]); // which of phone or CPR is needed depends on the clinic's choice, checked on the server
    }
  });

  it("reads the caller's number from the post-call payload, from our own variable first", () => {
    const base = { type: "post_call_transcription", data: { agent_id: "a", conversation_id: "c", transcript: [], metadata: {}, analysis: {} } };
    const withDyn = (dynamic_variables: object, metadata: object = {}) => parsePostCall({ ...base, data: { ...base.data, metadata, conversation_initiation_client_data: { dynamic_variables } } });
    expect(withDyn({ caller_phone: "+97336001122" })?.callerPhone).toBe("+97336001122");
    expect(withDyn({ caller_phone: "", system__caller_id: "+97339887766" })?.callerPhone).toBe("+97339887766");
    expect(withDyn({}, { phone_call: { external_number: "+97330000000" } })?.callerPhone).toBe("+97330000000");
    expect(withDyn({ caller_phone: "" })?.callerPhone).toBeUndefined();
  });
});
