import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// the dictionaries live in a server-only module; the marker import is harmless here
vi.mock("server-only", () => ({}));

import { dictionaries } from "@/lib/i18n";
import { HINT_EN } from "@/lib/whatsapp";

const en = dictionaries.en as Record<string, string>;
const ar = dictionaries.ar as Record<string, string>;
const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const SCREENS = [
  "components/WhatsappCard.tsx", "components/BookingDetailView.tsx", "components/NewBookingView.tsx", "components/BookingList.tsx",
  "lib/channel-actions.ts", "lib/manage-actions.ts", "lib/actions.ts",
];
const FAMILIES = /^(?:bookings\.wa\.|channels\.wa\.|bookings\.ref$|channels\.err\.(?:badMapUrl|sameTemplate)$|channels\.saved\.wa_test$)/;
const SKIPPED = ["channel_off", "confirmations_off", "not_configured", "bad_phone", "no_agent"];

/** Keys the screens name outright, wherever the string stands (a `t("...")`, a list of keys, or one side of a condition). */
function literalKeys(): string[] {
  const out = new Set<string>();
  for (const f of SCREENS) for (const m of read(f).matchAll(/"([\w.]+)"/g)) if (FAMILIES.test(m[1])) out.add(m[1]);
  return [...out];
}

/** The notices the settings actions send the admin back with: `error=badMapUrl` and `saved=wa_test` are shown as `channels.err.*` and `channels.saved.*`. */
function redirectKeys(): string[] {
  const src = read("lib/channel-actions.ts");
  return [
    ...[...src.matchAll(/error=(\w+)/g)].map((m) => `channels.err.${m[1]}`).filter((k) => FAMILIES.test(k)),
    ...[...src.matchAll(/saved=(wa_test)/g)].map((m) => `channels.saved.${m[1]}`),
  ];
}

/** Keys that are put together from a state, a reason or a hint. */
function dynamicKeys(): string[] {
  const k: string[] = [];
  for (const s of ["none", "sending", "unknown", "sent", "failed", "skipped"]) k.push(`bookings.wa.state.${s}`);
  for (const r of ["sent", "failed", "not_active", "bad_phone", "not_configured", "no_agent", "channel_off", "confirmations_off"]) k.push(`bookings.wa.result.${r}`);
  for (const r of ["bad_phone", "not_configured", "no_agent"]) k.push(`bookings.wa.skipped.${r}`);
  for (const r of SKIPPED) k.push(`channels.wa.skipped.${r}`);
  for (const h of Object.keys(HINT_EN)) k.push(`bookings.wa.hint.${h}`);
  return k;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

describe("WhatsApp confirmation texts", () => {
  const written = Object.keys(en).filter((k) => FAMILIES.test(k));
  const needed = [...new Set([...literalKeys(), ...redirectKeys(), ...dynamicKeys()])];

  it("covers the screens' keys", () => {
    expect(needed.length).toBeGreaterThan(60);
    expect(written.length).toBeGreaterThan(80);
  });

  it("has every key a screen asks for, in English and in Arabic", () => {
    expect(needed.filter((k) => !(k in en))).toEqual([]);
    expect(needed.filter((k) => !(k in ar))).toEqual([]);
  });

  it("has no English or Arabic text that nothing asks for by name", () => {
    // texts used only through a prefix or a loop are listed above; anything else written here should be used somewhere
    const used = new Set(needed);
    const loose = written.filter((k) => !used.has(k));
    expect(loose).toEqual([]);
  });

  it("writes the Arabic text in Arabic and keeps the same {placeholders}", () => {
    const noArabic = written.filter((k) => !/[؀-ۿ]/.test(ar[k] ?? "") && !/^[A-Za-z0-9 ./·\-()%+*#_:,]+$/.test(en[k]));
    expect(noArabic).toEqual([]);
    expect(written.filter((k) => placeholders(en[k]) !== placeholders(ar[k] ?? ""))).toEqual([]);
  });

  it("has no empty text", () => {
    expect(written.filter((k) => !en[k].trim() || !(ar[k] ?? "").trim())).toEqual([]);
  });

  it("gives every failure hint an English line for the alert and a screen text", () => {
    for (const [hint, line] of Object.entries(HINT_EN)) {
      expect(line.length).toBeGreaterThan(20);
      expect(en[`bookings.wa.hint.${hint}`]).toBeTruthy();
    }
  });
});
