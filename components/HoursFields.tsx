import type { Key } from "@/lib/i18n";

/** Two opening intervals per weekday, Saturday first. Field names are `open{day}{a|b}` and `close{day}{a|b}`. */
export function HoursFields({ hours, t }: { hours: Record<string, [string, string][]>; t: (k: Key) => string }) {
  return (
    <>
      {[6, 0, 1, 2, 3, 4, 5].map((d) => {
        const day = hours[String(d)] ?? [];
        return (
          <div key={d} className="row" style={{ alignItems: "end" }}>
            <strong style={{ minInlineSize: 110 }}>{t(`day.${d}` as "day.0")}</strong>
            {(["a", "b"] as const).map((r, i) => (
              <span key={r} className="row" dir="ltr">
                <label>{i === 0 ? t("hours.from") : ""}<input type="time" name={`open${d}${r}`} defaultValue={day[i]?.[0] ?? ""} /></label>
                <label>{i === 0 ? t("hours.to") : ""}<input type="time" name={`close${d}${r}`} defaultValue={day[i]?.[1] ?? ""} /></label>
              </span>
            ))}
          </div>
        );
      })}
    </>
  );
}
