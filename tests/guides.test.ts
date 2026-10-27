import { describe, expect, it, vi } from "vitest";
import { GUIDES, GUIDE_IDS, guideOwnerKey, hideGuide, isGuideId, readHidden, showGuide } from "@/lib/guides";
import { dictionaries } from "@/lib/i18n";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
const en = dictionaries.en as Record<string, string>;
const ar = dictionaries.ar as Record<string, string>;

describe("guides", () => {
  it("every guide has a title in English and Arabic", () => {
    for (const id of GUIDE_IDS) { expect(en[GUIDES[id]]).toBeTruthy(); expect(ar[GUIDES[id]]).toBeTruthy(); }
  });

  it("reads only known ids once each, whatever was stored", () => {
    expect(readHidden(["copy", "copy", "nope", 4, "whatsapp"])).toEqual(["copy", "whatsapp"]);
    expect(readHidden(undefined)).toEqual([]);
    expect(readHidden("copy")).toEqual([]);
    expect(isGuideId("__proto__")).toBe(false);
    expect(isGuideId("toString")).toBe(false);
  });

  it("hides and shows one guide without touching the others", () => {
    const hidden = hideGuide(hideGuide([], "copy"), "whatsapp");
    expect(hidden).toEqual(["copy", "whatsapp"]);
    expect(hideGuide(hidden, "copy")).toEqual(hidden);
    expect(showGuide(hidden, "copy")).toEqual(["whatsapp"]);
    expect(showGuide([], "copy")).toEqual([]);
  });

  it("keeps each person's choice apart", () => {
    expect(guideOwnerKey({ role: "admin", userId: "u1" })).not.toBe(guideOwnerKey({ role: "admin", userId: "u2" }));
    expect(guideOwnerKey({ role: "client", tenantId: "a" })).not.toBe(guideOwnerKey({ role: "client", tenantId: "b" }));
    expect(guideOwnerKey({ role: "admin" })).not.toBe(guideOwnerKey({ role: "client", tenantId: "a" }));
  });
});
