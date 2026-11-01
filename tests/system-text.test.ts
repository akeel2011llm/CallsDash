import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { dictionaries } from "@/lib/i18n";
import { systemText } from "@/lib/system-text";
import { fill } from "@/lib/format";

const tr = (loc: "en" | "ar") => (k: string, v?: Record<string, string | number>) => fill((dictionaries[loc] as Record<string, string>)[k] ?? k, v ?? {});

describe("lines CallsDash writes in English, shown in the reader's language", () => {
  it("translates the known lines", () => {
    expect(systemText("Low credit balance: 9.5 credits left (9.5% of last top-up).", tr("ar"))).toBe("رصيد منخفض: تبقّى 9.5 رصيد.");
    expect(systemText("Low credit balance: 12 credits left.", tr("en"))).toBe("Low credit balance: 12 credits left.");
    expect(systemText("Rollover from previous month (Clinic package)", tr("ar"))).toBe("رصيد مُرحّل من الشهر السابق (Clinic package)");
    expect(systemText("Rollover from previous month", tr("en"))).toBe("Rollover from previous month");
    expect(systemText("ElevenLabs sent an empty model list.", tr("ar"))).toBe("أرسل ElevenLabs قائمة نماذج فارغة.");
  });
  it("leaves anything else as it is", () => {
    expect(systemText("Bought 500 credits", tr("ar"))).toBe("Bought 500 credits");
    expect(systemText(undefined, tr("ar"))).toBe("");
  });
});
