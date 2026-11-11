"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

interface NavItem {
  href: string;
  label: string;
  short?: string;
  /** Path prefixes that mark this item as the current section. */
  match: readonly string[];
}

const PRIMARY: readonly NavItem[] = [
  { href: "/", label: "Home", match: [] },
  { href: "/drive", label: "Smart Charge", short: "Charge", match: ["/drive", "/reservations", "/mock-checkout"] },
  { href: "/rewards", label: "Rewards & Payments", short: "Rewards", match: ["/rewards"] },
  { href: "/impact-lab", label: "Impact Lab", match: ["/impact-lab", "/benchmark"] },
  { href: "/how-it-works", label: "How It Works", match: ["/how-it-works"] },
];
const OPERATOR: NavItem = { href: "/operator", label: "Operator Console", match: ["/operator"] };
const MORE: readonly NavItem[] = [PRIMARY[3]!, PRIMARY[4]!, OPERATOR];
const MOBILE_BAR: readonly NavItem[] = [PRIMARY[0]!, PRIMARY[1]!, PRIMARY[2]!];

function isCurrent(item: NavItem, pathname: string): boolean {
  return item.href === "/" ? pathname === "/" : item.match.some((p) => pathname.startsWith(p));
}

function Logo() {
  return (
    <span className="logo">
      <span aria-hidden="true" className="logo-grid">
        <span />
        <span />
        <span />
        <span />
      </span>
      <span className="logo-word">GridWindow</span>
      <span className="logo-tag hidden min-[520px]:inline">FLEXPAY</span>
    </span>
  );
}

/** Desktop: inline links with Operator Console as a quieter secondary link. Mobile: bottom bar with a More sheet. */
export function SiteNav() {
  const pathname = usePathname();
  // The sheet belongs to the page it was opened on, so navigating closes it without an effect.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const moreOpen = openOn === pathname;
  const moreCurrent = MORE.some((i) => isCurrent(i, pathname));
  return (
    <>
      <nav aria-label="Main" className="page-wrap h-full flex items-center gap-3 min-[900px]:gap-6">
        <Link href="/" aria-label="GridWindow FlexPay home" className="logo-link no-underline">
          <Logo />
        </Link>
        <div className="nav-desktop nav-rail ml-auto items-center gap-1">
          {PRIMARY.map((l) => (
            <Link key={l.href} href={l.href} className="nav-link" aria-current={isCurrent(l, pathname) ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
          <span aria-hidden="true" className="nav-sep" />
          <Link href={OPERATOR.href} className="nav-link nav-link-quiet" aria-current={isCurrent(OPERATOR, pathname) ? "page" : undefined}>
            <span aria-hidden="true" className="live-dot" />
            {OPERATOR.label}
          </Link>
        </div>
      </nav>
      <nav aria-label="Mobile" className="bottom-nav no-print">
        {MOBILE_BAR.map((l) => (
          <Link key={l.href} href={l.href} className="bottom-nav-item" aria-current={isCurrent(l, pathname) ? "page" : undefined}>
            {l.short ?? l.label}
          </Link>
        ))}
        <button
          type="button"
          className="bottom-nav-item"
          aria-expanded={moreOpen}
          aria-controls="more-sheet"
          aria-current={moreCurrent ? "page" : undefined}
          onClick={() => setOpenOn(moreOpen ? null : pathname)}
        >
          More
        </button>
        {moreOpen && (
          <div id="more-sheet" className="more-sheet">
            {MORE.map((l) => (
              <Link key={l.href} href={l.href} className="more-sheet-link" aria-current={isCurrent(l, pathname) ? "page" : undefined}>
                {l.label}
              </Link>
            ))}
          </div>
        )}
      </nav>
    </>
  );
}
