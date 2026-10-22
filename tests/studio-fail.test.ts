import { describe, expect, it } from "vitest";
import { failKey, failRecord, failToShow } from "@/lib/studio-fail";

const now = Date.parse("2026-10-22T10:00:00Z");
const at = (secondsAgo: number) => new Date(now - secondsAgo * 1000).toISOString();

describe("the reason ElevenLabs gave for refusing a save", () => {
  it("is kept per client", () => {
    expect(failKey("t_a")).not.toBe(failKey("t_b"));
  });

  it("is shown for the section it belongs to while it is fresh", () => {
    const saved = failRecord("model", "Unknown model", new Date(now - 30_000));
    expect(failToShow(saved, "model", now)).toBe("Unknown model");
  });

  it("is not shown on another section, once it is old, or when it is damaged", () => {
    const saved = { section: "model", detail: "Unknown model", at: at(30) };
    expect(failToShow(saved, "voice", now)).toBeNull();
    expect(failToShow({ ...saved, at: at(11 * 60) }, "model", now)).toBeNull();
    expect(failToShow({ ...saved, at: at(-60) }, "model", now)).toBeNull(); // from the future
    for (const junk of [undefined, null, 5, "x", [], {}, { section: "model" }, { ...saved, detail: "  " }, { ...saved, detail: 4 }, { ...saved, at: "yesterday" }, { ...saved, section: "nope" }]) {
      expect(failToShow(junk, "model", now)).toBeNull();
    }
  });

  it("keeps a long reason to a reasonable length", () => {
    const saved = failRecord("voice", "x".repeat(2000), new Date(now));
    expect(saved.detail).toHaveLength(300);
    expect(failToShow(saved, "voice", now)).toHaveLength(300);
  });
});
