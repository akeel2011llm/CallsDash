import { diffLines, foldDiff } from "@/lib/text-diff";
import type { text } from "./text";

const MARK = { "only-here": "- ", "only-there": "+ ", same: "  " } as const;

/**
 * Two versions of one text line by line: what CallsDash holds ("-") against what ElevenLabs holds ("+"). Unchanged stretches
 * are folded. Plain HTML, no script; the marks are text, so the difference never depends on colour alone.
 */
export function TextDiff({ here, there, T }: { here: string; there: string | null; T: ReturnType<typeof text> }) {
  if (there === null) return <p className="muted" style={{ margin: 0 }}>{T("studio.live.texts.nothing")}</p>;
  const lines = foldDiff(diffLines(here, there));
  return (
    <div className="stack" style={{ gap: ".4rem" }}>
      <small className="muted">{T("studio.live.texts.legend")}</small>
      <pre className="diff" dir="ltr" tabIndex={0}>
        {lines.map((l, i) => l.kind === "skip"
          ? <span key={i} className="diff-skip">{T("studio.live.texts.skipped", { n: l.count })}</span>
          : <span key={i} className={`diff-${l.kind}`}>{MARK[l.kind]}{l.text}</span>)}
      </pre>
    </div>
  );
}
