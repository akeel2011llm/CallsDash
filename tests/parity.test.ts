import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { dictionaries } from "@/lib/i18n";
import { ROOT, compare, fieldsOf, inventory, loadBaseline, loadMoves, redirectSources, type Inventory } from "./helpers/parity";

/**
 * Safety net for the app reorganisation (docs/reorganization.md): no page, API route, server action or form field may disappear
 * without being written into tests/parity/moves.json, and a moved page must keep answering at its old address.
 * After adding something on purpose: npm run parity:update.
 */
describe("nothing is lost (parity)", () => {
  const now = inventory();
  const base = loadBaseline();
  const moves = loadMoves();
  const p = compare(now, base, moves, redirectSources());

  it("reads the whole app", () => {
    expect(now.routes.length).toBeGreaterThan(60);
    expect(now.actions.length).toBeGreaterThan(80);
    expect(now.fields.length).toBeGreaterThan(300);
  });

  it("still has every page and API route (or a written move)", () => {
    expect(p.missing.routes).toEqual([]);
  });

  it("still has every server action (or a written reason)", () => {
    expect(p.missing.actions).toEqual([]);
  });

  it("still has every form field, under the same action (or a written reason)", () => {
    expect(p.missing.fields).toEqual([]);
  });

  it("keeps old addresses of moved pages working through next.config.ts redirects", () => {
    expect(p.brokenRedirects).toEqual([]);
  });

  it("sends every moved page to a page that exists", () => {
    const pages = new Set(now.routes.filter((r) => r.startsWith("page ")).map((r) => r.slice(5)));
    expect(Object.entries(moves.routes).filter(([, to]) => !pages.has(to.split(/[?#]/)[0]))).toEqual([]);
  });

  it("gives a reason for every retired action and field", () => {
    const blank = [...Object.entries(moves.actions), ...Object.entries(moves.fields)].filter(([, why]) => !String(why).trim());
    expect(blank).toEqual([]);
  });

  it("has the baseline up to date (run npm run parity:update after adding something on purpose)", () => {
    expect(p.unrecorded).toEqual({ routes: [], actions: [], fields: [] });
  });
});

describe("menus point at real pages", () => {
  const pages = new Set(inventory().routes.filter((r) => r.startsWith("page ")).map((r) => r.slice(5)));
  const layouts: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (/^layout\.tsx$/.test(e.name)) layouts.push(join(d, e.name));
    }
  };
  walk(join(ROOT, "app"));

  it("finds the admin, clinic and doctor menus", () => {
    const hrefs = layouts.flatMap((f) => [...readFileSync(f, "utf8").matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]));
    expect(hrefs.length).toBeGreaterThan(20);
    expect(hrefs.filter((h) => !pages.has(h.split(/[?#]/)[0]))).toEqual([]);
  });
});

describe("English and Arabic stay complete", () => {
  const en = dictionaries.en as Record<string, string>;
  const ar = dictionaries.ar as Record<string, string>;

  it("has every English text in Arabic and the other way round", () => {
    expect(Object.keys(en).filter((k) => !(k in ar))).toEqual([]);
    expect(Object.keys(ar).filter((k) => !(k in en))).toEqual([]);
  });

  it("has no empty text", () => {
    expect(Object.keys(en).filter((k) => !en[k].trim() || !String(ar[k] ?? "").trim())).toEqual([]);
  });
});

describe("the inventory reader", () => {
  it("keys a field by the action of its form, else by its component", () => {
    const src = `
      <form action={saveThingAction}><input name="title" /><select name={big ? "size" : "count"} /></form>
      <Icon name="tick" />
      <form method="get"><input name="q" /></form>
      <input name="loose" />`;
    expect(fieldsOf(src, "/x/components/Thing.tsx")).toEqual([
      "saveThingAction:title", "saveThingAction:size", "saveThingAction:count", "@Thing:q", "@Thing:loose",
    ]);
  });

  it("reports a field that went missing, and accepts it once a reason is written", () => {
    const base: Inventory = { routes: ["page /a"], actions: ["xAction"], fields: ["xAction:name", "xAction:gone"] };
    const now: Inventory = { routes: ["page /a"], actions: ["xAction"], fields: ["xAction:name"] };
    const none = { routes: {}, actions: {}, fields: {} };
    expect(compare(now, base, none, []).missing.fields).toEqual(["xAction:gone"]);
    expect(compare(now, base, { ...none, fields: { "xAction:gone": "merged into name" } }, []).missing.fields).toEqual([]);
  });

  it("needs a redirect for a moved page", () => {
    const base: Inventory = { routes: ["page /old/[id]"], actions: [], fields: [] };
    const now: Inventory = { routes: ["page /new/[id]"], actions: [], fields: [] };
    const moves = { routes: { "/old/[id]": "/new/[id]" }, actions: {}, fields: {} };
    expect(compare(now, base, moves, []).brokenRedirects).toEqual(["/old/[id]"]);
    expect(compare(now, base, moves, ["/old/:id"]).brokenRedirects).toEqual([]);
  });
});
