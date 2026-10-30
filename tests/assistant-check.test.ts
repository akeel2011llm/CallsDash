import { describe, expect, it } from "vitest";
import { assistantChecks } from "@/lib/assistant-check";
import { AGENT_VERSION } from "@/lib/agent-config";

const base = {
  agentId: "agent_1",
  doctors: [{ active: true, photoAt: "2026-10-30T10:00:00Z" }],
  items: [{ active: true, hasImage: true }],
  calls: [{ tool: "find_item", ok: true, at: "2026-10-30T11:00:00Z", detail: "query=dr -> 1 found" }],
};
const el = (x: object) => ({ integrations: { elevenlabs: { version: AGENT_VERSION, syncedAt: "2026-10-30T10:30:00Z", ...x } } }) as never;
const state = (r: ReturnType<typeof assistantChecks>, id: string) => r.find((c) => c.id === id)?.state;

describe("assistant check", () => {
  it("is all good for an up-to-date managed assistant with photos", () => {
    expect(assistantChecks({ ...base, tenant: el({}) }).every((c) => c.state === "ok")).toBe(true);
  });
  it("says to create the assistant when there is none", () => {
    expect(assistantChecks({ ...base, agentId: undefined, tenant: el({}) })).toEqual([{ id: "agent", state: "bad" }]);
  });
  it("flags an assistant connected by ID, which never receives the photo tools", () => {
    const r = assistantChecks({ ...base, tenant: el({ managed: false, version: 1 }) });
    expect(state(r, "managed")).toBe("bad");
    expect(state(r, "version")).toBeUndefined();
  });
  it("flags old rules, a failed update and doctor photos added after the last update", () => {
    const r = assistantChecks({ ...base, tenant: el({ version: AGENT_VERSION - 1, error: "401", syncedAt: "2026-10-30T09:00:00Z" }) });
    expect(state(r, "version")).toBe("bad");
    expect(state(r, "syncError")).toBe("bad");
    expect(r.find((c) => c.id === "fresh")).toMatchObject({ state: "warn", vars: { n: 1 } });
  });
  it("counts photos, hidden items and the last lookup", () => {
    const r = assistantChecks({
      ...base, tenant: el({}), doctors: [{ active: false, photoAt: "2026-10-30T10:00:00Z" }], items: [{ active: false, hasImage: true }],
      calls: [{ tool: "find_item", ok: true, at: "2026-10-30T09:00:00Z", detail: "a" }, { tool: "find_item", ok: false, at: "2026-10-30T12:00:00Z", detail: "b" }],
    });
    expect(state(r, "photos")).toBe("warn");
    expect(state(r, "hidden")).toBe("warn");
    expect(r.find((c) => c.id === "lookups")).toMatchObject({ state: "bad", vars: { detail: "b" } });
    expect(state(assistantChecks({ ...base, tenant: el({}), calls: [] }), "lookups")).toBe("warn");
  });
});
