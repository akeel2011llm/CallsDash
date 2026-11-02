import { describe, expect, it } from "vitest";
import { SERVICE_LIBRARY, libraryService, libraryType } from "@/lib/service-library";
import { addFromLibrary, readServices, serviceFromForm, serviceName, servicesText } from "@/lib/services";

const get = (o: Record<string, string>) => (k: string) => o[k] ?? "";

describe("services library", () => {
  it("has 20 kinds of business with 15 services each, in English and Arabic", () => {
    expect(SERVICE_LIBRARY).toHaveLength(20);
    const keys = new Set<string>();
    for (const t of SERVICE_LIBRARY) {
      expect(t.services, t.key).toHaveLength(15);
      expect(t.ar).toMatch(/[؀-ۿ]/);
      for (const s of t.services) {
        expect(s.ar, s.key).toMatch(/[؀-ۿ]/);
        expect(s.en, s.key).not.toMatch(/[؀-ۿ]/);
        expect(s.minutes).toBeGreaterThanOrEqual(5);
        expect(s.minutes).toBeLessThanOrEqual(600);
        expect(keys.has(s.key), s.key).toBe(false);
        keys.add(s.key);
      }
    }
    expect(new Set(SERVICE_LIBRARY.map((t) => t.key)).size).toBe(20);
    expect(libraryType("dental")?.ar).toBe("عيادة أسنان");
    expect(libraryService("ladies.manicure")?.ar).toBe("مانيكير");
  });
});

describe("a client's services", () => {
  it("adds from the library once, keeping both names and the length", () => {
    const dental = libraryType("dental")!.services.slice(0, 3);
    let n = 0;
    const r1 = addFromLibrary([], dental, () => (n++ % 1000) / 1000);
    expect(r1.added).toBe(3);
    expect(r1.list[1]).toMatchObject({ name: "Cleaning and polishing", nameAr: "تنظيف وتلميع الأسنان", minutes: 45, active: true, from: "dental.cleaning-and-polishing" });
    const r2 = addFromLibrary(r1.list, libraryType("dental")!.services.slice(0, 4));
    expect(r2.added).toBe(1);
    expect(new Set(r2.list.map((s) => s.id)).size).toBe(4);
  });
  it("reads the form and says what is wrong", () => {
    expect(serviceFromForm(get({ name: "  Haircut ", nameAr: "قص", minutes: "30", price: "BHD 5" }))).toEqual({ ok: true, value: { name: "Haircut", nameAr: "قص", minutes: 30, price: "BHD 5", active: true } });
    expect(serviceFromForm(get({ minutes: "30" }))).toEqual({ ok: false, error: "name" });
    expect(serviceFromForm(get({ name: "x", minutes: "1" }))).toEqual({ ok: false, error: "minutes" });
  });
  it("reads only sound stored rows", () => {
    expect(readServices([{ id: "svc_1", name: "A", minutes: 9999 }, { id: "bad id", name: "B" }, { id: "svc_1", name: "dup" }, null])).toEqual([
      { id: "svc_1", name: "A", nameAr: "", minutes: 600, price: "", active: true },
    ]);
    expect(readServices("x")).toEqual([]);
  });
  it("names and tells the assistant only what is offered", () => {
    const list = readServices([{ id: "a", name: "Haircut", nameAr: "قص الشعر", minutes: 30, price: "BHD 5" }, { id: "b", name: "Old", minutes: 10, active: false }]);
    expect(serviceName(list[0], "ar")).toBe("قص الشعر");
    expect(serviceName({ name: "X", nameAr: "" }, "ar")).toBe("X");
    const text = servicesText(list);
    expect(text).toContain("- Haircut (قص الشعر): about 30 minutes, price BHD 5");
    expect(text).not.toContain("Old");
    expect(servicesText([])).toBe("");
  });
});
