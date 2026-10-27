import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { dictionaries } from "@/lib/i18n";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const PORTALS = [
  { layout: "app/(admin)/admin/layout.tsx", page: "app/(admin)/admin/settings/page.tsx", href: "/admin/settings" },
  { layout: "app/(client)/app/layout.tsx", page: "app/(client)/app/settings/page.tsx", href: "/app/settings" },
  { layout: "app/(doctor)/doctor/layout.tsx", page: "app/(doctor)/doctor/settings/page.tsx", href: "/doctor/settings" },
];

describe("Settings in every portal", () => {
  it.each(PORTALS)("$href is in the menu and has a page", ({ layout, page, href }) => {
    expect(read(layout)).toContain(`href: "${href}"`);
    expect(read(page)).toContain("SettingsPage");
  });

  it("is named in English and Arabic", () => {
    expect(dictionaries.en["nav.settings"]).toBe("Settings");
    expect(/[؀-ۿ]/.test(dictionaries.ar["nav.settings"])).toBe(true);
  });

  it("makes the logo and name open the first page of the menu, also in the phone's top bar", () => {
    const shell = read("components/Shell.tsx");
    expect(shell).toContain("nav[0]?.href");
    expect(shell).toMatch(/<Link className="brand" href=\{home\}/);
    expect(read("components/ShellFrame.tsx")).toMatch(/<Link href=\{home\} className="topbar-home">/);
  });
});
