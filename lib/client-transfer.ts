/**
 * Import/Export of one client's settings (2026-11-02, admin Clients screen). The admin ticks what goes into a JSON file;
 * the same file can later be applied to this client or another one, again choosing what to apply.
 *
 * Never in the file: secrets and tokens, the ElevenLabs agent id, Google calendar ids, WhatsApp/Instagram/phone account ids,
 * credits, bookings, conversations and recordings. Sign-ins are listed (name, email, role) but never created by an import:
 * a sign-in needs a password, made on the Users page. Customers are personal data, so they are off unless ticked.
 *
 * An import runs in small steps (lib/client-transfer-run.ts drives them from the browser), so a file with many photos never
 * hits a request size limit: first the settings in one step, then each list in chunks.
 */
import type { Data } from "./data/demo";
import type { AgentSettings, Customer, DataField, Doctor, Item, Locale, Tenant } from "./types";
import { SECTIONS as STUDIO_SECTIONS, SECTION_KEYS, studioOf, type SectionId } from "./agent-studio";
import { businessOf, departmentsOf, isBusinessType, rolesOf } from "./business-types";
import { readServices, servicesKey, type Service } from "./services";
import { readSuite, testsKey } from "./agent-tests";
import { accessKey, readAccess } from "./access";
import { renamer } from "./client-copy";
import {
  AGENT_PARTS, FORMAT, FORMAT_VERSION, PARTS, PART_GROUPS, PHOTO_PARTS, fromNames, isArabic, isPart, type ExportFile, type ListPart, type PartId,
} from "./client-transfer-parts";

export * from "./client-transfer-parts";

const LOOK_KEYS = ["primaryColor", "accentColor", "pattern", "sidebar", "radius", "font", "hidePoweredBy", "welcome", "welcomeAr", "tagline", "taglineAr", "reportFooter"] as const;
const CONTACT_KEYS = ["supportPhone", "supportEmail", "supportWhatsapp"] as const;
const WA_CONTACT_KEYS = ["address", "addressAr", "mapUrl", "phone"] as const;
const WA_MESSAGE_KEYS = ["confirmTemplate", "confirmTemplateLang", "confirmWording", "templateLangs", "confirmations"] as const;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, max = 4000) => (typeof v === "string" ? v.slice(0, max) : "");
const pick = <T extends Obj>(o: T, keys: readonly string[]): Obj => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, structuredClone(o[k])]));
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const strRecord = (v: unknown): Record<string, string> | undefined => {
  const o = obj(v), out: Record<string, string> = {};
  for (const [k, x] of Object.entries(o)) if (typeof x === "string" && /^[\w.-]{1,60}$/.test(k)) out[k] = x.slice(0, 2000);
  return Object.keys(out).length ? out : undefined;
};
const isPhoto = (v: unknown): v is string => typeof v === "string" && /^data:image\/(png|jpe?g|webp|gif);base64,/.test(v) && v.length < 1_500_000;
const hoursOf = (v: unknown): Record<string, [string, string][]> | undefined => {
  const o = obj(v);
  if (!Object.keys(o).length) return undefined;
  const out: Record<string, [string, string][]> = {};
  for (const d of ["0", "1", "2", "3", "4", "5", "6"]) {
    out[d] = arr(o[d]).filter((x): x is [string, string] => Array.isArray(x) && x.length === 2 && x.every((t) => typeof t === "string" && /^\d{2}:\d{2}$/.test(t)));
  }
  return out;
};

/* ---------------------------------------------------------------- export */

export type ExportDeps = Pick<Data, "getAgent" | "getKnowledge" | "getDoctors" | "getDoctorImage" | "getItems" | "getItemImage" | "getDataTables" | "getDataRows" | "getCustomers" | "getSetting" | "listProfiles">;

/** The file for the ticked parts. `photos` adds catalogue and team photos (much bigger file). */
export interface LiveRead {
  /** CallsDash's settings with what the agent holds in ElevenLabs read into them (lib/studio-import.ts), when that worked. */
  agent?: AgentSettings;
  realtime?: { path: string[]; model: string | null };
  /** Why ElevenLabs could not be read; the file then carries CallsDash's own copy. */
  error?: string;
}

export async function buildClientExport(d: ExportDeps, tenant: Tenant, parts: PartId[], photos: boolean, at: string, live?: LiveRead): Promise<ExportFile> {
  const want = new Set(parts);
  const has = (p: PartId) => want.has(p);
  const out: ExportFile["parts"] = {};
  const agent: AgentSettings | undefined = live?.agent ?? await d.getAgent(tenant.id);
  if (has("voiceMode") && live?.realtime) out.voiceMode = { model: live.realtime.model, path: live.realtime.path };
  if (agent) {
    const st = studioOf(agent) as unknown as Obj;
    if (has("instructions")) out.instructions = { prompt: structuredClone(agent.prompt), replyLength: agent.replyLength, formality: agent.formality, arabicWrittenStyle: agent.arabicWrittenStyle, customerLookup: agent.customerLookup };
    if (has("voices")) out.voices = { voiceEn: agent.voiceEn, voiceAr: agent.voiceAr, offeredVoices: structuredClone(st.offeredVoices), voiceNotes: structuredClone(st.voiceNotes) };
    for (const s of STUDIO_SECTIONS) {
      if (!has(`studio.${s}` as PartId)) continue;
      out[`studio.${s}` as PartId] = { ...pick(st, SECTION_KEYS[s]), ...(s === "model" ? { temperature: agent.temperature } : {}), saved: studioOf(agent).touched.includes(s) };
    }
  }
  if (has("tests")) out.tests = readSuite(await d.getSetting(testsKey(tenant.id))).tests.map(({ id: _i, createdAt: _c, ...t }) => (void _i, void _c, t));
  if (has("knowledge")) out.knowledge = (await d.getKnowledge(tenant.id)).map((k) => ({ question: k.question, answer: k.answer, language: k.language }));
  if (has("services")) out.services = readServices(await d.getSetting(servicesKey(tenant.id))).map(({ id: _i, ...s }) => (void _i, s));
  const withPhotos = photos;
  if (has("catalogue")) {
    out.catalogue = await Promise.all((await d.getItems(tenant.id)).map(async (i: Item) => ({
      name: i.name, nameAr: i.nameAr, details: i.details, detailsAr: i.detailsAr, price: i.price, keywords: i.keywords, active: i.active,
      ...(withPhotos && i.hasImage ? { photo: await d.getItemImage(tenant.id, i.id) } : {}),
    })));
  }
  if (has("tables")) {
    out.tables = await Promise.all((await d.getDataTables(tenant.id)).map(async (t) => ({
      name: t.name, nameAr: t.nameAr, fields: structuredClone(t.fields), clientEdit: t.clientEdit, assistant: t.assistant,
      rows: (await d.getDataRows(tenant.id, t.id)).map((r) => ({ ...r.values })),
    })));
  }
  if (has("business")) out.business = structuredClone(businessOf(tenant));
  if (has("team")) {
    const roles = rolesOf(tenant), depts = departmentsOf(tenant);
    out.team = await Promise.all((await d.getDoctors(tenant.id)).map(async (x: Doctor) => ({
      name: x.name, specialty: x.specialty, about: x.about, aboutAr: x.aboutAr, color: x.color, active: x.active !== false,
      role: x.role, roleName: roles.find((r) => r.key === (x.role ?? roles[0]?.key))?.one, department: x.department,
      departmentName: depts.find((dp) => dp.key === x.department)?.en, extra: x.extra, hours: x.hours ?? undefined,
      ...(withPhotos && x.photoAt ? { photo: await d.getDoctorImage(tenant.id, x.id) } : {}),
    })));
  }
  if (has("hours")) out.hours = { openingHours: structuredClone(tenant.openingHours), closures: structuredClone(tenant.closures ?? []) };
  if (has("branding")) out.branding = pick(tenant.branding as unknown as Obj, LOOK_KEYS);
  if (has("brandingImages")) out.brandingImages = pick(tenant.branding as unknown as Obj, ["logoUrl", "coverUrl"]);
  if (has("contacts")) out.contacts = { ...pick(tenant.branding as unknown as Obj, CONTACT_KEYS), whatsapp: pick(obj(tenant.integrations.whatsapp), WA_CONTACT_KEYS) };
  if (has("messages")) out.messages = pick(obj(tenant.integrations.whatsapp), WA_MESSAGE_KEYS);
  if (has("rules")) {
    out.rules = {
      alertRules: structuredClone(tenant.alertRules), permissions: { ...tenant.permissions }, retentionDays: tenant.retentionDays,
      lowBalanceThreshold: tenant.lowBalanceThreshold, zeroBalancePolicy: tenant.zeroBalancePolicy,
      receptionistAccess: readAccess(await d.getSetting(accessKey(tenant.id))).receptionist,
    };
  }
  if (has("signins")) out.signins = (await d.listProfiles(tenant.id)).map((p) => ({ fullName: p.fullName, email: p.email, role: p.role, disabled: !!p.disabled }));
  if (has("customers")) {
    out.customers = (await d.getCustomers(tenant.id)).map((c: Customer) => ({ name: c.name, phone: c.phone, cpr: c.cpr, email: c.email, language: c.language, notes: c.notes, extra: c.extra }));
  }
  return {
    format: FORMAT, version: FORMAT_VERSION, exportedAt: at,
    from: { id: tenant.id, name: tenant.name, nameAr: tenant.branding.displayNameAr, displayName: tenant.branding.displayName },
    photos: withPhotos ? { catalogue: has("catalogue"), team: has("team") } : {},
    parts: out,
    assistantFrom: live?.agent ? "live" : "stored",
    ...(live?.error ? { liveError: live.error.slice(0, 400) } : {}),
  };
}

/* ---------------------------------------------------------------- import */

export interface ImportOptions {
  /** "replace": knowledge, services, catalogue and table rows become exactly the file's; people not in the file are archived. Never deletes customers. */
  mode: "merge" | "replace";
  /** Replace the other client's name with this client's name in texts. Only when the file came from another client. */
  rename: boolean;
  /** Apply the photos in the file. */
  photos: boolean;
  from: ExportFile["from"];
  /** The names to replace (the admin can edit the list on the import screen); missing = the file's own names. */
  oldNames?: string[];
  /** This client's names to put in their place; missing = its display names. */
  newName?: string;
  newNameAr?: string;
}

export type ImportDeps = Pick<Data,
  "getTenant" | "getAgent" | "saveAgent" | "setBusiness" | "setOpeningHours" | "updateTenant" | "setIntegrations" | "setAlertRules" | "setPermissions"
  | "getSetting" | "setSetting" | "getKnowledge" | "addKnowledge" | "updateKnowledge" | "deleteKnowledge" | "getDoctors" | "addDoctor" | "updateDoctor"
  | "setDoctorImage" | "getItems" | "putItem" | "deleteItem" | "getDataTables" | "putDataTable" | "getDataRows" | "putDataRows" | "deleteDataRows"
  | "getCustomers" | "putCustomer" | "audit">;

/**
 * Replaces the other client's names with this client's names in every text that is imported (instructions, greetings, knowledge,
 * services, catalogue, tables, look and wording...). English names become the English name, Arabic ones the Arabic name.
 */
export function importRenamer(tenant: Tenant, o: ImportOptions) {
  const off = !o.rename;
  const old = (o.oldNames?.length ? o.oldNames : fromNames({ from: o.from })).map((x) => x.trim()).filter(Boolean).slice(0, 20);
  const rn = renamer(
    { names: old.filter((x) => !isArabic(x)), namesAr: old.filter(isArabic) },
    { name: o.newName?.trim() || tenant.branding.displayName || tenant.name, nameAr: o.newNameAr?.trim() || tenant.branding.displayNameAr || o.newName?.trim() || tenant.branding.displayName },
  );
  return { deep: <T,>(v: T): T => (off ? v : rn.deep(v)), text: (s: string) => (off ? s : rn.text(s)), count: () => (off ? 0 : rn.count()) };
}

/** Applies the settings parts (everything that is not a list) in one go. Returns the names of what was applied. */
export async function applySettings(d: ImportDeps, tenantId: string, parts: Partial<Record<PartId, unknown>>, o: ImportOptions, actor: string): Promise<{ done: PartId[]; renamed: number }> {
  let tenant = await d.getTenant(tenantId);
  if (!tenant) throw new Error("unknown client");
  const rn = importRenamer(tenant, o);
  const done: PartId[] = [];
  const got = (p: PartId) => parts[p] !== undefined && parts[p] !== null;

  // the business first: the team's roles and departments refer to it
  if (got("business")) {
    const b = obj(parts.business);
    if (isBusinessType(b.type)) {
      const keep = ["type", "staffScheduling", "words", "roles", "id", "fields", "kind", "departments"];
      await d.setBusiness(tenantId, structuredClone(pick(b, keep)) as unknown as NonNullable<Tenant["business"]>, actor, "Business profile imported from a file");
      done.push("business");
    }
  }

  // the assistant: one saved version for everything imported
  const agentParts = PART_GROUPS.assistant.filter((p) => p !== "tests" && !AGENT_PARTS.includes(p) && got(p));
  if (agentParts.length) {
    const cur = await d.getAgent(tenantId);
    if (cur) {
      const next: AgentSettings = structuredClone(cur);
      const studio = studioOf(cur) as unknown as Obj;
      const touched = new Set<SectionId>(studioOf(cur).touched);
      if (got("instructions")) {
        const x = rn.deep(obj(parts.instructions));
        const p = obj(x.prompt);
        for (const k of ["identity", "languages", "mayDo", "neverDo", "emergencies", "handoff"] as const) if (typeof p[k] === "string") next.prompt[k] = str(p[k], 20000);
        if (["short", "normal", "detailed"].includes(x.replyLength as string)) next.replyLength = x.replyLength as AgentSettings["replyLength"];
        if (["casual", "polite", "formal"].includes(x.formality as string)) next.formality = x.formality as AgentSettings["formality"];
        if (typeof x.arabicWrittenStyle === "string") next.arabicWrittenStyle = x.arabicWrittenStyle as AgentSettings["arabicWrittenStyle"];
        if (x.customerLookup === "phone" || x.customerLookup === "cpr") next.customerLookup = x.customerLookup;
      }
      if (got("voices")) {
        const x = obj(parts.voices);
        if (typeof x.voiceEn === "string" && x.voiceEn) next.voiceEn = x.voiceEn.slice(0, 80);
        if (typeof x.voiceAr === "string" && x.voiceAr) next.voiceAr = x.voiceAr.slice(0, 80);
        if (Array.isArray(x.offeredVoices)) studio.offeredVoices = structuredClone(x.offeredVoices);
        if (x.voiceNotes && typeof x.voiceNotes === "object") studio.voiceNotes = structuredClone(x.voiceNotes);
      }
      for (const s of STUDIO_SECTIONS) {
        const id = `studio.${s}` as PartId;
        if (!got(id)) continue;
        const x = rn.deep(obj(parts[id]));
        for (const k of SECTION_KEYS[s]) if (x[k] !== undefined) studio[k] = structuredClone(x[k]);
        if (s === "model" && typeof x.temperature === "number") next.temperature = Math.min(1, Math.max(0, x.temperature));
        // an imported section counts as saved, so every one of its options reaches ElevenLabs at the next update
        touched.add(s);
      }
      // the studio's own reader drops anything out of range
      next.studio = studioOf({ studio: { ...studio, touched: [...touched] } as AgentSettings["studio"] });
      await d.saveAgent(tenantId, next, actor, `Imported from a file: ${agentParts.join(", ")}`.slice(0, 480));
      done.push(...agentParts);
    }
  }
  if (got("tests")) {
    const cur = readSuite(await d.getSetting(testsKey(tenantId)));
    const incoming = readSuite({ tests: arr(rn.deep(parts.tests)).map((t, i) => ({ ...obj(t), id: `t_imp${Date.now().toString(36)}${i}`, createdAt: new Date().toISOString() })) }).tests;
    const base = o.mode === "replace" ? [] : cur.tests;
    const tests = [...base, ...incoming.filter((t) => !base.some((b) => same(b.name, t.name)))].slice(0, 30);
    await d.setSetting(testsKey(tenantId), { tests, ...(cur.lastRun ? { lastRun: cur.lastRun } : {}) });
    done.push("tests");
  }

  if (got("hours")) {
    const x = obj(parts.hours);
    const hours = hoursOf(x.openingHours);
    if (hours) await d.setOpeningHours(tenantId, hours, actor);
    const closures = arr(x.closures).map(obj).filter((c) => typeof c.from === "string" && typeof c.to === "string").map((c) => ({ ...c })) as unknown as NonNullable<Tenant["closures"]>;
    await d.updateTenant(tenantId, { closures }, actor);
    done.push("hours");
  }
  const branding: Obj = {};
  if (got("branding")) { Object.assign(branding, rn.deep(pick(obj(parts.branding), LOOK_KEYS))); done.push("branding"); }
  if (got("brandingImages")) {
    const x = obj(parts.brandingImages);
    for (const k of ["logoUrl", "coverUrl"]) if (typeof x[k] === "string" && (isPhoto(x[k]) || /^https:\/\//.test(x[k] as string))) branding[k] = x[k];
    done.push("brandingImages");
  }
  if (got("contacts")) Object.assign(branding, pick(obj(parts.contacts), CONTACT_KEYS));
  if (Object.keys(branding).length) await d.updateTenant(tenantId, { branding: branding as Partial<Tenant["branding"]> }, actor);

  if (got("contacts") || got("messages")) {
    tenant = (await d.getTenant(tenantId))!;
    const wa = {
      ...(tenant.integrations.whatsapp ?? {}),
      ...(got("contacts") ? pick(obj(obj(parts.contacts).whatsapp), WA_CONTACT_KEYS) : {}),
      ...(got("messages") ? pick(obj(parts.messages), WA_MESSAGE_KEYS) : {}),
    };
    await d.setIntegrations(tenantId, { ...tenant.integrations, whatsapp: wa }, actor, "WhatsApp message settings imported from a file");
    if (got("contacts")) done.push("contacts");
    if (got("messages")) done.push("messages");
  }

  if (got("rules")) {
    const x = obj(parts.rules);
    if (x.alertRules && typeof x.alertRules === "object") await d.setAlertRules(tenantId, structuredClone(x.alertRules) as Tenant["alertRules"], actor);
    const p = obj(x.permissions);
    if (Object.keys(p).length) {
      const flag = (k: string, dflt: boolean) => (typeof p[k] === "boolean" ? (p[k] as boolean) : dflt);
      const t = (await d.getTenant(tenantId))!;
      await d.setPermissions(tenantId, {
        editPrompt: flag("editPrompt", t.permissions.editPrompt), editVoice: flag("editVoice", t.permissions.editVoice), editBehaviour: flag("editBehaviour", t.permissions.editBehaviour),
        editKnowledge: flag("editKnowledge", t.permissions.editKnowledge), ...(typeof p.dataManager === "boolean" ? { dataManager: p.dataManager } : {}),
      }, actor);
    }
    const patch: Parameters<Data["updateTenant"]>[1] = {};
    if (typeof x.retentionDays === "number" && x.retentionDays >= 1 && x.retentionDays <= 3650) patch.retentionDays = Math.round(x.retentionDays);
    if (typeof x.lowBalanceThreshold === "number" && x.lowBalanceThreshold >= 0 && x.lowBalanceThreshold <= 1) patch.lowBalanceThreshold = x.lowBalanceThreshold;
    if (x.zeroBalancePolicy === "pause" || x.zeroBalancePolicy === "overdraft") patch.zeroBalancePolicy = x.zeroBalancePolicy as Tenant["zeroBalancePolicy"];
    if (Object.keys(patch).length) await d.updateTenant(tenantId, patch, actor);
    if (x.receptionistAccess !== undefined) {
      const cur = readAccess(await d.getSetting(accessKey(tenantId)));
      const r = readAccess({ receptionist: x.receptionistAccess }).receptionist;
      await d.setSetting(accessKey(tenantId), { ...cur, ...(r ? { receptionist: r } : {}) });
    }
    done.push("rules");
  }
  if (done.length) await d.audit(actor, `Imported from a file (${o.from.name || "unknown client"}): ${done.join(", ")}`.slice(0, 480), tenantId);
  return { done, renamed: rn.count() };
}

export interface ListResult { added: number; updated: number; removed: number; skipped: number; renamed: number }

/**
 * Applies one chunk of a list. `keep` (first chunk only, replace mode) is every name in the file's list: what this client has
 * beyond it is removed (people are archived instead, customers are never removed).
 */
export async function applyList(d: ImportDeps, tenantId: string, part: ListPart, entries: unknown[], o: ImportOptions, actor: string, keep?: string[]): Promise<ListResult> {
  const tenant = await d.getTenant(tenantId);
  if (!tenant) throw new Error("unknown client");
  const rn = importRenamer(tenant, o);
  const r: ListResult = { added: 0, updated: 0, removed: 0, skipped: 0, renamed: 0 };
  // every text of the entries gets this client's name (photos are left as they are; customers are people, not texts about the business)
  const list = entries.map(obj).map((e) => {
    if (part === "customers") return e;
    const { photo, ...rest } = e;
    return { ...rn.deep(rest), ...(photo !== undefined ? { photo } : {}) };
  });
  const clear = o.mode === "replace" && Array.isArray(keep);
  const kept = (name: string) => (keep ?? []).some((k) => typeof k === "string" && same(k, name));

  if (part === "knowledge") {
    let have = await d.getKnowledge(tenantId);
    if (clear) for (const k of have.filter((k) => !kept(k.question))) { await d.deleteKnowledge(tenantId, k.id, actor); r.removed++; }
    if (clear) have = await d.getKnowledge(tenantId);
    for (const e of list) {
      const question = str(e.question, 1000).trim(), answer = str(e.answer, 8000).trim();
      const language: Locale = e.language === "ar" ? "ar" : "en";
      if (!question || !answer) { r.skipped++; continue; }
      const old = have.find((k) => same(k.question, question));
      if (old) { await d.updateKnowledge(tenantId, old.id, { question, answer, language }, actor); r.updated++; }
      else { await d.addKnowledge(tenantId, question, answer, language, actor); r.added++; }
    }
  } else if (part === "services") {
    const have = clear ? [] : readServices(await d.getSetting(servicesKey(tenantId)));
    const next: Service[] = [...have];
    let n = 0;
    for (const e of readServices(list.map((x, i) => ({ ...x, id: `svc_imp${i}` })))) {
      const at = next.findIndex((s) => same(s.name, e.name));
      if (at >= 0) { next[at] = { ...e, id: next[at].id }; r.updated++; }
      else { next.push({ ...e, id: `svc_${Date.now().toString(36)}${(n++).toString(36)}` }); r.added++; }
    }
    if (clear) r.removed = Math.max(0, readServices(await d.getSetting(servicesKey(tenantId))).length - next.length);
    await d.setSetting(servicesKey(tenantId), readServices(next));
  } else if (part === "catalogue") {
    const have = await d.getItems(tenantId);
    if (clear) for (const i of have.filter((i) => !kept(i.name))) { await d.deleteItem(tenantId, i.id, actor); r.removed++; }
    for (const e of list) {
      const name = str(e.name, 200).trim();
      if (!name) { r.skipped++; continue; }
      const old = have.find((i) => same(i.name, name));
      const photo = o.photos && isPhoto(e.photo) ? e.photo : undefined;
      await d.putItem(tenantId, {
        ...(old ? { id: old.id } : {}), name, nameAr: str(e.nameAr, 200) || undefined, details: str(e.details, 4000), detailsAr: str(e.detailsAr, 4000) || undefined,
        price: str(e.price, 60) || undefined, keywords: str(e.keywords, 500), active: e.active !== false, createdAt: old?.createdAt ?? new Date().toISOString(),
      }, photo, actor);
      if (old) r.updated++; else r.added++;
    }
  } else if (part === "tables") {
    const tables = await d.getDataTables(tenantId);
    for (const e of list) {
      const name = str(e.name, 120).trim();
      const fields = arr(e.fields).map(obj).filter((f) => typeof f.key === "string" && typeof f.label === "string") as unknown as DataField[];
      if (!name || !fields.length) { r.skipped++; continue; }
      const old = tables.find((t) => same(t.name, name));
      const saved = await d.putDataTable(tenantId, { ...(old ? { id: old.id } : {}), name, nameAr: str(e.nameAr, 120) || undefined, fields, clientEdit: e.clientEdit === true, assistant: e.assistant !== false }, actor);
      const first = fields[0].key;
      const rows = arr(e.rows).map((x) => strRecord(x) ?? {}).filter((v) => Object.keys(v).length);
      const have = old ? await d.getDataRows(tenantId, saved.id) : [];
      if (o.mode === "replace" && have.length) { r.removed += await d.deleteDataRows(tenantId, saved.id, have.map((x) => x.id), actor); }
      const current = o.mode === "replace" ? [] : have;
      await d.putDataRows(tenantId, saved.id, rows.map((values) => {
        const match = values[first] ? current.find((x) => same(x.values[first] ?? "", values[first])) : undefined;
        return { ...(match ? { id: match.id } : {}), values };
      }), actor);
      if (old) r.updated++; else r.added++;
    }
  } else if (part === "team") {
    const roles = rolesOf(tenant), depts = departmentsOf(tenant);
    const have = await d.getDoctors(tenantId);
    if (clear) for (const x of have.filter((x) => x.active !== false && !kept(x.name))) { await d.updateDoctor(tenantId, x.id, { active: false }, actor); r.removed++; }
    for (const e of list) {
      const name = str(e.name, 120).trim();
      if (!name) { r.skipped++; continue; }
      // roles and departments are matched by key, then by name, in this client's own lists
      const role = roles.find((x) => x.key === e.role)?.key ?? roles.find((x) => same(x.one, str(e.roleName, 60)))?.key;
      const department = depts.find((x) => x.key === e.department)?.key ?? depts.find((x) => same(x.en, str(e.departmentName, 60)))?.key;
      const fields = { name, specialty: str(e.specialty, 200), about: str(e.about, 2000) || undefined, aboutAr: str(e.aboutAr, 2000) || undefined, role, department, extra: strRecord(e.extra) };
      const old = have.find((x) => same(x.name, name));
      const id = old ? old.id : (await d.addDoctor(tenantId, fields, actor)).id;
      const hours = e.hours === undefined || e.hours === null ? undefined : hoursOf(e.hours);
      await d.updateDoctor(tenantId, id, {
        ...(old ? fields : {}), ...(typeof e.color === "string" && /^#[0-9a-f]{6}$/i.test(e.color) ? { color: e.color } : {}),
        active: e.active !== false, ...(hours ? { hours } : {}),
      }, actor);
      if (o.photos && isPhoto(e.photo)) await d.setDoctorImage(tenantId, id, e.photo, actor);
      if (old) r.updated++; else r.added++;
    }
  } else if (part === "customers") {
    const have = await d.getCustomers(tenantId);
    for (const e of list) {
      const phone = str(e.phone, 40).trim(), name = str(e.name, 120).trim(), cpr = str(e.cpr, 40).trim();
      if (!phone && !cpr) { r.skipped++; continue; }
      const old = have.find((c) => (phone && c.phone === phone) || (cpr && c.cpr === cpr));
      const at = new Date().toISOString();
      await d.putCustomer(tenantId, {
        ...(old ?? { conversationIds: [], history: [], createdAt: at }), ...(old ? { id: old.id } : {}),
        phone: phone || old?.phone || "", name: name || old?.name || "", ...(cpr ? { cpr } : {}), ...(typeof e.email === "string" && e.email ? { email: e.email.slice(0, 200) } : {}),
        ...(e.language === "ar" || e.language === "en" ? { language: e.language } : {}), notes: str(e.notes, 4000) || old?.notes || "",
        ...(strRecord(e.extra) ? { extra: { ...(old?.extra ?? {}), ...strRecord(e.extra) } } : {}), updatedAt: at,
      }, actor);
      if (old) r.updated++; else r.added++;
    }
  }
  r.renamed = rn.count();
  return r;
}


/**
 * Sets the agent's Voice mode in ElevenLabs (Realtime with a model, or Custom = null). The field's place is taken from the file,
 * else from this client's own agent; with neither, ElevenLabs did not show the field and nothing is sent.
 */
export async function applyVoiceMode(
  api: { updateAgent(agentId: string, body: Record<string, unknown>): Promise<void> }, agentId: string, mode: unknown, ownPath?: string[],
): Promise<"set" | "unknown"> {
  const m = obj(mode);
  const model = typeof m.model === "string" && /^eleven_realtime_[\w]+$/.test(m.model) ? m.model : null;
  const fromFile = arr(m.path).every((k) => typeof k === "string" && /^[a-z_]{1,60}$/.test(k)) ? (arr(m.path) as string[]) : [];
  const path = fromFile.length && fromFile.at(-1) === "realtime_model" ? fromFile : ownPath?.at(-1) === "realtime_model" ? ownPath : null;
  if (!path) return "unknown";
  const body = path.reduceRight<unknown>((inner, k) => ({ [k]: inner }), model);
  await api.updateAgent(agentId, { conversation_config: body });
  return "set";
}
