/**
 * Illustrations drawn as inline SVG so they follow the client's brand colours and need no image files.
 * `ReceptionArt` is for coloured surfaces (white on the brand colour); `EmptyArt` is for plain cards.
 */
export function ReceptionArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 480 360" className={className} role="img" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="ra-glass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".34" />
          <stop offset="1" stopColor="#fff" stopOpacity=".12" />
        </linearGradient>
      </defs>
      <circle cx="240" cy="190" r="150" fill="#fff" fillOpacity=".08" />
      <circle cx="240" cy="190" r="104" fill="#fff" fillOpacity=".08" />
      {/* phone */}
      <rect x="178" y="48" width="124" height="244" rx="24" fill="url(#ra-glass)" stroke="#fff" strokeOpacity=".65" strokeWidth="2" />
      <rect x="226" y="58" width="28" height="6" rx="3" fill="#fff" fillOpacity=".55" />
      <circle cx="240" cy="130" r="28" fill="#fff" fillOpacity=".92" />
      <path d="M232 124a4 4 0 0 1 4-4h3l2.2 6-3 2.2a14 14 0 0 0 7.6 7.6l2.2-3 6 2.2v3a4 4 0 0 1-4 4 20 20 0 0 1-20-20z" fill="var(--brand)" />
      <g fill="#fff">
        {[14, 26, 40, 22, 34, 18, 28].map((h, i) => <rect key={i} x={198 + i * 13} y={196 - h / 2} width="6" height={h} rx="3" fillOpacity={0.55 + (i % 3) * 0.15} />)}
      </g>
      <rect x="198" y="232" width="84" height="34" rx="17" fill="#fff" fillOpacity=".92" />
      <path d="M232 249l6 6 12-12" fill="none" stroke="var(--brand)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      {/* chat bubbles */}
      <g>
        <path d="M54 92h108a14 14 0 0 1 14 14v34a14 14 0 0 1-14 14h-74l-22 18v-18h-12a14 14 0 0 1-14-14v-34a14 14 0 0 1 14-14z" fill="#fff" fillOpacity=".95" />
        <rect x="68" y="108" width="70" height="7" rx="3.5" fill="var(--brand)" fillOpacity=".75" />
        <rect x="68" y="124" width="48" height="7" rx="3.5" fill="var(--brand)" fillOpacity=".35" />
      </g>
      <g>
        <path d="M318 168h92a14 14 0 0 1 14 14v28a14 14 0 0 1-14 14h-10v18l-22-18h-60a14 14 0 0 1-14-14v-28a14 14 0 0 1 14-14z" fill="#fff" fillOpacity=".22" stroke="#fff" strokeOpacity=".7" strokeWidth="2" />
        <rect x="334" y="184" width="64" height="7" rx="3.5" fill="#fff" fillOpacity=".85" />
        <rect x="334" y="200" width="40" height="7" rx="3.5" fill="#fff" fillOpacity=".5" />
      </g>
      {/* calendar */}
      <g transform="translate(330 56)">
        <rect width="84" height="76" rx="14" fill="#fff" fillOpacity=".95" />
        <path d="M0 26h84" stroke="var(--brand)" strokeOpacity=".25" strokeWidth="2" />
        <rect width="84" height="26" rx="14" fill="var(--accent)" fillOpacity=".85" />
        <rect y="14" width="84" height="12" fill="var(--accent)" fillOpacity=".85" />
        <path d="M24 -8v14M60 -8v14" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
        <path d="M30 51l9 9 16-18" fill="none" stroke="var(--brand)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      {/* sparkles */}
      <g fill="#fff">
        <path d="M96 232l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fillOpacity=".8" />
        <path d="M400 290l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fillOpacity=".7" />
        <circle cx="140" cy="62" r="4" fillOpacity=".6" /><circle cx="438" cy="120" r="3" fillOpacity=".6" /><circle cx="62" cy="190" r="3" fillOpacity=".5" />
      </g>
    </svg>
  );
}

export function EmptyArt({ kind = "check" }: { kind?: "check" | "inbox" }) {
  return (
    <svg viewBox="0 0 160 120" width="160" height="120" role="img" aria-hidden="true" focusable="false">
      <ellipse cx="80" cy="104" rx="50" ry="7" fill="currentColor" opacity=".08" />
      <circle cx="80" cy="56" r="40" fill="var(--brand)" opacity=".1" />
      <circle cx="80" cy="56" r="28" fill="var(--brand)" opacity=".14" />
      {kind === "check" ? (
        <path d="M65 57l11 11 20-23" fill="none" stroke="var(--brand)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <g fill="none" stroke="var(--brand)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M60 52l5-14h30l5 14" /><path d="M60 52v18h40V52H88l-3 5H75l-3-5z" />
        </g>
      )}
      <g fill="var(--accent)">
        <path d="M30 30l2.5 6 6 2.5-6 2.5-2.5 6-2.5-6-6-2.5 6-2.5z" opacity=".8" />
        <path d="M130 70l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" opacity=".7" />
        <circle cx="124" cy="26" r="3" opacity=".6" /><circle cx="36" cy="82" r="2.5" opacity=".5" />
      </g>
    </svg>
  );
}
