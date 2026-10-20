import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Locale, SiteScan } from "./types";

export class ScanError extends Error {
  constructor(public code: "bad_url" | "blocked" | "unreachable" | "not_html" | "too_big" | "empty") { super(code); }
}

const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;

/** Addresses a server-side fetch must never touch: this machine, the private network, link-local (cloud metadata) and so on. */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
  if (isIP(v) === 6) return v === "::1" || v === "::" || /^f[cd]/.test(v) || /^fe[89ab]/.test(v);
  const [a, b] = v.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

/** "clinic.bh" -> "https://clinic.bh/". Only http and https are accepted. */
export function normalizeUrl(raw: string): URL {
  const s = raw.trim();
  if (!s) throw new ScanError("bad_url");
  let u: URL;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`); } catch { throw new ScanError("bad_url"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new ScanError("bad_url");
  if (u.username || u.password || !u.hostname.includes(".") && isIP(u.hostname) === 0) throw new ScanError("bad_url");
  return u;
}

async function assertPublic(u: URL, resolve: Resolver) {
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new ScanError("blocked");
  const addrs = isIP(host) ? [host] : await resolve(host).catch(() => { throw new ScanError("unreachable"); });
  if (addrs.length === 0 || addrs.some(isPrivateAddress)) throw new ScanError("blocked");
}

export type Resolver = (host: string) => Promise<string[]>;
const defaultResolve: Resolver = async (h) => (await lookup(h, { all: true })).map((a) => a.address);

export interface Fetched { status: number; location?: string | null; contentType: string; body: string }
export type Fetcher = (url: string, signal: AbortSignal) => Promise<Fetched>;

const defaultFetch: Fetcher = async (url, signal) => {
  const res = await fetch(url, { signal, redirect: "manual", headers: { "user-agent": "CallsDashBot/1.0 (+https://callsdash.com)", accept: "text/html,application/xhtml+xml" } });
  const contentType = res.headers.get("content-type") ?? "";
  if (res.status >= 300 && res.status < 400) return { status: res.status, location: res.headers.get("location"), contentType, body: "" };
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) { await reader.cancel(); throw new ScanError("too_big"); }
    chunks.push(value);
  }
  return { status: res.status, contentType, body: Buffer.concat(chunks).toString("utf8") };
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"' };
const decode = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " "; }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
const tidy = (s: string) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const uniq = <T,>(a: T[]) => [...new Set(a)];

const meta = (html: string, key: string) => {
  const m = html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${key}["'][^>]*>`, "i"));
  const c = m?.[0].match(/content=["']([^"']*)["']/i);
  return c ? decode(c[1]).trim() : "";
};

/** Reads what a receptionist needs from a page: name, blurb, phone numbers, emails, languages and the main text. */
export function parseSite(html: string, url: string, now = new Date()): SiteScan {
  const title = tidy(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") || meta(html, "og:site_name");
  const description = meta(html, "description") || meta(html, "og:description");

  const body = html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html;
  const stripped = body.replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const plain = tidy(stripped);

  const phones = uniq([
    ...[...stripped.matchAll(/href=["']tel:([^"']+)["']/gi)].map((m) => decodeURIComponent(m[1])),
    ...[...plain.matchAll(/(?:\+|00)\s?\d[\d\s().-]{7,16}\d/g)].map((m) => m[0]),
  ].map((p) => p.replace(/[^\d+]/g, "").replace(/^00/, "+")).filter((p) => p.replace(/\D/g, "").length >= 8 && p.replace(/\D/g, "").length <= 15)).slice(0, 5);
  const emails = uniq([
    ...[...stripped.matchAll(/href=["']mailto:([^"'?]+)/gi)].map((m) => decodeURIComponent(m[1])),
    ...[...plain.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)].map((m) => m[0]),
  ].map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) && !/\.(png|jpe?g|gif|webp|svg)$/.test(e))).slice(0, 5);

  const text = tidy(stripped.replace(/<\/(p|div|li|h[1-6]|tr|section|br)>/gi, " . ").replace(/<br\s*\/?>/gi, " . ")).replace(/( \.)+/g, ".").replace(/\s+\./g, ".").slice(0, 6000);
  const headings = uniq([...stripped.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((m) => tidy(m[1])).filter((h) => h.length >= 3 && h.length <= 80)).slice(0, 20);

  const langs = new Set<Locale>();
  const htmlLang = html.match(/<html[^>]*\blang=["']([a-z]{2})/i)?.[1]?.toLowerCase();
  if (htmlLang === "ar" || htmlLang === "en") langs.add(htmlLang);
  for (const m of html.matchAll(/hreflang=["']([a-z]{2})/gi)) { const l = m[1].toLowerCase(); if (l === "ar" || l === "en") langs.add(l); }
  const arabic = (text.match(/[؀-ۿ]/g) ?? []).length;
  if (arabic > 40) langs.add("ar");
  if (/[a-z]{3}/i.test(text.replace(/[؀-ۿ]/g, "")) && text.length - arabic > 80) langs.add("en");

  return { url, at: now.toISOString(), title, description, phones, emails, languages: [...langs], headings, text };
}

/** Fetches a public website page and reads it. Refuses private addresses, follows at most three redirects, gives up after 8 seconds. */
export async function scanSite(rawUrl: string, deps: { fetcher?: Fetcher; resolve?: Resolver; now?: Date } = {}): Promise<SiteScan> {
  const fetcher = deps.fetcher ?? defaultFetch, resolve = deps.resolve ?? defaultResolve;
  let u = normalizeUrl(rawUrl);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublic(u, resolve);
      let res: Fetched;
      try { res = await fetcher(u.toString(), ctl.signal); }
      catch (e) { if (e instanceof ScanError) throw e; throw new ScanError("unreachable"); }
      if (res.status >= 300 && res.status < 400 && res.location) {
        try { u = new URL(res.location, u); } catch { throw new ScanError("unreachable"); }
        if (u.protocol !== "http:" && u.protocol !== "https:") throw new ScanError("blocked");
        continue;
      }
      if (res.status >= 400) throw new ScanError("unreachable");
      if (!/html|xml/i.test(res.contentType)) throw new ScanError("not_html");
      const scan = parseSite(res.body, u.toString(), deps.now);
      if (!scan.text && !scan.title) throw new ScanError("empty");
      return scan;
    }
    throw new ScanError("unreachable");
  } finally { clearTimeout(timer); }
}
