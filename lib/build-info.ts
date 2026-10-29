/**
 * Which update (pull request) this running copy of the app was built from, so the owner can see during the alpha stage whether a
 * change has arrived. Vercel gives each build its commit message ("Merge pull request #39 from ..." or "Title (#39)") and its commit id.
 */
export interface BuildInfo { pr: string | null; sha: string | null; title: string | null; preview: boolean }

export function prNumberOf(message: string | undefined | null): string | null {
  const m = /#(\d{1,6})\b/.exec(message ?? "");
  return m ? m[1] : null;
}

export function buildInfo(env: Record<string, string | undefined> = process.env): BuildInfo {
  const message = env.VERCEL_GIT_COMMIT_MESSAGE ?? "";
  const preview = env.VERCEL_ENV === "preview";
  const pr = (preview ? env.VERCEL_GIT_PULL_REQUEST_ID : undefined) || prNumberOf(message);
  const sha = env.VERCEL_GIT_COMMIT_SHA ? env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) : null;
  // a merge commit's first line only says "Merge pull request"; the real title is on the next line
  const lines = message.split("\n").map((l) => l.trim()).filter(Boolean);
  const title = (/^Merge pull request/i.test(lines[0] ?? "") ? lines[1] : lines[0])?.slice(0, 120) || null;
  return { pr, sha, title, preview };
}
