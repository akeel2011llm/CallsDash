import { describe, expect, it } from "vitest";
import { SECTIONS, readAccess, sectionOf, sectionsFor, sectionsFromForm, withList } from "@/lib/access";

describe("access per person", () => {
  it("managers see everything; nothing set means everything", () => {
    expect(sectionsFor({ receptionist: [] }, "manager", "u1")).toEqual([...SECTIONS]);
    expect(sectionsFor({}, "receptionist", "u1")).toEqual([...SECTIONS]);
  });
  it("a person's own list beats the receptionist default", () => {
    const r = { receptionist: ["inbox", "bookings"] as const, people: { u1: ["customers"] as const } };
    const rules = readAccess(JSON.parse(JSON.stringify(r)));
    expect(sectionsFor(rules, "receptionist", "u1")).toEqual(["customers"]);
    expect(sectionsFor(rules, "receptionist", "u2")).toEqual(["inbox", "bookings"]);
    expect(sectionsFor(rules, "receptionist")).toEqual(["inbox", "bookings"]);
  });
  it("reads only known sections and safe ids", () => {
    expect(readAccess({ receptionist: ["inbox", "hack"], people: { "../x": ["inbox"], u1: "no", u2: ["billing", "billing"] } }))
      .toEqual({ receptionist: ["inbox"], people: { u2: ["billing"] } });
    expect(readAccess(null)).toEqual({});
  });
  it("saves and removes lists", () => {
    let r = withList({}, "receptionist", ["inbox"]);
    r = withList(r, "u1", ["reports"]);
    expect(r).toEqual({ receptionist: ["inbox"], people: { u1: ["reports"] } });
    r = withList(r, "u1", null);
    expect(r).toEqual({ receptionist: ["inbox"] });
    expect(withList(r, "receptionist", null)).toEqual({});
  });
  it("knows which section an address is in", () => {
    expect(sectionOf("/app")).toBeNull();
    expect(sectionOf("/app/settings")).toBeNull();
    expect(sectionOf("/app/messages?x=1")).toBe("inbox");
    expect(sectionOf("/app/bookings/b1")).toBe("bookings");
    expect(sectionOf("/app/doctors")).toBe("bookings");
    expect(sectionOf("/app/customers/c1")).toBe("customers");
    expect(sectionOf("/app/tables/t1")).toBe("catalog");
    expect(sectionOf("/app/assistant")).toBe("assistant");
    expect(sectionOf("/app/credits")).toBe("billing");
    expect(sectionOf("/app/creditsx")).toBeNull();
  });
  it("reads the ticked boxes", () => {
    const f: Record<string, string> = { s_inbox: "on", s_billing: "on", s_x: "on" };
    expect(sectionsFromForm((k) => f[k])).toEqual(["inbox", "billing"]);
  });
});
