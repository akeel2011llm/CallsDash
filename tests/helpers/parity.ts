/**
 * The "nothing lost" inventory used by tests/parity.test.ts and scripts/parity-update.ts.
 *
 * It lists, straight from the source files:
 *  - routes:  every page and API route (URL pattern, plus the HTTP methods of API routes),
 *  - actions: every server action (a function exported from a "use server" file),
 *  - fields:  every form field, keyed by the server action its form posts to (`adminTopUpAction:credits`),
 *             or by the component it is written in when the form is built elsewhere (`@PlanPicker:planId`).
 *
 * Keys do not change when a screen moves to another page, so a reorganisation can move anything it likes;
 * what it cannot do is make one of these disappear without saying so in tests/parity/moves.json.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

export interface Inventory {
  routes: string[];
  actions: string[];
  fields: string[];
}

export interface Moves {
  /** old URL -> new URL. The old URL must still answer, through a redirect in next.config.ts. */
  routes: Record<string, string>;
  /** retired action or field -> why it is safe to drop it (for example "merged into adminBrandingAction"). */
  actions: Record<string, string>;
  fields: Record<string, string>;
}

export const ROOT = join(__dirname, "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const rel = (p: string) => relative(ROOT, p).split(sep).join("/");
const read = (p: string) => readFileSync(p, "utf8");

/** `app/(admin)/admin/clients/[id]/page.tsx` -> `/admin/clients/[id]`. */
export function urlOf(file: string): string {
  const parts = rel(file).split("/").slice(1, -1).filter((s) => !/^\(.*\)$/.test(s));
  return "/" + parts.join("/");
}

function routes(): string[] {
  const out: string[] = [];
  for (const f of walk(join(ROOT, "app"))) {
    const name = basename(f);
    if (/^page\.tsx?$/.test(name)) out.push(`page ${urlOf(f)}`);
    else if (/^route\.tsx?$/.test(name)) {
      const methods = [...read(f).matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map((m) => m[1]);
      for (const m of new Set(methods)) out.push(`${m} ${urlOf(f)}`);
    }
  }
  return out;
}

function sourceFiles(): string[] {
  return [...walk(join(ROOT, "app")), ...walk(join(ROOT, "components")), ...walk(join(ROOT, "lib"))].filter((f) => /\.tsx?$/.test(f));
}

function actions(): string[] {
  const out: string[] = [];
  for (const f of sourceFiles()) {
    const src = read(f);
    if (!/^\s*["']use server["'];?/m.test(src.slice(0, 400))) continue;
    for (const m of src.matchAll(/export\s+async\s+function\s+(\w+)/g)) out.push(m[1]);
  }
  return out;
}

/**
 * Walks a .tsx file and gives each `name="..."` the action of the `<form action={X}>` it sits in. A field outside any form with
 * a named action (a component used inside another file's form, or a form whose action is worked out at run time) is keyed by
 * the component file instead.
 */
export function fieldsOf(src: string, file: string): string[] {
  const out: string[] = [];
  // a page is named by its URL (every page file is called page.tsx), a component by its file name
  const owner = "@" + (/^(page|layout)\.tsx?$/.test(basename(file)) ? urlOf(file) + (basename(file).startsWith("layout") ? "#layout" : "") : basename(file).replace(/\.tsx?$/, ""));
  const stack: string[] = [];
  // name="x", and the plain strings of a name={a ? "x" : "y"}; names built at run time (name={`${key}...`}) are not followed
  const re = /<form\b[^>]*?\baction=\{\s*([A-Za-z_$][\w$]*)\s*\}|<form\b|<\/form>|\bname="([^"]+)"|\bname=\{([^{}`]*)\}/g;
  for (const m of src.matchAll(re)) {
    if (m[0] === "</form>") { stack.pop(); continue; }
    if (m[0].startsWith("<form")) { stack.push(m[1] ?? owner); continue; }
    // <Icon name="tick" /> names a picture, not a form field
    if (src.startsWith("<Icon", src.lastIndexOf("<", m.index))) continue;
    const names = m[2] ? [m[2]] : [...(m[3] ?? "").matchAll(/"([\w.-]+)"/g)].map((x) => x[1]);
    for (const n of names) out.push(`${stack.at(-1) ?? owner}:${n}`);
  }
  return out;
}

function fields(): string[] {
  const out: string[] = [];
  for (const f of sourceFiles()) if (f.endsWith(".tsx")) out.push(...fieldsOf(read(f), f));
  return out;
}

const uniq = (a: string[]) => [...new Set(a)].sort();

export function inventory(): Inventory {
  return { routes: uniq(routes()), actions: uniq(actions()), fields: uniq(fields()) };
}

export const BASELINE = join(ROOT, "tests", "parity", "baseline.json");
export const MOVES = join(ROOT, "tests", "parity", "moves.json");

export function loadBaseline(): Inventory {
  return JSON.parse(read(BASELINE)) as Inventory;
}

export function loadMoves(): Moves {
  const m = JSON.parse(read(MOVES)) as Partial<Moves>;
  return { routes: m.routes ?? {}, actions: m.actions ?? {}, fields: m.fields ?? {} };
}

/** URLs that next.config.ts sends somewhere else (`source: "/old"`). */
export function redirectSources(): string[] {
  return [...read(join(ROOT, "next.config.ts")).matchAll(/source:\s*"([^"]+)"/g)].map((m) => m[1]);
}

export interface Problems {
  missing: { routes: string[]; actions: string[]; fields: string[] };
  /** moved routes whose old URL does not answer any more */
  brokenRedirects: string[];
  /** found in the code but not yet written into the baseline */
  unrecorded: { routes: string[]; actions: string[]; fields: string[] };
}

/** Next.js turns `[id]` into `:id` in a redirect source. */
const asRedirect = (url: string) => url.replace(/\[(\.\.\.)?(\w+)\]/g, (_, dots, n) => `:${n}${dots ? "*" : ""}`);

export function compare(now: Inventory, base: Inventory, moves: Moves, redirects: string[]): Problems {
  const has = (a: string[]) => new Set(a);
  const r = has(now.routes), a = has(now.actions), f = has(now.fields);
  const missingRoutes = base.routes.filter((x) => !r.has(x) && !moves.routes[x.replace(/^\S+ /, "")]);
  const brokenRedirects = base.routes
    .filter((x) => !r.has(x) && moves.routes[x.replace(/^\S+ /, "")])
    .map((x) => x.replace(/^\S+ /, ""))
    .filter((url) => !redirects.includes(asRedirect(url)));
  const bR = has(base.routes), bA = has(base.actions), bF = has(base.fields);
  return {
    missing: {
      routes: missingRoutes,
      actions: base.actions.filter((x) => !a.has(x) && !moves.actions[x]),
      fields: base.fields.filter((x) => !f.has(x) && !moves.fields[x]),
    },
    brokenRedirects: uniq(brokenRedirects),
    unrecorded: {
      routes: now.routes.filter((x) => !bR.has(x)),
      actions: now.actions.filter((x) => !bA.has(x)),
      fields: now.fields.filter((x) => !bF.has(x)),
    },
  };
}
