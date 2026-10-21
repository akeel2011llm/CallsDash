import { describe, expect, it } from "vitest";
import { badHeaderSetting, headerSafe } from "@/lib/header-safe";

describe("settings that travel in a header", () => {
  it("accepts plain letters, digits and symbols", () => {
    expect(headerSafe("aB3-_xYz9.QwErTy1234567890")).toBe(true);
  });
  it("refuses a curly quote, a hidden character, a space or a line break", () => {
    expect(headerSafe("abc’def")).toBe(false); // ’
    expect(headerSafe("abc​def")).toBe(false); // zero-width space
    expect(headerSafe("abc def")).toBe(false);
    expect(headerSafe("abcdef\n")).toBe(false);
    expect(headerSafe("سر")).toBe(false);
    expect(headerSafe("")).toBe(false);
    expect(headerSafe(undefined)).toBe(false);
  });
  it("names the first setting that is set but cannot be sent, and ignores unset ones", () => {
    expect(badHeaderSetting({ AGENT_TOOLS_SECRET: "good1234", ELEVENLABS_API_KEY: "sk_ok" })).toBeUndefined();
    expect(badHeaderSetting({ AGENT_TOOLS_SECRET: "good…bad" })).toBe("AGENT_TOOLS_SECRET");
    expect(badHeaderSetting({})).toBeUndefined();
    expect(badHeaderSetting({ ELEVENLABS_INIT_SECRET: "x y" })).toBe("ELEVENLABS_INIT_SECRET");
  });
  it("is what makes fetch fail: the browser-style error from the report", async () => {
    await expect(fetch("http://localhost:1/", { headers: { authorization: `Bearer ${"a".repeat(48)}…` } })).rejects.toThrow(/ByteString/);
  });
});
