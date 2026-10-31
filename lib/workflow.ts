/**
 * Workflows (ElevenLabs "Workflow", step 6 of the any-business plan): the conversation's map. Without one, the assistant
 * handles the whole call. With one, it can hand a part of the call to a step: a specialist with its own extra instructions,
 * a fixed message, another ElevenLabs assistant, a phone number, or the end of the call.
 *
 * CallsDash edits one simple shape that works well on a phone screen: the main assistant in the middle, and steps around it.
 * Each step is reached from the main assistant when its condition ("when") is true, and either comes back, ends the call,
 * or hands the call over. A workflow built by hand in ElevenLabs with any other shape is shown read-only, and can only be
 * replaced or removed as a whole (with a tick box).
 *
 * The workflow lives only in ElevenLabs (`workflow` on the agent, PATCH replaces it whole). A sync from CallsDash never sends
 * `workflow`, so it leaves it alone. Shapes from ElevenLabs' JavaScript SDK 2.75.0; not yet tried against the real service.
 */
import { elevenLabsRequester } from "./elevenlabs-api";
import type { Vocab } from "./business-types";

type FetchLike = typeof fetch;
type Json = Record<string, unknown>;

export const STEP_KINDS = ["specialist", "say", "agent", "phone", "end"] as const;
export type StepKind = (typeof STEP_KINDS)[number];
export const STEP_LIMITS = { label: 60, when: 300, instructions: 4000, message: 500, count: 12 } as const;

export interface Step {
  id: string;
  kind: StepKind;
  label: string;
  /** In plain words, when the main assistant hands over to this step. */
  when: string;
  /** specialist: extra instructions for this part of the call. */
  instructions: string;
  /** specialist: when to come back to the main assistant ("" = never). */
  back: string;
  /** specialist: when to end the call from this step ("" = never). */
  endWhen: string;
  /** say: what is said, word for word. */
  message: string;
  /** say: what happens after the message. */
  then: "main" | "end";
  /** agent: another ElevenLabs assistant to hand the call to. */
  agentId: string;
  /** phone: the number to transfer to (with the country code). */
  phone: string;
  /** agent and phone: what the assistant says before handing over. */
  transferMessage: string;
}

export type LiveWorkflow =
  | { kind: "none" }
  | { kind: "simple"; mainLabel: string; steps: Step[] }
  | { kind: "custom"; nodes: { id: string; type: string; label: string }[]; edges: number };

const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");
const one = (s: string) => s.replace(/\s+/g, " ").trim();
export const validNodeId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id);
export const validAgentId = (id: string) => /^agent_[A-Za-z0-9]{8,64}$/.test(id);
/** International number: +, then 8 to 15 digits (Bahrain: +973 and 8 digits). */
export const validPhone = (p: string) => /^\+[1-9]\d{7,14}$/.test(p);

export const blankStep = (kind: StepKind, id = ""): Step => ({
  id, kind, label: "", when: "", instructions: "", back: "", endWhen: "", message: "", then: "main", agentId: "", phone: "", transferMessage: "",
});

export const START = "start_node";
export const MAIN = "main_assistant";
const llm = (condition: string, label?: string) => ({ type: "llm", condition, ...(label ? { label } : {}) });
const always = () => ({ type: "unconditional" });

/** The ElevenLabs workflow for the main assistant and its steps. No steps means no workflow (null). */
export function buildWorkflow(steps: Step[], mainLabel = "Main assistant"): Json | null {
  if (!steps.length) return null;
  const nodes: Json = {
    [START]: { type: "start", position: { x: 0, y: 0 }, edge_order: ["edge_start"] },
    [MAIN]: { type: "override_agent", label: mainLabel, position: { x: 0, y: 160 }, edge_order: [] as string[] },
  };
  const edges: Json = { edge_start: { source: START, target: MAIN, forward_condition: always() } };
  const mainOrder = (nodes[MAIN] as { edge_order: string[] }).edge_order;
  steps.forEach((s, i) => {
    const x = (i - (steps.length - 1) / 2) * 320;
    const pos = { x, y: 400 };
    const inEdge = `edge_main_${s.id}`;
    mainOrder.push(inEdge);
    edges[inEdge] = {
      source: MAIN, target: s.id, forward_condition: llm(s.when, s.label),
      ...(s.kind === "specialist" && s.back ? { backward_condition: llm(s.back) } : {}),
    };
    const order: string[] = [];
    const endTo = (cond: Json) => {
      const endId = `${s.id}_end`;
      nodes[endId] = { type: "end", position: { x, y: 600 }, edge_order: [] };
      edges[`edge_${s.id}_end`] = { source: s.id, target: endId, forward_condition: cond };
      order.push(`edge_${s.id}_end`);
    };
    switch (s.kind) {
      case "specialist":
        nodes[s.id] = { type: "override_agent", label: s.label, additional_prompt: s.instructions, position: pos, edge_order: order };
        if (s.endWhen) endTo(llm(s.endWhen));
        break;
      case "say":
        nodes[s.id] = { type: "say", label: s.label, message: { type: "literal", text: s.message }, wait_for_speech_completion: true, position: pos, edge_order: order };
        if (s.then === "end") endTo(always());
        else { edges[`edge_${s.id}_main`] = { source: s.id, target: MAIN, forward_condition: always() }; order.push(`edge_${s.id}_main`); }
        break;
      case "agent":
        nodes[s.id] = { type: "standalone_agent", agent_id: s.agentId, transfer_message: s.transferMessage || null, enable_transferred_agent_first_message: !s.transferMessage, position: pos, edge_order: order };
        break;
      case "phone":
        nodes[s.id] = { type: "phone_number", transfer_destination: { type: "phone", phone_number: s.phone }, transfer_type: "conference", position: pos, edge_order: order };
        break;
      case "end":
        nodes[s.id] = { type: "end", position: pos, edge_order: order };
        break;
    }
  });
  return { nodes, edges, prevent_subagent_loops: true };
}

/**
 * Reads the agent's workflow. It is "simple" only when it has exactly the shape `buildWorkflow` makes, so CallsDash never
 * rewrites a hand-made workflow it does not fully understand.
 */
export function readWorkflow(raw: unknown): LiveWorkflow {
  const w = obj(raw);
  const nodes = obj(w.nodes);
  const edges = Object.values(obj(w.edges)).map(obj);
  const ids = Object.keys(nodes);
  if (!ids.length) return { kind: "none" };
  const custom = (): LiveWorkflow => ({
    kind: "custom",
    nodes: ids.slice(0, 60).map((id) => ({ id, type: str(obj(nodes[id]).type) || "?", label: str(obj(nodes[id]).label) })),
    edges: edges.length,
  });
  const typeOf = (id: string) => str(obj(nodes[id]).type);
  const cond = (e: Json, k: "forward_condition" | "backward_condition") => obj(e[k]);
  const isAlways = (c: Json) => c.type === "unconditional";
  const llmText = (c: Json) => (c.type === "llm" ? str(c.condition) : null);

  const starts = ids.filter((id) => typeOf(id) === "start");
  if (starts.length !== 1) return custom();
  const fromStart = edges.filter((e) => e.source === starts[0]);
  if (fromStart.length !== 1 || !isAlways(cond(fromStart[0], "forward_condition")) || edges.some((e) => e.target === starts[0])) return custom();
  const main = str(fromStart[0].target);
  const mainNode = obj(nodes[main]);
  if (mainNode.type !== "override_agent" || str(mainNode.additional_prompt) || Object.keys(obj(mainNode.conversation_config)).length) return custom();

  const used = new Set([starts[0], main]);
  const usedEdges = new Set<Json>([fromStart[0]]);
  const steps: Step[] = [];
  for (const e of edges.filter((x) => x.source === main)) {
    const id = str(e.target);
    const n = obj(nodes[id]);
    const when = llmText(cond(e, "forward_condition"));
    if (when === null || used.has(id) || !validNodeId(id)) return custom();
    used.add(id); usedEdges.add(e);
    const out = edges.filter((x) => x.source === id);
    const back = e.backward_condition ? llmText(cond(e, "backward_condition")) : "";
    if (back === null) return custom();
    const s = { ...blankStep("end", id), when, label: str(cond(e, "forward_condition").label) || str(n.label) || id };
    // a step's only way out: an end node of its own, or (say) straight back to the main assistant
    const endOut = (needAlways: boolean): string | null | false => {
      if (!out.length) return null;
      if (out.length !== 1) return false;
      const o = out[0], t = str(o.target);
      if (typeOf(t) !== "end" || used.has(t) || edges.some((x) => x !== o && (x.source === t || x.target === t))) return false;
      const c = cond(o, "forward_condition");
      const text = needAlways ? (isAlways(c) ? "" : null) : llmText(c);
      if (text === null) return false;
      used.add(t); usedEdges.add(o);
      return text;
    };
    switch (n.type) {
      case "override_agent": {
        if (Object.keys(obj(n.conversation_config)).length) return custom();
        const end = endOut(false);
        if (end === false) return custom();
        steps.push({ ...s, kind: "specialist", label: str(n.label) || s.label, instructions: str(n.additional_prompt), back: back ?? "", endWhen: end ?? "" });
        break;
      }
      case "say": {
        const m = obj(n.message);
        if (m.type !== "literal" || back) return custom();
        const toMain = out.length === 1 && out[0].target === main && isAlways(cond(out[0], "forward_condition"));
        let then: Step["then"] = "main";
        if (toMain) usedEdges.add(out[0]);
        else { const end = endOut(true); if (end !== "") return custom(); then = "end"; }
        steps.push({ ...s, kind: "say", label: str(n.label) || s.label, message: str(m.text), then });
        break;
      }
      case "standalone_agent":
        if (out.length || back) return custom();
        steps.push({ ...s, kind: "agent", agentId: str(n.agent_id), transferMessage: str(n.transfer_message) });
        break;
      case "phone_number": {
        const d = obj(n.transfer_destination);
        if (out.length || back || d.type !== "phone") return custom();
        steps.push({ ...s, kind: "phone", phone: str(d.phone_number) });
        break;
      }
      case "end":
        if (out.length || back) return custom();
        steps.push(s);
        break;
      default:
        return custom();
    }
  }
  if (ids.some((id) => !used.has(id)) || edges.some((e) => !usedEdges.has(e))) return custom();
  if (!steps.length) return { kind: "none" };
  return { kind: "simple", mainLabel: str(mainNode.label) || "Main assistant", steps };
}

export type StepError = "label" | "when" | "instructions" | "message" | "agent" | "ownAgent" | "phone" | "long";

/** A step from the form (its kind fixed by the form). Returns the problem when it cannot be saved. */
export function stepFromForm(get: (k: string) => string, ownAgentId: string): { ok: true; value: Step } | { ok: false; error: StepError } {
  const kind = (STEP_KINDS as readonly string[]).includes(get("kind")) ? (get("kind") as StepKind) : "specialist";
  const s: Step = {
    ...blankStep(kind, get("stepId")),
    label: one(get("label")), when: one(get("when")),
    instructions: get("instructions").replace(/\r\n/g, "\n").trim(), back: one(get("back")), endWhen: one(get("endWhen")),
    message: one(get("message")), then: get("then") === "end" ? "end" : "main",
    agentId: one(get("agentId")), phone: get("phone").replace(/[\s()-]/g, ""), transferMessage: one(get("transferMessage")),
  };
  if (!s.label) return { ok: false, error: "label" };
  if (!s.when) return { ok: false, error: "when" };
  if (s.label.length > STEP_LIMITS.label || s.when.length > STEP_LIMITS.when || s.back.length > STEP_LIMITS.when || s.endWhen.length > STEP_LIMITS.when
    || s.instructions.length > STEP_LIMITS.instructions || s.message.length > STEP_LIMITS.message || s.transferMessage.length > STEP_LIMITS.message) return { ok: false, error: "long" };
  if (kind === "specialist" && !s.instructions) return { ok: false, error: "instructions" };
  if (kind === "say" && !s.message) return { ok: false, error: "message" };
  if (kind === "agent" && !validAgentId(s.agentId)) return { ok: false, error: "agent" };
  if (kind === "agent" && s.agentId === ownAgentId) return { ok: false, error: "ownAgent" };
  if (kind === "phone" && !validPhone(s.phone)) return { ok: false, error: "phone" };
  // keep only what the kind uses, so a stored step never carries stray text
  const keep: Record<StepKind, (keyof Step)[]> = {
    specialist: ["instructions", "back", "endWhen"], say: ["message", "then"], agent: ["agentId", "transferMessage"], phone: ["phone"], end: [],
  };
  const clean = { ...blankStep(kind, s.id), label: s.label, when: s.when } as Step;
  for (const k of keep[kind]) (clean as unknown as Json)[k] = s[k];
  return { ok: true, value: clean };
}

export const newStepId = (taken: string[], rand: () => number = Math.random) => {
  for (;;) {
    const id = `step_${Math.floor(rand() * 36 ** 6).toString(36).padStart(6, "0")}`;
    if (!taken.includes(id)) return id;
  }
};

export interface WorkflowApi {
  read(agentId: string): Promise<LiveWorkflow>;
  /** Replaces the agent's workflow (null removes it). */
  write(agentId: string, workflow: Json | null): Promise<void>;
}

export function createWorkflowApi(apiKey: string, fetchImpl: FetchLike = fetch): WorkflowApi {
  const call = elevenLabsRequester(apiKey, fetchImpl);
  const path = (agentId: string) => {
    if (!validNodeId(agentId)) throw new Error("bad id");
    return `/v1/convai/agents/${encodeURIComponent(agentId)}`;
  };
  return {
    async read(agentId) {
      return readWorkflow(obj(await call("GET", path(agentId), undefined, { timeoutMs: 10_000 })).workflow);
    },
    async write(agentId, workflow) {
      await call("PATCH", path(agentId), { workflow: workflow ?? { nodes: {}, edges: {} } }, { timeoutMs: 20_000 });
    },
  };
}

export const workflowFromEnv = (): WorkflowApi | null => (process.env.ELEVENLABS_API_KEY ? createWorkflowApi(process.env.ELEVENLABS_API_KEY) : null);
export const workflowFailKey = (tenantId: string) => `workflow.fail.${tenantId}`;

/** Ready-made steps in the client's own words (English: the assistant reads them). */
export const STEP_TEMPLATES = ["complaints", "prices", "emergency", "person"] as const;
export type StepTemplate = (typeof STEP_TEMPLATES)[number];

export function stepTemplate(id: StepTemplate, v: Pick<Vocab, "customerOne" | "staffMany" | "place">): Step {
  switch (id) {
    case "complaints":
      return {
        ...blankStep("specialist"), label: "Complaints",
        when: `The ${v.customerOne} is unhappy or wants to make a complaint.`,
        instructions: `You are handling a complaint. Stay calm and kind. Let the ${v.customerOne} explain, thank them, and apologise once without blaming anyone. Ask what happened and how we can put it right. Take a message for the ${v.staffMany} with their name, phone number and the details. Do not promise refunds or discounts.`,
        back: "The complaint has been written down and the caller has nothing more to add about it.",
      };
    case "prices":
      return {
        ...blankStep("specialist"), label: "Prices and offers",
        when: "The caller asks about prices, packages or offers.",
        instructions: "Answer only with prices and offers from your knowledge base or the catalogue. Never guess a price. Suggest the matching service, then offer to book a time.",
        back: "The question about prices has been answered.",
      };
    case "emergency":
      return {
        ...blankStep("say"), label: "Emergency",
        when: "The caller describes an emergency or that someone is in danger.",
        message: "If this is an emergency, please hang up and call 999 now.", then: "end",
      };
    case "person":
      return {
        ...blankStep("specialist"), label: "Talk to a person",
        when: "The caller insists on speaking to a person.",
        instructions: `Explain kindly that a member of the ${v.place} will call them back. Ask for their name and the best phone number, confirm the number digit by digit, ask briefly what it is about, and take a message.`,
        back: "The message for a call back has been taken.",
      };
  }
}
