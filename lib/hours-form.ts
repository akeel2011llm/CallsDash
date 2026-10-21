/** Reads what HoursFields posted, before cleaning. */
export function readHours(f: FormData): Record<string, [string, string][]> {
  const raw: Record<string, [string, string][]> = {};
  const v = (k: string) => String(f.get(k) ?? "").trim();
  for (let d = 0; d < 7; d++)
    raw[String(d)] = (["a", "b"] as const).map((r): [string, string] => [v(`open${d}${r}`), v(`close${d}${r}`)]).filter(([a, b]) => a || b);
  return raw;
}
