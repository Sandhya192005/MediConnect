/**
 * Drawn hospital pictures (owner's reference design, Part 2). Drawn rather than photographed: a photo of a
 * real hospital would suggest a specific place, and these are generic. Decorative, so hidden from screen
 * readers. Colours come from the brand: navy ink, logo teal, soft teal ground.
 */

const C = {
  wall: "#ffffff",
  edge: "#d3deef",
  glass: "#dbe6f6",
  glassDark: "#a9c2e6",
  teal: "#1f4f9e",
  navy: "#00295c",
  ground: "#d6e2f3",
  leaf: "#8cc49b",
  leafDark: "#5f9f70",
};

/** A small square hospital for cards (e.g. "Nearest to you"). */
export default function HospitalThumb({ className = "h-12 w-12" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={`shrink-0 rounded-xl bg-teal-50 ${className}`} aria-hidden="true">
      <rect x="6" y="40" width="36" height="3" rx="1.5" fill={C.ground} />
      <rect x="8" y="22" width="9" height="18" rx="1" fill={C.wall} stroke={C.edge} />
      <rect x="31" y="22" width="9" height="18" rx="1" fill={C.wall} stroke={C.edge} />
      <rect x="16" y="11" width="16" height="29" rx="1.5" fill={C.wall} stroke={C.edge} />
      <circle cx="24" cy="17" r="4" fill={C.teal} />
      <path d="M24 14.6v4.8M21.6 17h4.8" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      {[24, 29].map((y) => [19, 26].map((x) => <rect key={`${x}-${y}`} x={x} y={y} width="3" height="3" rx=".6" fill={C.glassDark} />))}
      {[26, 32].map((y) => (
        <g key={y}>
          <rect x="10.5" y={y} width="4" height="3" rx=".6" fill={C.glass} />
          <rect x="33.5" y={y} width="4" height="3" rx=".6" fill={C.glass} />
        </g>
      ))}
      <rect x="21" y="34" width="6" height="6" rx="1" fill={C.navy} opacity=".85" />
    </svg>
  );
}

/** The large hospital building for the login and sign-up brand panel. */
export function HospitalIllustration({ className = "w-full" }: { className?: string }) {
  const towerWindows = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      towerWindows.push(
        <rect key={`t${row}${col}`} x={208 + col * 30} y={98 + row * 26} width="20" height="14" rx="2.5"
              fill={(row + col) % 3 === 0 ? C.glassDark : C.glass} />,
      );
    }
  }
  const wingWindows = (x0: number) => {
    const out = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        out.push(<rect key={`w${x0}${row}${col}`} x={x0 + col * 34} y={138 + row * 24} width="22" height="13" rx="2.5"
                       fill={(row + col) % 2 ? C.glass : C.glassDark} opacity=".9" />);
      }
    }
    return out;
  };
  const tree = (x: number, s = 1) => (
    <g transform={`translate(${x} ${246 - 62 * s}) scale(${s})`}>
      <rect x="-2.5" y="40" width="5" height="22" rx="2" fill={C.navy} opacity=".35" />
      <circle cx="0" cy="26" r="22" fill={C.leaf} />
      <circle cx="-9" cy="34" r="13" fill={C.leafDark} opacity=".55" />
    </g>
  );

  return (
    <svg viewBox="0 0 520 270" className={className} aria-hidden="true">
      {/* ground and soft shadow */}
      <ellipse cx="260" cy="250" rx="250" ry="16" fill={C.ground} />
      <ellipse cx="260" cy="246" rx="205" ry="7" fill={C.navy} opacity=".06" />

      {/* left and right wings */}
      <rect x="62" y="122" width="124" height="124" rx="6" fill={C.wall} stroke={C.edge} strokeWidth="2" />
      <rect x="334" y="122" width="124" height="124" rx="6" fill={C.wall} stroke={C.edge} strokeWidth="2" />
      <rect x="62" y="122" width="124" height="8" rx="4" fill={C.edge} />
      <rect x="334" y="122" width="124" height="8" rx="4" fill={C.edge} />
      {wingWindows(77)}
      {wingWindows(349)}

      {/* main tower */}
      <rect x="186" y="54" width="148" height="192" rx="8" fill={C.wall} stroke={C.edge} strokeWidth="2" />
      <rect x="186" y="54" width="148" height="10" rx="5" fill={C.edge} />
      {towerWindows}

      {/* the sign: a cross in a teal circle */}
      <circle cx="260" cy="40" r="22" fill={C.wall} stroke={C.edge} strokeWidth="2" />
      <circle cx="260" cy="40" r="16" fill={C.teal} />
      <path d="M260 31v18M251 40h18" stroke="#fff" strokeWidth="5" strokeLinecap="round" />

      {/* entrance with a canopy and glass doors */}
      <rect x="226" y="200" width="68" height="46" rx="4" fill={C.navy} opacity=".9" />
      <rect x="232" y="206" width="26" height="40" rx="2" fill={C.glassDark} opacity=".8" />
      <rect x="262" y="206" width="26" height="40" rx="2" fill={C.glassDark} opacity=".8" />
      <rect x="214" y="190" width="92" height="12" rx="6" fill={C.teal} />

      {/* path to the door */}
      <path d="M236 246 L222 262 H298 L284 246 Z" fill={C.wall} opacity=".8" />

      {/* trees */}
      {tree(40, 1)}
      {tree(476, 1.05)}
      {tree(196, 0.62)}
      {tree(324, 0.62)}
    </svg>
  );
}
