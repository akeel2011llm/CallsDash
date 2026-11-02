import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { navActive } from "@/lib/nav";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

describe("menu items that stand for several pages", () => {
  it("stays active on the pages listed in also", () => {
    const also = ["/app/attention", "/app/messages"];
    expect(navActive("/app/conversations", "/app/conversations", false, also)).toBe(true);
    expect(navActive("/app/conversations/c_1", "/app/conversations", false, also)).toBe(true);
    expect(navActive("/app/attention", "/app/conversations", false, also)).toBe(true);
    expect(navActive("/app/messages", "/app/conversations", false, also)).toBe(true);
    expect(navActive("/app/messagesx", "/app/conversations", false, also)).toBe(false);
    expect(navActive("/app/bookings", "/app/conversations", false, also)).toBe(false);
  });

  it("an exact item ignores everything else", () => {
    expect(navActive("/app", "/app", true)).toBe(true);
    expect(navActive("/app/bookings", "/app", true, ["/app/bookings"])).toBe(false);
  });
});

describe("client portal menu (milestone 6)", () => {
  const layout = read("app/(client)/app/layout.tsx");
  const items = [...layout.matchAll(/href: "([^"]+)", label/g)].map((m) => m[1]);

  it("has nine items in the order a front desk works (2026-11-02)", () => {
    expect(items).toEqual(["/app", "/app/conversations", "/app/bookings", "/app/customers", "/app/catalogue", "/app/assistant", "/app/reports", "/app/credits", "/app/settings"]);
  });

  it("every section is guarded where it is opened", () => {
    for (const [g, s] of Object.entries({ inbox: "inbox", bookings: "bookings", catalog: "catalog", assistant: "assistant" })) expect(read(`app/(client)/app/(${g})/layout.tsx`)).toContain(`requireSection("${s}")`);
    for (const [d, s] of Object.entries({ credits: "billing", customers: "customers", reports: "reports" })) expect(read(`app/(client)/app/${d}/layout.tsx`)).toContain(`requireSection("${s}")`);
  });

  it("reaches every former menu page through a group tab", () => {
    const tabs = read("components/ClientTabs.tsx");
    for (const p of ["/app/knowledge", "/app/attention", "/app/messages", "/app/calendar", "/app/doctors", "/app/data", "/app/agent", "/app/voice", "/app/website", "/app/team"]) {
      expect(tabs, p).toContain(`"${p}"`);
      expect(layout, p).toContain(`"${p}"`); // in the item's also list, so the menu item stays lit
    }
  });

  it("keeps every grouped page at its old address (route groups add no URL segment)", () => {
    for (const [g, pages] of Object.entries({ inbox: ["conversations", "attention", "messages"], bookings: ["bookings", "calendar", "doctors"], catalog: ["catalogue", "data"], assistant: ["assistant", "knowledge", "agent", "voice", "website"], settings: ["settings", "team"] })) {
      expect(read(`app/(client)/app/(${g})/layout.tsx`)).toContain(`group="${g}"`);
      for (const p of pages) expect(existsSync(join(__dirname, "..", `app/(client)/app/(${g})/${p}/page.tsx`)), p).toBe(true);
    }
  });
});
