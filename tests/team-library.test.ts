import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { TEAM_LIBRARY, findDepartmentByName, findRoleByName, searchDepartments, searchRoles, suggestedGroups, teamGroup } from "@/lib/team-library";
import { BUSINESS_KINDS, departmentsOf, MAX_ROLES } from "@/lib/business-types";
import { buildPrompt } from "@/lib/agent-config";
import { agent } from "@/lib/seed";
import { dictionaries } from "@/lib/i18n";

const arabic = /[؀-ۿ]/;

describe("roles and departments library", () => {
  it("has a group for every kind of business, shops and every business", () => {
    const keys = TEAM_LIBRARY.map((g) => g.key);
    for (const k of Object.keys(BUSINESS_KINDS)) expect(keys).toContain(k);
    expect(keys).toEqual(expect.arrayContaining(["general", "retail"]));
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("gives each group plenty of roles and departments, in English and Arabic, with unique keys", () => {
    for (const g of TEAM_LIBRARY) {
      expect(g.roles.length, g.key).toBeGreaterThanOrEqual(12);
      expect(g.departments.length, g.key).toBeGreaterThanOrEqual(10);
      expect(new Set(g.roles.map((r) => r.key)).size).toBe(g.roles.length);
      expect(new Set(g.departments.map((d) => d.key)).size).toBe(g.departments.length);
      for (const r of g.roles) {
        expect(r.one && r.many, r.key).toBeTruthy();
        expect(arabic.test(r.oneAr) && arabic.test(r.manyAr), r.key).toBe(true);
        expect(r.one.length).toBeLessThanOrEqual(40);
        expect(r.oneAr.length).toBeLessThanOrEqual(40);
      }
      for (const d of g.departments) expect(arabic.test(d.ar) && d.en.length > 0, d.key).toBe(true);
    }
    expect(TEAM_LIBRARY.reduce((n, g) => n + g.roles.length, 0)).toBeGreaterThan(300);
  });
  it("has the garage departments asked for", () => {
    const garage = teamGroup("carService")!.departments.map((d) => d.en);
    expect(garage).toEqual(expect.arrayContaining(["Denting", "Painting", "Body shop", "Electric", "A/C", "Mechanic"]));
  });
  it("suggests the client's kind first, then every business", () => {
    expect(suggestedGroups("dental").map((g) => g.key)).toEqual(["dental", "general"]);
    expect(suggestedGroups("retail").map((g) => g.key)).toEqual(["retail", "general"]);
    expect(suggestedGroups("custom").map((g) => g.key)).toEqual(["general"]);
  });
  it("searches in English and Arabic, with a kind filter, each name once", () => {
    expect(searchRoles("nurse").some((r) => r.one === "Nurse")).toBe(true);
    expect(searchRoles("ممرض").some((r) => r.one === "Nurse")).toBe(true);
    expect(searchRoles("nurse").filter((r) => r.one === "Nurse")).toHaveLength(1);
    expect(searchDepartments("سمكرة").map((d) => d.en)).toContain("Denting");
    expect(searchDepartments("", "carService")).toHaveLength(teamGroup("carService")!.departments.length);
    // hamza and ta marbuta spelled loosely still match
    expect(searchDepartments("الاطفال").length).toBeGreaterThan(0);
  });
  it("finds a name typed in either language", () => {
    expect(findRoleByName("mechanic")?.oneAr).toBe("ميكانيكي");
    expect(findRoleByName("ميكانيكي")?.one).toBe("Mechanic");
    expect(findDepartmentByName("Painting")?.ar).toBe("الصبغ");
    expect(findRoleByName("Space pilot")).toBeUndefined();
  });
  it("has the page's texts in both languages", () => {
    const en = dictionaries.en as Record<string, string>, ar = dictionaries.ar as Record<string, string>;
    for (const k of Object.keys(en).filter((x) => x.startsWith("teamlib.") || x.startsWith("team.department"))) expect(ar[k], k).toBeTruthy();
  });
});

describe("departments on a client", () => {
  const tenant = { business: { type: "service" as const, departments: [{ key: "denting", en: "Denting", ar: "السمكرة", about: "dents and scratches" }, { key: "Bad key", en: "x", ar: "x" }] } };
  it("keeps only well-formed departments", () => {
    expect(departmentsOf(tenant).map((d) => d.key)).toEqual(["denting"]);
    expect(departmentsOf(null)).toEqual([]);
    expect(MAX_ROLES).toBeGreaterThanOrEqual(40);
  });
  it("tells the assistant the departments and who works in each", () => {
    const p = buildPrompt(agent("", "Garage"), [{ id: "d1", name: "Ali", specialty: "", active: true, department: "denting" }, { id: "d2", name: "Sara", specialty: "", active: true }], tenant);
    expect(p).toContain("Denting (in Arabic السمكرة): dents and scratches");
    expect(p).toMatch(/- Ali \[department: Denting\]/);
    expect(p).toMatch(/- Sara \(doctor_id/);
  });
});
