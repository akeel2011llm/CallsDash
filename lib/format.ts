import type { Locale } from "./types";

const tag = (l: Locale) => (l === "ar" ? "ar-BH-u-nu-latn" : "en-GB");
const TZ = "Asia/Bahrain";

export const fmtDateTime = (iso: string, l: Locale) =>
  new Intl.DateTimeFormat(tag(l), { dateStyle: "medium", timeStyle: "short", timeZone: TZ }).format(new Date(iso));
export const fmtDate = (iso: string, l: Locale) =>
  new Intl.DateTimeFormat(tag(l), { dateStyle: "medium", timeZone: TZ }).format(new Date(iso));
export const fmtTime = (iso: string, l: Locale) =>
  new Intl.DateTimeFormat(tag(l), { timeStyle: "short", timeZone: TZ }).format(new Date(iso));
export const fmtNum = (n: number, l: Locale, digits = 2) =>
  new Intl.NumberFormat(tag(l), { maximumFractionDigits: digits }).format(n);
export const fmtDuration = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

/** Only same-site relative paths are accepted as redirect targets. */
export const safePath = (p: unknown, fallback: string) =>
  typeof p === "string" && p.startsWith("/") && !p.startsWith("//") ? p : fallback;

/** Local (Bahrain, UTC+3) calendar day key, used by the week view. */
export const dayKey = (iso: string) => new Date(new Date(iso).getTime() + 3 * 3_600_000).toISOString().slice(0, 10);

/** Puts values into a sentence: fill("Retires on {date}", { date }) gives "Retires on 14 Jan 2027". An unknown {name} stays as it is. */
export const fill = (text: string, vars: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
