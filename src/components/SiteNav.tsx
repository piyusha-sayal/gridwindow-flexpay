"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/drive", label: "Driver", optional: false },
  { href: "/operator", label: "Operator", optional: false },
  { href: "/benchmark", label: "Benchmark", optional: true },
] as const;

function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <span aria-hidden="true" className="logo-grid">
        <span />
        <span />
        <span />
        <span />
      </span>
      <span className="text-[17px] font-semibold tracking-[-0.02em] text-ink">GridWindow</span>
      <span className="hidden min-[520px]:inline font-mono text-[10px] tracking-[0.08em] text-muted border border-[#d9d5cb] rounded px-1.5 py-px">FLEXPAY</span>
    </span>
  );
}

/** Primary navigation; marks the current section with aria-current. Links stay inline at every width. */
export function SiteNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="page-wrap h-full flex items-center gap-3 min-[760px]:gap-6">
      <Link href="/" aria-label="GridWindow FlexPay home" aria-current={pathname === "/" ? "page" : undefined} className="no-underline">
        <Logo />
      </Link>
      <div className="ml-auto flex items-center gap-1 min-[760px]:gap-3">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`nav-link${l.optional ? " nav-optional" : ""}`}
            aria-current={pathname.startsWith(l.href) ? "page" : undefined}
          >
            {l.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
