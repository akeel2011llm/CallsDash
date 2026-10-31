/**
 * Procedures (ElevenLabs "Procedures", step 5 of the any-business plan): short step-by-step routines the assistant follows when a
 * situation comes up, such as a complaint or a new customer asking for prices. They live in ElevenLabs, on the agent's main
 * branch; CallsDash keeps no copy, so what the page shows is always what the assistant has.
 *
 * ElevenLabs keeps an edited procedure as a draft until the agent is published. Every change made here is published at once
 * (a PATCH of the agent without `procedures` publishes the drafts), and so does every sync from CallsDash.
 * Request shapes from ElevenLabs' JavaScript SDK 2.75.0; not yet tried against the real service from the build environment.
 */
import { elevenLabsRequester } from "./elevenlabs-api";

type FetchLike = typeof fetch;
type Json = Record<string, unknown>;

export const PROCEDURE_TYPES = ["free_form", "deterministic"] as const;
export type ProcedureType = (typeof PROCEDURE_TYPES)[number];
export const PROCEDURE_LIMITS = { name: 80, trigger: 300, content: 6000, count: 40 } as const;

export interface ProcedureSummary { id: string; name: string; trigger: string; type: ProcedureType | "folder"; draft: boolean }
export interface Procedure extends ProcedureSummary { content: string }
export interface ProcedureInput { name: string; trigger: string; type: ProcedureType; content: string }

const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");
const typeOf = (v: unknown): Procedure["type"] => (v === "deterministic" || v === "folder" ? v : "free_form");
const safe = (id: string) => /^[\w-]{1,128}$/.test(id);

export function mapProcedure(raw: unknown): ProcedureSummary | null {
  const p = obj(raw);
  const id = str(p.procedure_id);
  if (!id) return null;
  return { id, name: str(p.name) || id, trigger: str(p.trigger), type: typeOf(p.type), draft: p.has_draft === true };
}

/** A procedure from the form: a name, when to use it, its kind and its steps. Returns the problem when it cannot be saved. */
export function procedureFromForm(get: (k: string) => string): { ok: true; value: ProcedureInput } | { ok: false; error: "name" | "content" | "long" } {
  const name = get("name").replace(/\s+/g, " ").trim();
  const trigger = get("trigger").replace(/\s+/g, " ").trim();
  const content = get("content").replace(/\r\n/g, "\n").trim();
  const type: ProcedureType = get("type") === "deterministic" ? "deterministic" : "free_form";
  if (!name) return { ok: false, error: "name" };
  if (!content) return { ok: false, error: "content" };
  if (name.length > PROCEDURE_LIMITS.name || trigger.length > PROCEDURE_LIMITS.trigger || content.length > PROCEDURE_LIMITS.content) return { ok: false, error: "long" };
  return { ok: true, value: { name, trigger, type, content } };
}

export interface ProceduresApi {
  /** The agent's main branch, where its live procedures are. */
  mainBranch(agentId: string): Promise<string>;
  list(agentId: string, branchId: string): Promise<ProcedureSummary[]>;
  get(agentId: string, branchId: string, id: string): Promise<Procedure>;
  create(agentId: string, branchId: string, p: ProcedureInput): Promise<string>;
  update(agentId: string, branchId: string, id: string, p: ProcedureInput): Promise<void>;
  remove(agentId: string, branchId: string, id: string): Promise<void>;
  /** Publishes the agent, which takes the procedures' drafts live. */
  publish(agentId: string, note: string): Promise<void>;
}

export function createProceduresApi(apiKey: string, fetchImpl: FetchLike = fetch): ProceduresApi {
  const call = elevenLabsRequester(apiKey, fetchImpl);
  const base = (agentId: string, branchId: string) => {
    if (!safe(agentId) || !safe(branchId)) throw new Error("bad id");
    return `/v1/convai/agents/${encodeURIComponent(agentId)}/branches/${encodeURIComponent(branchId)}/procedures`;
  };
  const one = (agentId: string, branchId: string, id: string) => {
    if (!safe(id)) throw new Error("bad id");
    return `${base(agentId, branchId)}/${encodeURIComponent(id)}`;
  };
  const body = (p: ProcedureInput) => ({ name: p.name, content: p.content, type: p.type, trigger: p.trigger });
  return {
    async mainBranch(agentId) {
      if (!safe(agentId)) throw new Error("bad id");
      const a = obj(await call("GET", `/v1/convai/agents/${encodeURIComponent(agentId)}`, undefined, { timeoutMs: 10_000 }));
      const id = str(a.main_branch_id) || str(a.branch_id);
      if (!id) throw new Error("ElevenLabs did not say which branch the agent is on");
      return id;
    },
    async list(agentId, branchId) {
      const r = obj(await call("GET", base(agentId, branchId), undefined, { timeoutMs: 10_000 }));
      return (Array.isArray(r.procedures) ? r.procedures : []).map(mapProcedure).filter((p): p is ProcedureSummary => !!p).slice(0, 100);
    },
    async get(agentId, branchId, id) {
      // the draft when there is one (what was last saved), otherwise the published version
      const read = async (path: string) => obj(await call("GET", path, undefined, { timeoutMs: 10_000 }));
      let p: Json;
      try { p = await read(`${one(agentId, branchId, id)}/draft`); } catch { p = await read(one(agentId, branchId, id)); }
      const summary = mapProcedure({ ...p, procedure_id: str(p.procedure_id) || id });
      return { ...summary!, content: str(p.content) };
    },
    async create(agentId, branchId, p) {
      const r = obj(await call("POST", base(agentId, branchId), body(p), { timeoutMs: 15_000 }));
      return str(r.procedure_id);
    },
    async update(agentId, branchId, id, p) {
      await call("PATCH", `${one(agentId, branchId, id)}/draft`, body(p), { timeoutMs: 15_000 });
    },
    async remove(agentId, branchId, id) {
      await call("DELETE", one(agentId, branchId, id), undefined, { timeoutMs: 15_000 });
    },
    async publish(agentId, note) {
      if (!safe(agentId)) throw new Error("bad id");
      await call("PATCH", `/v1/convai/agents/${encodeURIComponent(agentId)}`, { version_description: note.slice(0, 200) }, { timeoutMs: 20_000 });
    },
  };
}

/** Where ElevenLabs' reason for the last refused change is kept (ten minutes), so the page shows it and the address cannot. */
export const procedureFailKey = (tenantId: string) => `procedures.fail.${tenantId}`;
export function failureToShow(v: unknown, now = Date.now()): string | null {
  const o = obj(v);
  if (typeof o.detail !== "string" || typeof o.at !== "string" || now - Date.parse(o.at) > 10 * 60_000) return null;
  return o.detail;
}

export const proceduresFromEnv = (): ProceduresApi | null => (process.env.ELEVENLABS_API_KEY ? createProceduresApi(process.env.ELEVENLABS_API_KEY) : null);

/** Ready-made procedures an admin can start from, in the client's own words (`customer`, `staff`). */
export const PROCEDURE_TEMPLATES = ["complaint", "prices", "callback", "lateCancel"] as const;
export type ProcedureTemplate = (typeof PROCEDURE_TEMPLATES)[number];

export function procedureTemplate(id: ProcedureTemplate, w: { customer: string; staff: string; place: string }): ProcedureInput {
  switch (id) {
    case "complaint":
      return {
        name: "Handle a complaint", type: "free_form",
        trigger: `The ${w.customer} is unhappy or wants to complain.`,
        content: `1. Listen and thank the ${w.customer} for telling us.\n2. Apologise once, without blaming anyone.\n3. Ask what happened and when, and how we can put it right.\n4. Take a message for the ${w.staff} with the ${w.customer}'s name, phone number and the details.\n5. Tell them the ${w.place} will call back, and do not promise a refund or a discount.`,
      };
    case "prices":
      return {
        name: "New customer asking for prices", type: "free_form",
        trigger: `A new ${w.customer} asks about prices, services or packages.`,
        content: `1. Answer only with prices from the knowledge base or the catalogue. Never guess a price.\n2. Ask what they are interested in, and suggest the matching service.\n3. Offer to book a time.\n4. If they are not ready, offer to take their name and phone number so the ${w.place} can follow up.`,
      };
    case "callback":
      return {
        name: "Ask for a call back", type: "deterministic",
        trigger: `The ${w.customer} wants to speak to a person, or you cannot help after two tries.`,
        content: `1. Say that a member of the ${w.place} will call them back.\n2. Ask for their name.\n3. Ask for the best phone number and confirm it digit by digit.\n4. Ask briefly what it is about.\n5. Take the message, then confirm it was sent.`,
      };
    case "lateCancel":
      return {
        name: "Late cancellation", type: "free_form",
        trigger: "Someone wants to cancel or move a booking on the same day.",
        content: `1. Find the booking first.\n2. Offer the next free time instead of cancelling.\n3. If they still want to cancel, cancel it and confirm.\n4. Mention politely that same-day changes are hard for the ${w.staff}, without asking for any fee.`,
      };
  }
}
