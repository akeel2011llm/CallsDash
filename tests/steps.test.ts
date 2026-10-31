import { describe, expect, it } from "vitest";
import { activeTab, firstOpenStep, neighbours, stepProgress, stepStates, type StepInput } from "@/lib/steps";

const phases: StepInput[] = [
  { id: "business", done: true },
  { id: "plan", done: false },
  { id: "people", done: false, needs: ["business"] },
  { id: "assistant", done: false, needs: ["business"] },
  { id: "channels", done: false, needs: ["assistant"] },
];

describe("steps", () => {
  it("resumes at the first unfinished step", () => {
    expect(firstOpenStep(phases)).toBe("plan");
    expect(stepStates(phases).map((s) => s.status)).toEqual(["done", "current", "todo", "todo", "blocked"]);
  });

  it("treats a step that is not needed (a shop with no doctors) as finished", () => {
    const shop = phases.map((s) => (s.id === "people" ? { ...s, skipped: true } : s.id === "plan" ? { ...s, done: true } : s));
    expect(firstOpenStep(shop)).toBe("assistant");
    expect(stepStates(shop).find((s) => s.id === "people")?.status).toBe("skipped");
    expect(stepProgress(shop)).toEqual({ done: 3, total: 5, percent: 60, complete: false });
  });

  it("can show any step on request, and numbers them from 1", () => {
    const st = stepStates(phases, "channels");
    expect(st.map((s) => s.status)).toEqual(["done", "todo", "todo", "todo", "current"]);
    expect(st.map((s) => s.n)).toEqual([1, 2, 3, 4, 5]);
  });

  it("skips a prerequisite that is ready and goes to the first ready step", () => {
    const s: StepInput[] = [{ id: "a", done: false, needs: ["b"] }, { id: "b", done: false }];
    expect(firstOpenStep(s)).toBe("b");
  });

  it("has nothing open when everything is finished", () => {
    const all = phases.map((s) => ({ ...s, done: true }));
    expect(firstOpenStep(all)).toBeNull();
    expect(stepProgress(all).complete).toBe(true);
  });

  it("gives Back and Next", () => {
    expect(neighbours(phases, "business")).toEqual({ prev: null, next: "plan" });
    expect(neighbours(phases, "channels")).toEqual({ prev: "assistant", next: null });
  });
});

describe("activeTab", () => {
  const tabs = [
    { href: "/admin/clients/7", exact: true },
    { href: "/admin/clients/7/setup" },
    { href: "/admin/clients/7/assistant" },
  ];
  it("picks the deepest matching tab", () => {
    expect(activeTab("/admin/clients/7", tabs)).toBe(0);
    expect(activeTab("/admin/clients/7/", tabs)).toBe(0);
    expect(activeTab("/admin/clients/7/setup/business?x=1", tabs)).toBe(1);
    expect(activeTab("/admin/clients/7/assistant/profiles", tabs)).toBe(2);
  });
  it("does not light Overview for a page it only starts", () => {
    expect(activeTab("/admin/clients/7/billing", tabs)).toBe(-1);
    expect(activeTab("/admin/clients/70", tabs)).toBe(-1);
  });
});
