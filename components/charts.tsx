/**
 * Charts drawn as plain SVG/HTML on the server: no chart library, readable in light and dark, and each one has
 * a text alternative (a <title>/aria-label here, and a table next to it on the reports page).
 * Series colours follow a fixed order so a channel keeps its colour wherever it appears.
 */

// Reference categorical palette, slots 1 to 4 (light, dark) as CSS variables defined in globals.css.
export const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"] as const;

export function DailyBars({ data, label, color = "var(--brand)", height = 150 }: {
  data: { key: string; label: string; value: number }[]; label: string; color?: string; height?: number;
}) {
  const w = 640, padL = 28, padB = 22, padT = 8;
  const max = Math.max(1, ...data.map((d) => d.value));
  const nice = max <= 4 ? max : Math.ceil(max / 4) * 4;
  const innerW = w - padL, innerH = height - padB - padT;
  const slot = innerW / Math.max(1, data.length);
  const bw = Math.max(2, Math.min(18, slot * 0.62));
  const ticks = [0, nice / 2, nice];
  const every = Math.ceil(data.length / 6);
  return (
    <svg viewBox={`0 0 ${w} ${height}`} role="img" aria-label={label} className="chart">
      {ticks.map((t) => {
        const y = padT + innerH - (t / nice) * innerH;
        return (
          <g key={t}>
            <line x1={padL} x2={w} y1={y} y2={y} className="grid-line" />
            <text x={padL - 6} y={y + 3} textAnchor="end" className="axis">{Number.isInteger(t) ? t : t.toFixed(1)}</text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const h = (d.value / nice) * innerH;
        const x = padL + i * slot + (slot - bw) / 2;
        return (
          <g key={d.key} className="bar-group">
            <rect x={padL + i * slot} y={padT} width={slot} height={innerH + padB} fill="transparent" />
            <rect x={x} y={padT + innerH - h} width={bw} height={Math.max(d.value > 0 ? 2 : 0, h)} rx={Math.min(4, bw / 2)} fill={color} className="bar-rect" />
            <title>{`${d.label}: ${d.value}`}</title>
            {i % every === 0 && <text x={x + bw / 2} y={height - 6} textAnchor="middle" className="axis">{d.label}</text>}
          </g>
        );
      })}
    </svg>
  );
}

export function Sparkline({ values, color = "var(--brand)" }: { values: number[]; color?: string }) {
  const w = 96, h = 28, max = Math.max(1, ...values), n = Math.max(1, values.length - 1);
  const pts = values.map((v, i) => `${((i / n) * (w - 4) + 2).toFixed(1)},${(h - 3 - (v / max) * (h - 6)).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true" className="spark">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Horizontal bars with the value written at the end of each one. */
export function HBars({ rows, unit }: { rows: { key: string; label: string; value: number; color?: string }[]; unit?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="hbars">
      {rows.map((r) => (
        <div key={r.key} className="hbar">
          <span className="hbar-label">{r.label}</span>
          <span className="hbar-track"><span style={{ inlineSize: `${(r.value / max) * 100}%`, background: r.color ?? "var(--brand)" }} /></span>
          <span className="hbar-value">{r.value}{unit ? ` ${unit}` : ""}</span>
        </div>
      ))}
    </div>
  );
}

/** One bar split into parts (e.g. outcomes), with a legend that carries the numbers. */
export function SegmentBar({ parts }: { parts: { key: string; label: string; value: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div>
      <div className="segbar" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(", ")}>
        {parts.filter((p) => p.value > 0).map((p) => <span key={p.key} style={{ flexGrow: p.value / total, background: p.color }} title={`${p.label}: ${p.value}`} />)}
      </div>
      <ul className="legend">
        {parts.map((p) => <li key={p.key}><span className="swatch" style={{ background: p.color }} />{p.label} <strong>{p.value}</strong></li>)}
      </ul>
    </div>
  );
}
