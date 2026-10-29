import { afterEach, describe, expect, it, vi } from "vitest";
import { createDemoData, type Data } from "@/lib/data/demo";
import { createPgData, type Db, type Q } from "@/lib/data/pg";
import { findItems, foldText, itemImageDataUrl, saveItemByStaff, scoreItem, ItemError } from "@/lib/items";
import { photoCaption, photoFailureHint, sendItemPhoto } from "@/lib/whatsapp-photo";
import { decodeDataUrl } from "@/lib/brand-image";
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

// a 1x1 png
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const ORIGIN = "https://app.example";

describe("catalogue search", () => {
  const item = (o: Partial<Parameters<typeof scoreItem>[0]> = {}) => ({ name: "Whitening kit", nameAr: "طقم تبييض الأسنان", details: "Home teeth whitening, 14 days.", detailsAr: "", keywords: "bleach, تبييض", ...o });
  it("scores a name word above a keyword above the details, and zero when nothing matches", () => {
    expect(scoreItem(item(), "whitening")).toBeGreaterThan(scoreItem(item(), "bleach"));
    expect(scoreItem(item(), "bleach")).toBeGreaterThan(scoreItem(item(), "days"));
    expect(scoreItem(item(), "parking")).toBe(0);
    expect(scoreItem(item(), "")).toBe(0);
  });
  it("matches Arabic whatever the letter forms or vowel marks", () => {
    expect(foldText("أَسْنَان إلى ة")).toBe(foldText("اسنان الى ه"));
    expect(scoreItem(item(), "تبييض الاسنان")).toBeGreaterThan(0);
    expect(scoreItem(item(), "أسنان")).toBeGreaterThan(0);
  });
});

describe("photo files", () => {
  const file = (type: string, bytes: number) => new File([new Uint8Array(bytes).fill(1)], "x", { type });
  it("accepts a small png, jpeg or webp and nothing else", async () => {
    expect(await itemImageDataUrl(file("image/png", 100))).toMatch(/^data:image\/png;base64,/);
    expect(await itemImageDataUrl(file("image/svg+xml", 100))).toBeNull(); // a picture that can carry script
    expect(await itemImageDataUrl(file("image/gif", 100))).toBeNull();
    expect(await itemImageDataUrl(file("image/jpeg", 800 * 1024))).toBeNull();
    expect(await itemImageDataUrl(file("image/jpeg", 0))).toBeNull();
  });
});

describe.each(["demo", "postgres"] as const)("catalogue (%s)", (kind) => {
  const made: string[] = [];
  afterEach(async () => {
    if (kind !== "demo") return;
    const data = await createDemoData();
    for (const id of made.splice(0)) await data.deleteTenant(id, "x");
  });
  async function clinic(data: Data, name = "Cat Clinic") {
    const t = await data.createTenant({ name, nameAr: "", color: "#112233", domain: `${name.replace(/\W/g, "").toLowerCase()}.example.bh`, planType: "package", plan: { ...PLAN_PRESETS.clinic }, actor: "x" });
    made.push(t.id);
    return t;
  }

  it("adds, edits and deletes an item, keeping, replacing and removing its photo", async () => {
    const d = await backend(kind);
    const t = await clinic(d);
    const a = await saveItemByStaff(d, t.id, { name: "Whitening kit", details: "14 days", price: "BHD 25", active: true }, PNG, "x");
    expect(a).toMatchObject({ name: "Whitening kit", hasImage: true, price: "BHD 25", active: true });
    expect(decodeDataUrl(await d.getItemImage(t.id, a.id))?.type).toBe("image/png");
    // no new photo: the old one stays
    const b = await saveItemByStaff(d, t.id, { id: a.id, name: "Whitening kit pro", details: "14 days", active: true }, undefined, "x");
    expect(b.hasImage).toBe(true);
    expect(b.name).toBe("Whitening kit pro");
    expect(b.price).toBeUndefined();
    // removing it
    const c = await saveItemByStaff(d, t.id, { id: a.id, name: "Whitening kit pro", active: true }, null, "x");
    expect(c.hasImage).toBe(false);
    expect(await d.getItemImage(t.id, a.id)).toBeUndefined();
    expect((await d.getItems(t.id)).length).toBe(1);
    await d.deleteItem(t.id, a.id, "x");
    expect(await d.getItem(t.id, a.id)).toBeUndefined();
  });

  it("needs a name and refuses an item that is not there", async () => {
    const d = await backend(kind);
    const t = await clinic(d);
    await expect(saveItemByStaff(d, t.id, { name: "  ", active: true }, undefined, "x")).rejects.toBeInstanceOf(ItemError);
    await expect(saveItemByStaff(d, t.id, { id: "00000000-0000-4000-8000-000000000000", name: "x", active: true }, undefined, "x")).rejects.toBeInstanceOf(ItemError);
  });

  it("keeps clients apart", async () => {
    const d = await backend(kind);
    const a = await clinic(d, "Cat A");
    const b = await clinic(d, "Cat B");
    const item = await saveItemByStaff(d, a.id, { name: "Only A", active: true }, PNG, "x");
    expect(await d.getItem(b.id, item.id)).toBeUndefined();
    expect(await d.getItemImage(b.id, item.id)).toBeUndefined();
    await d.deleteItem(b.id, item.id, "x"); // another client's id does nothing
    expect(await d.getItem(a.id, item.id)).toBeDefined();
    expect(await findItems(d, b, { query: "Only A" }, ORIGIN)).toMatchObject({ found: false });
  });

  it("find_item answers in the customer's language with a photo address, and never offers hidden items", async () => {
    const d = await backend(kind);
    const t = await clinic(d);
    const kit = await saveItemByStaff(d, t.id, { name: "Whitening kit", nameAr: "طقم تبييض", details: "Home whitening", detailsAr: "تبييض منزلي", price: "BHD 25", keywords: "bleach", active: true }, PNG, "x");
    await saveItemByStaff(d, t.id, { name: "Secret kit", details: "whitening too", active: false }, PNG, "x");
    const en = await findItems(d, t, { query: "do you have whitening?", language: "en" }, ORIGIN);
    expect(en.found).toBe(true);
    expect(en.items).toHaveLength(1); // the hidden one is not offered
    expect(en.items[0]).toMatchObject({ name: "Whitening kit", details: "Home whitening", price: "BHD 25" });
    expect(en.items[0].image_url).toBe(`${ORIGIN}/api/items/${t.slug}/${kit.id}/image?v=${Date.parse(kit.updatedAt)}`);
    const ar = await findItems(d, t, { query: "تبييض", language: "ar" }, ORIGIN);
    expect(ar.items[0]).toMatchObject({ name: "طقم تبييض", details: "تبييض منزلي" });
    const none = await findItems(d, t, { query: "parking", language: "en" }, ORIGIN);
    expect(none).toMatchObject({ found: false, items: [] });
    // an item without a photo has no image_url
    await saveItemByStaff(d, t.id, { name: "Checkup", details: "Yearly checkup", active: true }, undefined, "x");
    const plain = await findItems(d, t, { query: "checkup" }, ORIGIN);
    expect(plain.items[0].image_url).toBeUndefined();
  });

  it("find_item with no query lists what the clinic offers, photos first, never hidden items", async () => {
    const d = await backend(kind);
    const t = await clinic(d, "Cat List");
    expect(await findItems(d, t, { query: "" }, ORIGIN)).toMatchObject({ found: false, items: [] });
    await saveItemByStaff(d, t.id, { name: "Plain checkup", details: "No photo", active: true }, undefined, "x");
    const kit = await saveItemByStaff(d, t.id, { name: "Whitening kit", details: "Photo one", active: true }, PNG, "x");
    await saveItemByStaff(d, t.id, { name: "Hidden", details: "x", active: false }, PNG, "x");
    const all = await findItems(d, t, { query: "   " }, ORIGIN);
    expect(all.found).toBe(true);
    expect(all.items.map((i) => i.name)).toEqual(["Whitening kit", "Plain checkup"]);
    expect(all.items[0].item_id).toBe(kit.id);
    for (let n = 0; n < 8; n++) await saveItemByStaff(d, t.id, { name: `Extra ${n}`, active: true }, PNG, "x");
    expect((await findItems(d, t, { query: "" }, ORIGIN)).items).toHaveLength(5);
  });

  it("find_item finds a doctor by name, with the photo only when one was added, and ignores the title", async () => {
    const d = await backend(kind);
    const t = await clinic(d, "Cat Doctors");
    const aqeel = await d.addDoctor(t.id, { name: "Dr Aqeel", specialty: "Dentist" }, "x");
    const hana = await d.addDoctor(t.id, { name: "Dr Hana", specialty: "Dermatology" }, "x");
    await d.setDoctorImage(t.id, aqeel.id, PNG, "x");
    const withPhoto = await findItems(d, t, { query: "Dr Aqeel photo" }, ORIGIN);
    expect(withPhoto.found).toBe(true);
    expect(withPhoto.items).toHaveLength(1);
    const live = (await d.getDoctors(t.id)).find((x) => x.id === aqeel.id)!;
    expect(withPhoto.items[0]).toMatchObject({ item_id: aqeel.id, kind: "doctor", name: "Dr Aqeel", details: "Dentist" });
    expect(withPhoto.items[0].image_url).toBe(`${ORIGIN}/api/items/${t.slug}/${aqeel.id}/image?v=${Date.parse(live.photoAt!)}`);
    const noPhoto = await findItems(d, t, { query: "doctor Hana" }, ORIGIN);
    expect(noPhoto.items).toHaveLength(1);
    expect(noPhoto.items[0]).toMatchObject({ item_id: hana.id, kind: "doctor" });
    expect(noPhoto.items[0].image_url).toBeUndefined();
    expect((await findItems(d, t, { query: "dentist" }, ORIGIN)).items[0].item_id).toBe(aqeel.id);
    expect(await findItems(d, t, { query: "Dr" }, ORIGIN)).toMatchObject({ found: false });
    await d.updateDoctor(t.id, aqeel.id, { active: false }, "x");
    expect(await findItems(d, t, { query: "Dr Aqeel" }, ORIGIN)).toMatchObject({ found: false });
  });

  it("is erased with the client", async () => {
    const d = await backend(kind);
    const t = await clinic(d, "Cat Gone");
    const item = await saveItemByStaff(d, t.id, { name: "Gone", active: true }, PNG, "x");
    await d.deleteTenant(t.id, "x");
    made.splice(made.indexOf(t.id), 1);
    expect(await d.getItem(t.id, item.id)).toBeUndefined();
    expect(await d.getItemImage(t.id, item.id)).toBeUndefined();
  });
});

describe("catalogue and the assistant", () => {
  it("tells the assistant to look items up and to show a photo only in the website chat", async () => {
    const { buildPrompt } = await import("@/lib/agent-config");
    const { agent } = await import("@/lib/seed");
    const p = buildPrompt(agent("", "Clinic"));
    expect(p).toContain("call find_item");
    expect(p).toMatch(/Channel: website\), call show_image/);
    expect(p).toContain("Only the website chat can use show_image");
  });

  it("tells the assistant to call find_item before saying it has no photos, and for a doctor's photo", async () => {
    const { buildPrompt, toolDefinitions } = await import("@/lib/agent-config");
    const { agent } = await import("@/lib/seed");
    const p = buildPrompt(agent("", "Clinic"));
    expect(p).toContain("with an empty query");
    expect(p).toContain("Never say you have no photos before you have called find_item");
    expect(p).toContain("photo or picture of a doctor");
    const withPhoto = buildPrompt(agent("", "Clinic"), [{ id: "d1", name: "Dr Aqeel", specialty: "Dentist", active: true, photoAt: "2026-10-29T00:00:00Z" }, { id: "d2", name: "Dr Hana", specialty: "", active: true }]);
    expect(withPhoto).toContain("Dr Aqeel, Dentist (doctor_id: d1) [has a photo]");
    expect(withPhoto).toContain("- Dr Hana (doctor_id: d2)\n");
    expect(withPhoto).toContain("the first time in a conversation that a doctor marked [has a photo]");
    expect(withPhoto).toContain("put the page_url link from find_item in your reply instead");
    const tool = toolDefinitions("https://x.example", "s").find_item as { api_schema: { request_body_schema: { required?: string[] } } };
    expect(tool.api_schema.request_body_schema.required ?? []).not.toContain("query");
  });

  it("the widget draws only pictures served by CallsDash for a catalogue item", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(`${__dirname}/../public/widget.js`, "utf8");
    expect(src).toContain("elevenlabs-convai:call");
    expect(src).toContain("show_image");
    expect(src).toContain("u.origin === base");
    expect(src).toContain("api\\/items");
  });
});

describe.each(["demo", "postgres"] as const)("WhatsApp photos (%s)", (kind) => {
  const made: string[] = [];
  afterEach(async () => {
    if (kind !== "demo") return;
    const data = await createDemoData();
    for (const id of made.splice(0)) await data.deleteTenant(id, "x");
  });
  const ok = () => Promise.resolve(new Response("{}", { status: 200 }));
  let seq = 0;

  async function setup(d: Data, o: { token?: boolean; phoneId?: boolean; image?: string | null } = {}) {
    const n = ++seq;
    const t = await d.createTenant({ name: `Photo Clinic ${n}`, nameAr: "", color: "#112233", domain: `photoclinic${n}.example.bh`, planType: "package", plan: { ...PLAN_PRESETS.clinic }, actor: "x" });
    made.push(t.id);
    if (o.phoneId !== false) await d.setIntegrations(t.id, { whatsapp: { phoneNumberId: "1055550001" } }, "x", "test");
    if (o.token !== false) await d.setSecrets(t.id, { whatsappToken: "EAAB-test-token-1234567890" });
    const item = await saveItemByStaff(d, t.id, { name: "Whitening kit", nameAr: "طقم تبييض", price: "BHD 25", active: true }, o.image === undefined ? PNG : o.image, "x");
    return { t: (await d.getTenant(t.id))!, item };
  }

  it("sends the photo with the clinic's own token to the person in the chat", async () => {
    const d = await backend(kind);
    const { t, item } = await setup(d);
    const calls: { url: string; init: RequestInit }[] = [];
    const r = await sendItemPhoto(d, t.id, { itemId: item.id, to: "+973 3600 1122", language: "en" }, ORIGIN, (url, init) => { calls.push({ url, init: init! }); return ok(); });
    expect(r).toEqual({ status: "sent" });
    expect(calls[0].url).toBe("https://graph.facebook.com/v21.0/1055550001/messages");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer EAAB-test-token-1234567890");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ messaging_product: "whatsapp", to: "97336001122", type: "image" });
    expect(body.image.link).toBe(`${ORIGIN}/api/items/${t.slug}/${item.id}/image?v=${Date.parse(item.updatedAt)}`);
    expect(body.image.caption).toBe("Whitening kit - BHD 25");
  });

  it("sends a doctor's photo the same way, and skips a doctor with no photo or one who is not active", async () => {
    const d = await backend(kind);
    const { t } = await setup(d);
    const doc = await d.addDoctor(t.id, { name: "Dr Aqeel", specialty: "Dentist" }, "x");
    const fetchNever = () => { throw new Error("must not call Meta"); };
    expect(await sendItemPhoto(d, t.id, { itemId: doc.id, to: "36001122" }, ORIGIN, fetchNever)).toEqual({ status: "skipped", reason: "no_photo" });
    await d.setDoctorImage(t.id, doc.id, PNG, "x");
    const calls: { init: RequestInit }[] = [];
    expect(await sendItemPhoto(d, t.id, { itemId: doc.id, to: "36001122" }, ORIGIN, (_u, init) => { calls.push({ init: init! }); return ok(); })).toEqual({ status: "sent" });
    const body = JSON.parse(String(calls[0].init.body));
    const live = (await d.getDoctors(t.id))[0];
    expect(body.image.link).toBe(`${ORIGIN}/api/items/${t.slug}/${doc.id}/image?v=${Date.parse(live.photoAt!)}`);
    expect(body.image.caption).toBe("Dr Aqeel");
    await d.updateDoctor(t.id, doc.id, { active: false }, "x");
    expect(await sendItemPhoto(d, t.id, { itemId: doc.id, to: "36001122" }, ORIGIN, fetchNever)).toEqual({ status: "skipped", reason: "no_item" });
  });

  it("captions in Arabic when the customer writes Arabic", () => {
    expect(photoCaption({ name: "Kit", nameAr: "طقم", price: "BHD 5" }, "ar")).toBe("طقم - BHD 5");
    expect(photoCaption({ name: "Kit" }, "ar")).toBe("Kit");
  });

  it("does nothing, and says why, when something is missing", async () => {
    const d = await backend(kind);
    const noToken = await setup(d, { token: false });
    const fetchNever = () => { throw new Error("must not call Meta"); };
    expect(await sendItemPhoto(d, noToken.t.id, { itemId: noToken.item.id, to: "36001122" }, ORIGIN, fetchNever)).toEqual({ status: "skipped", reason: "no_token" });
    const full = await setup(d);
    expect(await sendItemPhoto(d, full.t.id, { itemId: full.item.id, to: "" }, ORIGIN, fetchNever)).toEqual({ status: "skipped", reason: "no_recipient" });
    expect(await sendItemPhoto(d, full.t.id, { itemId: "nope", to: "36001122" }, ORIGIN, fetchNever)).toEqual({ status: "skipped", reason: "no_item" });
    const noPhoto = await setup(d, { image: null });
    expect(await sendItemPhoto(d, noPhoto.t.id, { itemId: noPhoto.item.id, to: "36001122" }, ORIGIN, fetchNever)).toEqual({ status: "skipped", reason: "no_photo" });
    // WhatsApp shows jpeg and png only
    const webp = await setup(d, { image: "data:image/webp;base64,UklGRg==" });
    expect(await sendItemPhoto(d, webp.t.id, { itemId: webp.item.id, to: "36001122" }, ORIGIN, fetchNever)).toEqual({ status: "skipped", reason: "format" });
    // a hidden item is never sent
    await saveItemByStaff(d, full.t.id, { id: full.item.id, name: "Whitening kit", active: false }, undefined, "x");
    expect(await sendItemPhoto(d, full.t.id, { itemId: full.item.id, to: "36001122" }, ORIGIN, fetchNever)).toEqual({ status: "skipped", reason: "no_item" });
  });

  it("reports Meta's refusal in plain terms and never throws", async () => {
    const d = await backend(kind);
    const { t, item } = await setup(d);
    const refuse = () => Promise.resolve(new Response(JSON.stringify({ error: { message: "Message failed to send because more than 24 hours have passed", code: 131047 } }), { status: 400 }));
    const r = await sendItemPhoto(d, t.id, { itemId: item.id, to: "36001122" }, ORIGIN, refuse);
    expect(r.status).toBe("failed");
    expect(r.status === "failed" && r.error).toContain("131047");
    expect(photoFailureHint(r.status === "failed" ? r.error : "")).toBe("window");
    const boom = () => Promise.reject(new Error("network down"));
    expect(await sendItemPhoto(d, t.id, { itemId: item.id, to: "36001122" }, ORIGIN, boom)).toMatchObject({ status: "failed", error: "network down" });
  });
});

describe("photo failure hints", () => {
  it("recognises an expired token and missing permission", () => {
    expect(photoFailureHint("(#190) Error validating access token: Session has expired")).toBe("token");
    expect(photoFailureHint("(#10) Application does not have permission for this action")).toBe("permission");
    expect(photoFailureHint("something else")).toBeNull();
  });
  it("find_item gives a link to a public page for chats that cannot show a picture", async () => {
    const d = await createDemoData();
    const t = await d.createTenant({ name: "Link Clinic", nameAr: "", color: "#112233", domain: "linkclinic.example.bh", planType: "package", plan: { ...PLAN_PRESETS.clinic }, actor: "x" });
    try {
      const item = await saveItemByStaff(d, t.id, { name: "Checkup", details: "Yearly", active: true }, undefined, "x");
      const r = await findItems(d, t, { query: "checkup", language: "ar" }, ORIGIN);
      expect(r.items[0].page_url).toBe(`${ORIGIN}/i/${t.slug}/${item.id}?lang=ar`);
    } finally { await d.deleteTenant(t.id, "x"); }
  });
  it("tells the assistant: send_item_photo on WhatsApp, a link on Instagram, nothing read aloud on a call", async () => {
    const { buildPrompt } = await import("@/lib/agent-config");
    const { agent } = await import("@/lib/seed");
    const p = buildPrompt(agent("", "Clinic"));
    expect(p).toContain("call send_item_photo with its item_id");
    expect(p).toContain("On Instagram");
    expect(p).toContain("never read out a link");
  });
});
