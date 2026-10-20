import { describe, expect, it } from "vitest";
import { domainKey, findDuplicate, nameKey } from "@/lib/tenant-keys";

const clinic = { name: "Al Noor Clinic", branding: { displayName: "Al Noor Clinic", displayNameAr: "", primaryColor: "#000", domain: "alnoor.example.bh" }, allowedDomains: ["alnoor.example.bh"] };

describe("tenant keys", () => {
  it("compares names ignoring case and spacing", () => expect(nameKey("  Al   NOOR clinic ")).toBe(nameKey("al noor clinic")));
  it("reduces website addresses to the host", () => {
    for (const v of ["https://www.Clinic.bh/contact?x=1", "http://clinic.bh:8080/", "clinic.bh", "WWW.CLINIC.BH.", "https://user@clinic.bh/a#b"]) expect(domainKey(v)).toBe("clinic.bh");
    expect(domainKey("")).toBe("");
  });
  it("finds a clashing name or website, and ignores blanks", () => {
    expect(findDuplicate([clinic], { name: "al noor  CLINIC" })).toBe("name");
    expect(findDuplicate([clinic], { name: "Other", domains: ["https://www.alnoor.example.bh/book"] })).toBe("domain");
    expect(findDuplicate([clinic], { name: "Other", domains: ["other.bh"] })).toBeNull();
    expect(findDuplicate([clinic], { name: "Other", domains: [""] })).toBeNull();
    expect(findDuplicate([], { name: "Anything" })).toBeNull();
  });
});
