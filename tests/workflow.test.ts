import { describe, expect, it } from "vitest";
import {
  MAIN, STEP_TEMPLATES, blankStep, buildWorkflow, createWorkflowApi, newStepId, readWorkflow, stepFromForm, stepTemplate, type Step,
} from "@/lib/workflow";

const get = (o: Record<string, string>) => (k: string) => o[k] ?? "";
const words = { customerOne: "client", staffMany: "stylists", place: "salon" };
const steps: Step[] = [
  { ...blankStep("specialist", "step_a"), label: "Complaints", when: "Unhappy caller", instructions: "Be calm.", back: "Complaint written down", endWhen: "Caller says goodbye" },
  { ...blankStep("say", "step_b"), label: "Emergency", when: "Emergency", message: "Call 999 now.", then: "end" },
  { ...blankStep("say", "step_c"), label: "Notice", when: "Asks about recording", message: "Calls are recorded.", then: "main" },
  { ...blankStep("agent", "step_d"), label: "Sales", when: "Wants a quote", agentId: "agent_abcdefgh1234", transferMessage: "One moment." },
  { ...blankStep("phone", "step_e"), label: "Front desk", when: "Insists on a person", phone: "+97317000000" },
  { ...blankStep("end", "step_f"), label: "Wrong number", when: "Wrong number" },
];

describe("workflow: building and reading back", () => {
  it("no steps means no workflow", () => {
    expect(buildWorkflow([])).toBeNull();
    expect(readWorkflow(null)).toEqual({ kind: "none" });
    expect(readWorkflow({ nodes: {}, edges: {} })).toEqual({ kind: "none" });
  });

  it("every kind of step reads back exactly as it was built", () => {
    const w = buildWorkflow(steps, "Main");
    const back = readWorkflow(JSON.parse(JSON.stringify(w)));
    expect(back).toEqual({ kind: "simple", mainLabel: "Main", steps });
  });

  it("builds the ElevenLabs shapes", () => {
    const w = buildWorkflow(steps) as { nodes: Record<string, any>; edges: Record<string, any> };
    expect(w.nodes.start_node.type).toBe("start");
    expect(w.edges.edge_start).toEqual({ source: "start_node", target: MAIN, forward_condition: { type: "unconditional" } });
    expect(w.edges.edge_main_step_a).toMatchObject({ forward_condition: { type: "llm", condition: "Unhappy caller" }, backward_condition: { type: "llm", condition: "Complaint written down" } });
    expect(w.nodes.step_a).toMatchObject({ type: "override_agent", additional_prompt: "Be calm." });
    expect(w.nodes.step_b).toMatchObject({ type: "say", message: { type: "literal", text: "Call 999 now." } });
    expect(w.edges.edge_step_b_end).toMatchObject({ target: "step_b_end", forward_condition: { type: "unconditional" } });
    expect(w.edges.edge_step_c_main).toMatchObject({ target: MAIN });
    expect(w.nodes.step_d).toMatchObject({ type: "standalone_agent", agent_id: "agent_abcdefgh1234", transfer_message: "One moment.", enable_transferred_agent_first_message: false });
    expect(w.nodes.step_e).toMatchObject({ type: "phone_number", transfer_destination: { type: "phone", phone_number: "+97317000000" } });
    expect(w.nodes[MAIN].edge_order).toEqual(steps.map((s) => `edge_main_${s.id}`));
  });

  it("a hand-made workflow in another shape is read-only", () => {
    const w = buildWorkflow(steps.slice(0, 1)) as { nodes: Record<string, any>; edges: Record<string, any> };
    // a tool step, which CallsDash does not edit
    const tool = { ...w, nodes: { ...w.nodes, tool_1: { type: "tool", tools: [] } }, edges: { ...w.edges, e9: { source: MAIN, target: "tool_1", forward_condition: { type: "unconditional" } } } };
    expect(readWorkflow(tool)).toMatchObject({ kind: "custom", edges: 4 });
    // the main assistant with its own settings
    expect(readWorkflow({ ...w, nodes: { ...w.nodes, [MAIN]: { ...w.nodes[MAIN], additional_prompt: "x" } } }).kind).toBe("custom");
    // a step linked to another step
    const linked = buildWorkflow(steps.slice(0, 2)) as { nodes: Record<string, any>; edges: Record<string, any> };
    expect(readWorkflow({ ...linked, edges: { ...linked.edges, x: { source: "step_a", target: "step_b", forward_condition: { type: "llm", condition: "x" } } } }).kind).toBe("custom");
    // an unused node
    expect(readWorkflow({ ...w, nodes: { ...w.nodes, lost: { type: "end" } } }).kind).toBe("custom");
  });
});

describe("workflow: the step form", () => {
  it("reads each kind and keeps only what that kind uses", () => {
    const r = stepFromForm(get({ kind: "say", label: " Emergency ", when: "Danger", message: "Call 999.", then: "end", instructions: "stray" }), "agent_own12345");
    expect(r).toEqual({ ok: true, value: { ...blankStep("say"), label: "Emergency", when: "Danger", message: "Call 999.", then: "end" } });
    const p = stepFromForm(get({ kind: "phone", label: "Desk", when: "Person", phone: "+973 1700 0000" }), "");
    expect(p.ok && p.value.phone).toBe("+97317000000");
  });
  it("says what is missing or wrong", () => {
    const own = "agent_own12345";
    expect(stepFromForm(get({ kind: "specialist", when: "x", instructions: "y" }), own)).toEqual({ ok: false, error: "label" });
    expect(stepFromForm(get({ kind: "specialist", label: "x", instructions: "y" }), own)).toEqual({ ok: false, error: "when" });
    expect(stepFromForm(get({ kind: "specialist", label: "x", when: "y" }), own)).toEqual({ ok: false, error: "instructions" });
    expect(stepFromForm(get({ kind: "say", label: "x", when: "y" }), own)).toEqual({ ok: false, error: "message" });
    expect(stepFromForm(get({ kind: "agent", label: "x", when: "y", agentId: "nope" }), own)).toEqual({ ok: false, error: "agent" });
    expect(stepFromForm(get({ kind: "agent", label: "x", when: "y", agentId: own }), own)).toEqual({ ok: false, error: "ownAgent" });
    expect(stepFromForm(get({ kind: "phone", label: "x", when: "y", phone: "17000000" }), own)).toEqual({ ok: false, error: "phone" });
    expect(stepFromForm(get({ kind: "end", label: "x", when: "y".repeat(301) }), own)).toEqual({ ok: false, error: "long" });
  });
  it("new ids never clash", () => {
    let n = 0;
    const seq = [0, 0, 0.5];
    expect(newStepId(["step_000000"], () => seq[n++])).toBe(`step_${Math.floor(0.5 * 36 ** 6).toString(36)}`);
  });
});

describe("workflow: templates and requests", () => {
  it("templates are valid steps in the client's own words", () => {
    for (const id of STEP_TEMPLATES) {
      const s = stepTemplate(id, words);
      const r = stepFromForm(get({ ...(s as unknown as Record<string, string>) }), "");
      expect(r.ok).toBe(true);
      expect(`${s.when} ${s.instructions} ${s.message}`).not.toMatch(/patient|doctor|clinic/i);
    }
    expect(stepTemplate("complaints", words).instructions).toContain("stylists");
  });

  it("reads the agent's workflow and replaces it whole, or clears it", async () => {
    const calls: { method: string; path: string; body: any }[] = [];
    const f = (async (url: string, init: RequestInit = {}) => {
      calls.push({ method: init.method ?? "GET", path: new URL(url).pathname, body: init.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify({ agent_id: "agent_1", workflow: buildWorkflow(steps.slice(0, 1)) }), { status: 200 });
    }) as unknown as typeof fetch;
    const api = createWorkflowApi("k", f);
    expect((await api.read("agent_1")).kind).toBe("simple");
    await api.write("agent_1", buildWorkflow(steps.slice(1, 2)));
    await api.write("agent_1", null);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /v1/convai/agents/agent_1", "PATCH /v1/convai/agents/agent_1", "PATCH /v1/convai/agents/agent_1"]);
    expect(Object.keys(calls[1].body)).toEqual(["workflow"]);
    expect(calls[2].body).toEqual({ workflow: { nodes: {}, edges: {} } });
    await expect(api.read("../x")).rejects.toThrow("bad id");
  });
});
