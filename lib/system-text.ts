/**
 * Lines CallsDash writes into the data in English (alerts, ledger notes, an ElevenLabs problem), shown in the reader's
 * language. Text it does not recognise is shown as stored.
 */
type Tr = (key: string, vars?: Record<string, string | number>) => string;

const RULES: { re: RegExp; key: string; vars: (m: RegExpMatchArray) => Record<string, string> }[] = [
  { re: /^Rollover from previous month(?: \((.+)\))?\.?$/, key: "sys.rollover", vars: (m) => ({ plan: m[1] ?? "" }) },
  { re: /^Low credit balance: ([\d.]+) credits left(?: \([\d.]+% of last top-up\))?\.$/, key: "sys.lowCredit", vars: (m) => ({ n: m[1] }) },
  { re: /^ElevenLabs sent an empty model list\.$/, key: "sys.emptyModels", vars: () => ({}) },
];

export function systemText(text: string | null | undefined, t: Tr): string {
  const s = (text ?? "").trim();
  for (const r of RULES) {
    const m = s.match(r.re);
    if (m) {
      const out = t(r.key, r.vars(m));
      return r.key === "sys.rollover" && !m[1] ? out.replace(/\s*\(\)\s*$/, "").replace(/\s*\(\s*\)/, "") : out;
    }
  }
  return text ?? "";
}
