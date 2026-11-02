/**
 * A client's own services list (2026-11-02): what the business offers, picked from the library (lib/service-library.ts) or
 * typed in. Used by the new-booking form (a pick list) and told to the assistant in its knowledge document, so it can say
 * what is offered and book the right service. Stored as one setting per client (`services.<tenantId>`), no table change.
 */
import type { LibraryService } from "./service-library";

export interface Service {
  id: string;
  name: string;
  nameAr: string;
  /** The usual length in minutes (5 to 600). */
  minutes: number;
  /** Free text such as "BHD 15" or "from BHD 20". Empty = not told. */
  price: string;
  /** Hidden services stay in the list but are not offered. */
  active: boolean;
  /** The library service it came from, so the library shows it as already added. */
  from?: string;
}

export const SERVICE_LIMITS = { name: 80, price: 40, count: 200 } as const;
export const servicesKey = (tenantId: string) => `services.${tenantId}`;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const mins = (v: unknown) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(600, Math.max(5, n)) : 30; };

/** Reads the stored list, dropping anything broken. */
export function readServices(v: unknown): Service[] {
  if (!Array.isArray(v)) return [];
  const out: Service[] = [];
  for (const r of v) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const id = typeof o.id === "string" && /^[\w-]{1,40}$/.test(o.id) ? o.id : "";
    const name = str(o.name, SERVICE_LIMITS.name);
    if (!id || !name || out.some((s) => s.id === id)) continue;
    out.push({ id, name, nameAr: str(o.nameAr, SERVICE_LIMITS.name), minutes: mins(o.minutes), price: str(o.price, SERVICE_LIMITS.price), active: o.active !== false, ...(typeof o.from === "string" ? { from: o.from.slice(0, 80) } : {}) });
  }
  return out.slice(0, SERVICE_LIMITS.count);
}

export const newServiceId = (taken: string[], rnd: () => number = Math.random) => {
  for (;;) { const id = `svc_${Math.floor(rnd() * 36 ** 6).toString(36).padStart(6, "0")}`; if (!taken.includes(id)) return id; }
};

/** A service from the form. Returns what is wrong when it cannot be saved. */
export function serviceFromForm(get: (k: string) => string): { ok: true; value: Omit<Service, "id" | "from"> } | { ok: false; error: "name" | "minutes" } {
  const name = str(get("name"), SERVICE_LIMITS.name);
  if (!name) return { ok: false, error: "name" };
  const m = Number(get("minutes"));
  if (!Number.isFinite(m) || m < 5 || m > 600) return { ok: false, error: "minutes" };
  return { ok: true, value: { name, nameAr: str(get("nameAr"), SERVICE_LIMITS.name), minutes: Math.round(m), price: str(get("price"), SERVICE_LIMITS.price), active: get("active") !== "off" } };
}

/** Adds library services that are not in the list yet (by library key or by the same English name). */
export function addFromLibrary(list: Service[], picked: LibraryService[], rnd?: () => number): { list: Service[]; added: number } {
  const out = [...list];
  let added = 0;
  for (const p of picked) {
    if (out.length >= SERVICE_LIMITS.count) break;
    if (out.some((s) => s.from === p.key || s.name.toLowerCase() === p.en.toLowerCase())) continue;
    out.push({ id: newServiceId(out.map((s) => s.id), rnd), name: p.en, nameAr: p.ar, minutes: p.minutes, price: "", active: true, from: p.key });
    added++;
  }
  return { list: out, added };
}

/** The name in the screen's language, falling back to the other one. */
export const serviceName = (s: Pick<Service, "name" | "nameAr">, locale: "en" | "ar") => (locale === "ar" ? s.nameAr || s.name : s.name || s.nameAr);

/** The services, as text for the assistant's knowledge document. Empty when nothing is offered. */
export function servicesText(list: Service[]): string {
  const on = list.filter((s) => s.active);
  if (!on.length) return "";
  const lines = on.map((s) => `- ${s.name}${s.nameAr ? ` (${s.nameAr})` : ""}: about ${s.minutes} minutes${s.price ? `, price ${s.price}` : ""}`);
  return `Services we offer (use these names when booking; if a caller asks for something not on this list, say so and offer to take a message):\n${lines.join("\n")}`;
}
