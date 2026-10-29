import { describe, expect, it } from "vitest";
import { buildInfo, prNumberOf } from "../lib/build-info";

describe("build info", () => {
  it("reads the pull request number from a merge or squash commit message", () => {
    expect(prNumberOf("Merge pull request #39 from akeel2011llm/claude/x\n\nShow the photo")).toBe("39");
    expect(prNumberOf("Show the photo over the chat (#40)")).toBe("40");
    expect(prNumberOf("no number here")).toBeNull();
    expect(prNumberOf(undefined)).toBeNull();
  });

  it("gives the real title of a merge commit, the commit id and the preview flag", () => {
    const b = buildInfo({ VERCEL_GIT_COMMIT_MESSAGE: "Merge pull request #39 from a/b\n\nShow the photo over the chat", VERCEL_GIT_COMMIT_SHA: "4e2dc32aabbcc", VERCEL_ENV: "production" });
    expect(b).toEqual({ pr: "39", sha: "4e2dc32", title: "Show the photo over the chat", preview: false });
  });

  it("prefers the pull request id on a preview and shows nothing made up when Vercel gives nothing", () => {
    expect(buildInfo({ VERCEL_ENV: "preview", VERCEL_GIT_PULL_REQUEST_ID: "41", VERCEL_GIT_COMMIT_MESSAGE: "Fix (#12)" }).pr).toBe("41");
    expect(buildInfo({})).toEqual({ pr: null, sha: null, title: null, preview: false });
  });
});
