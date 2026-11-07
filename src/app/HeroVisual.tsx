import Image from "next/image";

/** Decorative hero image. The charge percentage drawn in it is illustration only, not a live or measured value. */
export function HeroVisual() {
  return (
    <Image
      src="/images/nighttime_ev_charging_station.png"
      alt=""
      width={1447}
      height={1087}
      priority
      sizes="(min-width: 960px) 46vw, 100vw"
      className="hero-image"
    />
  );
}
