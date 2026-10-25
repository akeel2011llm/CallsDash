/**
 * A line-by-line comparison of two texts, for showing how the instructions or greeting in ElevenLabs differ from the ones
 * CallsDash holds (Assistant studio, "Live in ElevenLabs"). Pure, so it is tested without a screen.
 */
export type DiffKind = "same" | "only-here" | "only-there";
export interface DiffLine { kind: DiffKind; text: string }
/** A run of unchanged lines left out of the view. */
export interface SkippedLines { kind: "skip"; count: number }

/** Beyond this many lines a side is not compared line by line, so a huge text can never freeze the page. */
export const MAX_DIFF_LINES = 1500;

/** Line endings and runs of spaces are not differences: ElevenLabs may store the same text with other whitespace. */
export const normalizeText = (s: string) => s.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).join("\n").trim();

/**
 * The lines only in `here` ("only-here"), only in `there` ("only-there") and in both ("same"), in reading order. A changed
 * line shows as the old one followed by the new one.
 */
export function diffLines(here: string, there: string): DiffLine[] {
  const a = normalizeText(here).split("\n");
  const b = normalizeText(there).split("\n");
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    return [...a.map((text) => ({ kind: "only-here" as const, text })), ...b.map((text) => ({ kind: "only-there" as const, text }))];
  }
  const n = a.length, m = b.length, w = m + 1;
  // lcs[i * w + j] = length of the longest common run of lines in a[i..] and b[j..]
  const lcs = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) lcs[i * w + j] = a[i] === b[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
  }
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ kind: "same", text: a[i] }); i++; j++; }
    else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) out.push({ kind: "only-here", text: a[i++] });
    else out.push({ kind: "only-there", text: b[j++] });
  }
  while (i < n) out.push({ kind: "only-here", text: a[i++] });
  while (j < m) out.push({ kind: "only-there", text: b[j++] });
  return out;
}

/** How many lines differ (a changed line counts twice: the old one and the new one). */
export const changedLines = (lines: DiffLine[]) => lines.filter((l) => l.kind !== "same").length;

/** Keeps each changed line with `context` lines around it and folds the long unchanged stretches into one "skip" entry. */
export function foldDiff(lines: DiffLine[], context = 2): (DiffLine | SkippedLines)[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((l, i) => {
    if (l.kind === "same") return;
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true;
  });
  const out: (DiffLine | SkippedLines)[] = [];
  let skipped = 0;
  lines.forEach((l, i) => {
    if (keep[i]) {
      if (skipped) { out.push({ kind: "skip", count: skipped }); skipped = 0; }
      out.push(l);
    } else skipped++;
  });
  if (skipped) out.push({ kind: "skip", count: skipped });
  return out;
}
