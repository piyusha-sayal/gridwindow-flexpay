"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const LINKS = [
  { href: "/drive", label: "Driver" },
  { href: "/operator", label: "Operator" },
  { href: "/benchmark", label: "Benchmark" },
] as const;

type ProviderMode = "PAYPAL_SANDBOX" | "MOCK" | "ERROR";

/** Provider provenance as a quiet pill (replaces the full-width banner). */
function ProviderPill({ mode }: { mode: ProviderMode }) {
  if (mode === "PAYPAL_SANDBOX") {
    return <span className="mock-pill sandbox">PAYPAL SANDBOX · TEST MONEY</span>;
  }
  if (mode !== "MOCK") return null;
  return (
    <span className="mock-pill" role="status">
      <span className="hidden min-[1000px]:inline">MOCK PAYMENTS · SYNTHETIC DATA</span>
      <span className="hidden min-[420px]:inline min-[1000px]:hidden">MOCK · SYNTHETIC</span>
      <span className="min-[420px]:hidden">MOCK</span>
      <span className="sr-only"> — not PayPal; no PayPal calls are made and charging is simulated.</span>
    </span>
  );
}

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
      <span className="hidden min-[420px]:inline font-mono text-[10px] tracking-[0.08em] text-muted border border-[#d9d5cb] rounded px-1.5 py-px">FLEXPAY</span>
    </span>
  );
}

/** Primary navigation; marks the current section with aria-current. Below 760px it collapses into a Menu. */
export function SiteNav({ providerMode }: { providerMode: ProviderMode }) {
  const pathname = usePathname();
  // The menu belongs to the page it was opened on, so navigating closes it without an effect.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const links = LINKS.map((l) => (
    <Link key={l.href} href={l.href} className="nav-link" aria-current={pathname.startsWith(l.href) ? "page" : undefined}>
      {l.label}
    </Link>
  ));
  return (
    <nav aria-label="Main" className="page-wrap h-full flex items-center gap-3 min-[760px]:gap-6">
      <Link href="/" aria-label="GridWindow FlexPay home" aria-current={pathname === "/" ? "page" : undefined} className="no-underline">
        <Logo />
      </Link>
      <div className="hidden min-[760px]:flex items-center gap-6">{links}</div>
      <div className="ml-auto flex items-center gap-2 min-[420px]:gap-3">
        <ProviderPill mode={providerMode} />
        <button
          type="button"
          className="btn btn-sm min-[760px]:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpenOn(open ? null : pathname)}
        >
          Menu
        </button>
      </div>
      {open && (
        <div id="mobile-nav" className="min-[760px]:hidden absolute left-0 right-0 top-[var(--header-h)] bg-paper border-b border-line shadow-[var(--shadow-popover)]">
          <div className="page-wrap flex flex-col py-2 [&_.nav-link]:py-3 [&_.nav-link[aria-current=page]]:shadow-[inset_2px_0_0_var(--ink)] [&_.nav-link]:pl-3">{links}</div>
        </div>
      )}
    </nav>
  );
}
