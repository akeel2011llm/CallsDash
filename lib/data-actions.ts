"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin, requireClient } from "./auth";
import { autoSync } from "./auto-sync";
import { getData } from "./data";
import { CustomerError, saveCustomerByStaff } from "./customers";
import { idRuleOf } from "./id-rule";
import { MAX_IMPORT_BYTES, importCustomers, importItems, importKnowledge, isImportKind, type SheetInput } from "./data-hub";
import { sheetFromFile } from "./sheet";
import { XlsxError } from "./xlsx";
import { ItemError, itemImageDataUrl, saveItemByStaff } from "./items";
import type { Locale, Tenant } from "./types";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

interface Scope { tenant: Tenant; actor: string; admin: boolean; home: string; knowledge: boolean }

/**
 * Who is acting and on which client. The admin works on any client from the client's own Data page; a clinic manager only on their
 * own client, and only when the admin switched the Data screen on for it. A clinic whose knowledge editing is switched off still
 * cannot change the catalogue or the knowledge base here.
 */
async function scopeOf(f: FormData): Promise<Scope> {
  if (str(f, "scope") === "admin") {
    const { actor } = await requireAdmin();
    const tenant = await (await getData()).getTenant(str(f, "tenantId"));
    if (!tenant) redirect("/admin");
    return { tenant, actor, admin: true, home: `/admin/clients/${tenant.id}/data`, knowledge: true };
  }
  const { tenant, actor, viewingAsAdmin, staffRole } = await requireClient();
  if (!viewingAsAdmin && (!tenant.permissions.dataManager || staffRole !== "manager")) redirect("/app");
  return { tenant, actor, admin: false, home: "/app/data", knowledge: viewingAsAdmin || tenant.permissions.editKnowledge };
}

function done(s: Scope, params: string, hash: string): never {
  revalidatePath("/app", "layout");
  revalidatePath("/admin", "layout");
  return redirect(`${s.home}?${params}#${hash}`);
}

/** Puts a new photo on a catalogue item or a doctor, or takes it off. The browser has already shrunk it; the server only checks type and size. */
export async function dataPhotoAction(f: FormData) {
  const s = await scopeOf(f);
  const kind = str(f, "kind"), id = str(f, "id");
  const d = await getData();
  const file = f.get("photo");
  const remove = f.get("remove") === "on";
  let image: string | null = null;
  if (!remove) {
    image = file instanceof File && file.size > 0 ? await itemImageDataUrl(file) : null;
    if (!image) done(s, `err=bad_image&open=${kind}-${id}`, "photos");
  }
  if (kind === "item") {
    if (!s.knowledge) done(s, "err=locked", "photos");
    const cur = await d.getItem(s.tenant.id, id);
    if (!cur) done(s, "err=unknown", "photos");
    const { id: _i, tenantId: _t, hasImage: _h, updatedAt: _u, ...rest } = cur!;
    void [_i, _t, _h, _u];
    await d.putItem(s.tenant.id, { ...rest, id }, image, s.actor);
  } else if (kind === "doctor") {
    try { await d.setDoctorImage(s.tenant.id, id, image, s.actor); } catch { done(s, "err=unknown", "photos"); }
    await autoSync(s.tenant.id, s.actor); // the assistant's instructions say which doctors have a photo
  } else done(s, "err=unknown", "photos");
  done(s, `photo=${remove ? "removed" : "saved"}`, "photos");
}

type RowKind = "catalogue" | "customers" | "knowledge";
const rowKind = (v: string): RowKind | null => (v === "catalogue" || v === "customers" || v === "knowledge" ? v : null);
const hashOf = (k: RowKind) => k;

/** Hide, show or delete the ticked rows of one list at once. Deleting needs the tick box. */
export async function dataBulkAction(f: FormData) {
  const s = await scopeOf(f);
  const kind = rowKind(str(f, "kind"));
  if (!kind) return done(s, "err=unknown", "storage");
  if (kind !== "customers" && !s.knowledge) return done(s, "err=locked", hashOf(kind));
  const op = str(f, "op");
  const ids = [...new Set(f.getAll("ids").map(String))].slice(0, 500);
  if (!ids.length) return done(s, `err=none&open=${kind}`, hashOf(kind));
  if (op === "delete" && f.get("confirm") !== "on") return done(s, `err=confirm&open=${kind}`, hashOf(kind));
  const d = await getData();
  let n = 0;
  if (kind === "catalogue") {
    for (const id of ids) {
      const cur = await d.getItem(s.tenant.id, id);
      if (!cur) continue;
      if (op === "delete") await d.deleteItem(s.tenant.id, id, s.actor);
      else if (op === "hide" || op === "show") {
        const { id: _i, tenantId: _t, hasImage: _h, updatedAt: _u, ...rest } = cur;
        void [_i, _t, _h, _u];
        await d.putItem(s.tenant.id, { ...rest, id, active: op === "show" }, undefined, s.actor);
      } else continue;
      n++;
    }
  } else if (kind === "customers") {
    if (op === "delete") for (const id of ids) { await d.deleteCustomer(s.tenant.id, id, s.actor); n++; }
  } else if (op === "delete") {
    for (const id of ids) { await d.deleteKnowledge(s.tenant.id, id, s.actor); n++; }
    if (n) await autoSync(s.tenant.id, s.actor);
  }
  return done(s, `bulk=${n}&open=${kind}`, hashOf(kind));
}

/** Saves one row edited in place on the Data screen. */
export async function dataRowAction(f: FormData) {
  const s = await scopeOf(f);
  const kind = rowKind(str(f, "kind"));
  if (!kind) return done(s, "err=unknown", "storage");
  const d = await getData();
  const id = str(f, "id");
  const back = (params: string) => done(s, `${params}&open=${kind}-${id}`, hashOf(kind));
  if (kind === "catalogue") {
    if (!s.knowledge) return back("err=locked");
    let image: string | null | undefined;
    const file = f.get("photo");
    if (file instanceof File && file.size > 0) {
      image = await itemImageDataUrl(file);
      if (!image) return back("err=bad_image");
    } else if (f.get("removePhoto") === "on") image = null;
    try {
      await saveItemByStaff(d, s.tenant.id, {
        id: id || undefined, name: str(f, "name"), nameAr: str(f, "nameAr"), details: str(f, "details"), detailsAr: str(f, "detailsAr"),
        price: str(f, "price"), keywords: str(f, "keywords"), active: f.get("active") === "on",
      }, image, s.actor);
    } catch (e) {
      if (e instanceof ItemError) return back(`err=${e.code}`);
      throw e;
    }
  } else if (kind === "customers") {
    const lang = str(f, "language");
    try {
      await saveCustomerByStaff(d, s.tenant.id, {
        id: id || undefined, name: str(f, "name"), phone: str(f, "phone"), cpr: str(f, "cpr"), email: str(f, "email"),
        language: lang === "ar" || lang === "en" ? (lang as Locale) : undefined, notes: str(f, "notes"),
      }, s.actor, idRuleOf(s.tenant));
    } catch (e) {
      if (e instanceof CustomerError) return back(`err=${e.code}`);
      throw e;
    }
  } else {
    if (!s.knowledge) return back("err=locked");
    const question = str(f, "question").slice(0, 500), answer = str(f, "answer").slice(0, 2000);
    const language: Locale = str(f, "language") === "ar" ? "ar" : "en";
    if (!question || !answer) return back("err=no_text");
    if (id) await d.updateKnowledge(s.tenant.id, id, { question, answer, language }, s.actor);
    else await d.addKnowledge(s.tenant.id, question, answer, language, s.actor);
    await autoSync(s.tenant.id, s.actor);
  }
  return done(s, `saved=1&open=${kind}`, hashOf(kind));
}

/** Reads a CSV or Excel file into the catalogue, the customers or the knowledge base. Rows that cannot be used are listed, never silently dropped. */
export async function dataImportAction(f: FormData) {
  const s = await scopeOf(f);
  const kind = str(f, "kind");
  if (!isImportKind(kind)) return done(s, "err=unknown", "transfer");
  if ((kind === "catalogue" || kind === "knowledge") && !s.knowledge) return done(s, "err=locked", "transfer");
  const file = f.get("file");
  if (!(file instanceof File) || file.size === 0) return done(s, "err=nofile", "transfer");
  if (file.size > MAX_IMPORT_BYTES) return done(s, "err=toobig", "transfer");
  let text: SheetInput;
  try { text = await sheetFromFile(file); }
  catch (e) { if (e instanceof XlsxError) return done(s, "err=badfile", "transfer"); throw e; }
  const d = await getData();
  const r = kind === "catalogue" ? await importItems(d, s.tenant.id, text, s.actor)
    : kind === "customers" ? await importCustomers(d, s.tenant.id, text, s.actor, idRuleOf(s.tenant))
      : await importKnowledge(d, s.tenant.id, text, s.actor);
  if (r.missingColumn) return done(s, `err=column&col=${r.missingColumn}`, "transfer");
  if (kind === "knowledge" && (r.added || r.updated)) await autoSync(s.tenant.id, s.actor);
  const errs = r.errors.slice(0, 20).map((e) => `${e.line}.${e.code}`).join(",");
  return done(s, `imp=${kind}&added=${r.added}&updated=${r.updated}&skipped=${r.skipped}&more=${r.tooMany ? 1 : 0}&errs=${encodeURIComponent(errs)}`, "transfer");
}
