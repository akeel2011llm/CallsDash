import { describe, expect, it } from "vitest";
import { MAX_DIFF_LINES, changedLines, diffLines, foldDiff, normalizeText } from "@/lib/text-diff";

const kinds = (s: ReturnType<typeof diffLines>) => s.map((l) => `${l.kind === "same" ? " " : l.kind === "only-here" ? "-" : "+"}${l.text}`);

describe("normalizeText", () => {
  it("ignores line endings, runs of spaces and spaces at the ends of lines", () => {
    expect(normalizeText("# Role\r\nYou  are   the receptionist.  \r\n\r\n- one\t two\n")).toBe("# Role\nYou are the receptionist.\n\n- one two");
    expect(normalizeText("  \n x \n  ")).toBe("x");
  });
});

describe("diffLines", () => {
  it("finds nothing to show when the texts are the same, even with other whitespace", () => {
    const d = diffLines("a\nb\nc", "a  \r\nb\r\nc");
    expect(d.every((l) => l.kind === "same")).toBe(true);
    expect(changedLines(d)).toBe(0);
  });

  it("shows a changed line as the old line followed by the new one", () => {
    expect(kinds(diffLines("# Role\nYou are the receptionist.\n# Style", "# Role\nYou are Sara, the receptionist.\n# Style")))
      .toEqual([" # Role", "-You are the receptionist.", "+You are Sara, the receptionist.", " # Style"]);
  });

  it("shows lines added at the end and removed from the start", () => {
    expect(kinds(diffLines("a\nb", "a\nb\nAlways say: Right..."))).toEqual([" a", " b", "+Always say: Right..."]);
    expect(kinds(diffLines("first\nsecond\nthird", "second\nthird"))).toEqual(["-first", " second", " third"]);
  });

  it("keeps order when several places differ", () => {
    expect(kinds(diffLines("a\nb\nc\nd\ne", "a\nB\nc\nd\ne\nf"))).toEqual([" a", "-b", "+B", " c", " d", " e", "+f"]);
  });

  it("compares an empty text with a full one", () => {
    expect(kinds(diffLines("", "x\ny"))).toEqual(["-", "+x", "+y"]);
    expect(changedLines(diffLines("x", ""))).toBe(2);
  });

  it("does not freeze on a huge text: it lists both sides whole", () => {
    const big = Array.from({ length: MAX_DIFF_LINES + 1 }, (_, i) => `line ${i}`).join("\n");
    const d = diffLines(big, "line 0");
    expect(d.filter((l) => l.kind === "only-here")).toHaveLength(MAX_DIFF_LINES + 1);
    expect(d.filter((l) => l.kind === "only-there")).toHaveLength(1);
  });

  it("handles a realistic prompt-sized text quickly", () => {
    const a = Array.from({ length: 400 }, (_, i) => `- rule ${i}`);
    const b = [...a]; b[200] = "- rule 200 changed"; b.splice(300, 0, "- added rule");
    const t = Date.now();
    const d = diffLines(a.join("\n"), b.join("\n"));
    expect(Date.now() - t).toBeLessThan(1000);
    expect(changedLines(d)).toBe(3);
  });
});

describe("foldDiff", () => {
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `l${i}`);

  it("keeps context around a change and folds the rest", () => {
    const a = lines(20).join("\n");
    const b = lines(20).map((l, i) => (i === 10 ? "changed" : l)).join("\n");
    const folded = foldDiff(diffLines(a, b), 2);
    expect(folded[0]).toEqual({ kind: "skip", count: 8 });
    expect(folded.filter((l) => l.kind !== "skip").map((l) => ("text" in l ? l.text : ""))).toEqual(["l8", "l9", "l10", "changed", "l11", "l12"]);
    expect(folded[folded.length - 1]).toEqual({ kind: "skip", count: 7 });
  });

  it("folds identical texts into one entry and keeps a change at the very start or end whole", () => {
    expect(foldDiff(diffLines(lines(5).join("\n"), lines(5).join("\n")))).toEqual([{ kind: "skip", count: 5 }]);
    const edge = foldDiff(diffLines("x\n" + lines(10).join("\n"), lines(10).join("\n")), 1);
    expect(edge[0]).toMatchObject({ kind: "only-here", text: "x" });
    expect(edge[1]).toMatchObject({ kind: "same", text: "l0" });
    expect(edge[2]).toEqual({ kind: "skip", count: 9 });
  });
});
