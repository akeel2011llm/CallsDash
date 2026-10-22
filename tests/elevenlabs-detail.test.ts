import { describe, expect, it } from "vitest";
import { ElevenLabsError, plainDetail } from "@/lib/elevenlabs-api";

const said = (status: number, body: unknown) => new ElevenLabsError(status, typeof body === "string" ? body : JSON.stringify(body)).message;

describe("what ElevenLabs said, in words an admin can read", () => {
  it("picks the message and the setting out of a validation error", () => {
    const m = said(422, { detail: [{ type: "value_error", loc: ["body", "conversation_config", "agent", "prompt", "llm"], msg: "Model is not available on your plan", input: "x" }] });
    expect(plainDetail(m)).toBe("Model is not available on your plan (conversation_config.agent.prompt.llm)");
  });

  it("joins several problems", () => {
    const m = said(422, { detail: [{ loc: ["body", "a"], msg: "Too long" }, { loc: ["body", "list", 2], msg: "Not allowed" }] });
    expect(plainDetail(m)).toBe("Too long (a); Not allowed (list.2)");
  });

  it("reads the message of an error object, and falls back to its status", () => {
    expect(plainDetail(said(401, { detail: { status: "invalid_api_key", message: "Invalid API key" } }))).toBe("Invalid API key");
    expect(plainDetail(said(400, { detail: { status: "bad_request" } }))).toBe("bad_request");
    expect(plainDetail(said(400, { detail: "Plain text detail" }))).toBe("Plain text detail");
  });

  it("leaves text that is not JSON, or has nothing to pick out, as it came", () => {
    const text = said(500, "Internal Server Error");
    expect(plainDetail(text)).toBe(text);
    for (const body of [{}, { detail: [] }, { detail: [{}] }, { detail: null }, [1, 2], "null", "5"]) {
      const m = said(400, body);
      expect(plainDetail(m)).toBe(m);
    }
    expect(plainDetail("could not reach ElevenLabs")).toBe("could not reach ElevenLabs");
    expect(plainDetail("")).toBe("");
  });
});
