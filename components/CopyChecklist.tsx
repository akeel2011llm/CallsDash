import type { Key } from "@/lib/i18n";

type T = (k: Key) => string;
const ITEMS = ["agent", "calendar", "channels", "people", "credits", "texts", "website"] as const;

/** What an admin must do or avoid after copying a client; shown before the copy is made and again after it. */
export function CopyChecklist({ t }: { t: T }) {
  return (
    <ol className="stack" style={{ gap: ".5rem", margin: 0, paddingInlineStart: "1.2rem" }}>
      {ITEMS.map((k) => <li key={k}>{t(`dup.c.${k}` as Key)}</li>)}
    </ol>
  );
}
