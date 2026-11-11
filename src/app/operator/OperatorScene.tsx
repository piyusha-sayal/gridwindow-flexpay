/**
 * Decorative illustration for the operator console: a night charging depot with chargers, parked cars,
 * pylons and a live power line. Pure SVG, aria-hidden, animated with CSS only (see "Operator scene" in globals.css).
 */
const STARS: ReadonlyArray<readonly [number, number]> = [
  [60, 40], [140, 90], [230, 30], [300, 70], [380, 25], [470, 60], [560, 35], [640, 80], [720, 28], [900, 50], [950, 100], [90, 130], [260, 120], [610, 120],
];
const STATIONS = [300, 420, 540, 660] as const;

export function OperatorScene({ className = "", view = "0 0 1000 400" }: { className?: string; view?: string }) {
  return (
    <svg className={`scene-svg ${className}`.trim()} viewBox={view} preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <rect width="1000" height="400" fill="#2d2b2b" />
      <rect y="150" width="1000" height="140" fill="#3a3736" opacity="0.55" />
      {STARS.map(([x, y], i) => (
        <circle key={i} className="scene-star" cx={x} cy={y} r="1.7" fill="#f6e3c2" />
      ))}
      <circle cx="820" cy="78" r="26" fill="#e9d5ad" />
      <circle cx="831" cy="71" r="23" fill="#2d2b2b" />

      <path d="M0 250 L90 205 L190 240 L300 190 L420 238 L540 200 L660 236 L790 196 L900 232 L1000 205 V290 H0Z" fill="#201f1d" />

      {/* Power line, pylons and the current moving along it */}
      <g stroke="#bab6b6" strokeWidth="2" fill="none">
        <path d="M60 290 L80 150 L100 290 M66 230 H94 M70 190 H90" />
        <path d="M900 290 L920 150 L940 290 M906 230 H934 M910 190 H930" />
      </g>
      <path d="M80 152 C300 205 700 205 920 152" fill="none" stroke="#7d7979" strokeWidth="1.5" />
      <path className="scene-flow" d="M80 152 C300 205 700 205 920 152" fill="none" stroke="#e1ad66" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="6 26" />

      {/* Ground */}
      <rect y="290" width="1000" height="110" fill="#201f1d" />
      <path d="M0 290 H1000" stroke="#444141" strokeWidth="2" />
      <path d="M170 372 H830" stroke="#7d7979" strokeWidth="2" strokeDasharray="30 22" opacity="0.6" />

      {/* Cars in the first and third bays */}
      {[240, 480].map((x, i) => (
        <g key={x} transform={`translate(${x} 322)`}>
          <path d="M0 40 C0 18 14 14 34 10 L60 -8 C74 -16 120 -16 134 -6 L156 10 C172 14 180 22 180 40 Z" fill={i === 0 ? "#d7d3d3" : "#bab6b6"} />
          <path d="M60 -2 L80 -12 H116 L132 2 Z" fill="#2d2b2b" opacity="0.85" />
          <circle cx="44" cy="42" r="15" fill="#201f1d" stroke="#605d5d" strokeWidth="4" />
          <circle cx="138" cy="42" r="15" fill="#201f1d" stroke="#605d5d" strokeWidth="4" />
          <rect x="168" y="22" width="12" height="6" rx="2" fill="#f6e3c2" />
        </g>
      ))}

      {/* Charging stations */}
      {STATIONS.map((x, i) => (
        <g key={x} transform={`translate(${x} 232)`}>
          <rect x="-16" y="0" width="32" height="92" rx="6" fill="#f3f2f2" stroke="#bab6b6" strokeWidth="2" />
          <rect x="-9" y="10" width="18" height="26" rx="3" fill="#2d2b2b" />
          <path className="scene-bolt" d="M1 14 L-5 25 H0 L-2 33 L5 21 H0Z" fill="#e1ad66" />
          <circle className={`scene-led scene-led-${i % 3}`} cx="0" cy="50" r="3.5" fill="#e1ad66" />
          <path d="M16 62 C34 62 36 90 28 108" fill="none" stroke="#605d5d" strokeWidth="3" strokeLinecap="round" />
        </g>
      ))}

      {/* Load meter */}
      <g transform="translate(792 318)">
        <rect width="170" height="52" rx="6" fill="#2d2b2b" stroke="#605d5d" />
        {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => (
          <rect key={n} className="scene-bar" style={{ ["--n" as string]: n }} x={12 + n * 18} y={12} width="10" height="28" rx="2" fill="#e1ad66" />
        ))}
      </g>
    </svg>
  );
}
