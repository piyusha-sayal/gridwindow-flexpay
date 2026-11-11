import Image from "next/image";

/** Decorative hero image. The charge percentage drawn in it is illustration only, not a live or measured value. */
export function HeroVisual() {
  return (
    <div className="hero-visual">
      {/* Decoration only: a halo, a frame of current with travelling pulses, a drifting "window" band and two glass tiles. No data. */}
      <span aria-hidden="true" className="hero-halo" />
      <svg aria-hidden="true" focusable="false" className="hero-flow" viewBox="0 0 654 500" preserveAspectRatio="none">
        <rect className="hero-flow-line hero-flow-faint" x="6" y="4" width="642" height="492" rx="40" />
        <rect className="hero-flow-line" x="20" y="16" width="614" height="468" rx="30" />
        <path className="hero-flow-line" d="M0 150H20M634 330H654M190 0V16M470 484V500" />
        <rect className="hero-flow-pulse" pathLength={100} x="20" y="16" width="614" height="468" rx="30" />
        <rect className="hero-flow-pulse hero-flow-pulse-b" pathLength={100} x="6" y="4" width="642" height="492" rx="40" />
        <rect className="hero-flow-pulse hero-flow-pulse-c" pathLength={100} x="20" y="16" width="614" height="468" rx="30" />
        <circle className="hero-node-ring" cx="20" cy="150" r="5" />
        <circle className="hero-node-ring" cx="634" cy="330" r="5" />
        <circle className="hero-node-ring" cx="190" cy="16" r="5" />
        <circle className="hero-node-ring" cx="470" cy="484" r="5" />
        <circle className="hero-node" cx="20" cy="150" r="4" />
        <circle className="hero-node" cx="634" cy="330" r="4" />
        <circle className="hero-node" cx="190" cy="16" r="4" />
        <circle className="hero-node" cx="470" cy="484" r="4" />
      </svg>
      <Image
        src="/images/nighttime_ev_charging_station.png"
        alt=""
        width={1447}
        height={1087}
        priority
        sizes="(min-width: 960px) 46vw, 100vw"
        className="hero-image"
      />
      <span aria-hidden="true" className="hero-window" />
      <span aria-hidden="true" className="hero-chip hero-chip-a">
        <span />
        <span />
        <span />
        <span />
        <span />
      </span>
      <span aria-hidden="true" className="hero-chip hero-chip-b">
        <span />
      </span>
    </div>
  );
}
