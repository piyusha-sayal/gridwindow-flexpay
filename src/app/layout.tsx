import type { Metadata } from "next";
import { Cormorant_Garamond, Lora, Geist_Mono } from "next/font/google";
import AmbientBackground from "@/components/AmbientBackground";
import "./globals.css";
import { SiteNav } from "@/components/SiteNav";
import { getRuntime } from "@/server/runtime";

export const metadata: Metadata = {
  title: "GridWindow FlexPay",
  description: "Consented flexible overnight EV charging, settled with PayPal Sandbox authorize → capture/void. Synthetic simulation.",
};

export const dynamic = "force-dynamic";

const sans = Lora({ subsets: ["latin"], variable: "--font-lora", display: "swap" });
const display = Cormorant_Garamond({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-cormorant", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

async function providerMode(): Promise<"PAYPAL_SANDBOX" | "MOCK" | "ERROR"> {
  try {
    return (await getRuntime()).deps.gateway.mode;
  } catch {
    return "ERROR";
  }
}

/** Only a configuration failure gets a full-width strip; provider mode is a nav badge. */
function ConfigErrorBanner() {
  return (
    <p className="config-banner bg-danger-soft text-danger text-sm px-4 py-2 text-center" role="alert">
      Server configuration error. Payments are disabled. Check the server log.
    </p>
  );
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const mode = await providerMode();
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} ${mono.variable}`}>
      <body className="min-h-screen">
        <AmbientBackground />
        <a href="#main" className="skip-link sr-only focus:not-sr-only focus:absolute focus:p-2 focus:bg-surface">
          Skip to content
        </a>
        {mode === "ERROR" && <ConfigErrorBanner />}
        <header className="site-header">
          <SiteNav />
        </header>
        <main id="main" className="app-main page-wrap py-8 sm:py-10 max-[899px]:pb-24">
          {children}
        </main>
        <footer className="site-footer page-wrap max-[899px]:pb-24 pb-10 pt-6 text-[13px] text-muted flex flex-wrap justify-between gap-x-6 gap-y-1">
          <span aria-hidden="true" className="divider-flow footer-rule" />
          <span>
            <span aria-hidden="true" className="logo-grid footer-mark">
              <span />
              <span />
              <span />
              <span />
            </span>
            GridWindow FlexPay · {mode === "PAYPAL_SANDBOX" ? "Payments via PayPal Sandbox" : mode === "MOCK" ? "Payments simulated (MOCK, not PayPal)" : "Payments unavailable"}
          </span>
          <span>Tariffs, fees, loads and charging are synthetic assumptions, not measured results or real-world grid benefits.</span>
        </footer>
      </body>
    </html>
  );
}
