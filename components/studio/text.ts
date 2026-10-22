import { fill } from "@/lib/format";

/** The translated texts a studio component needs, passed down from the page as `{ key: text }`. */
export type Labels = Record<string, string>;

/** Looks a text up and fills its {placeholders}. An unknown key shows itself, so a missing translation is easy to spot. */
export const text = (labels: Labels) => (key: string, vars?: Record<string, string | number>) => {
  const s = labels[key] ?? key;
  return vars ? fill(s, vars) : s;
};
