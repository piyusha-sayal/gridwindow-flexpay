import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SiteNav } from "@/components/SiteNav";
import { getRuntime } from "@/server/runtime";

export const metadata: Metadata = {
  title: "GridWindow FlexPay",
  description: "Consented flexible overnight EV charging, settled with PayPal Sandbox authorize → capture/void. Synthetic simulation.",
};

export const dynamic = "force-dynamic";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans", display: "swap" });
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
    <p className="bg-danger-soft text-danger text-sm px-4 py-2 text-center" role="alert">
      Server configuration error. Payments are disabled. Check the server log.
    </p>
  );
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const mode = await providerMode();
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:p-2 focus:bg-surface">
          Skip to content
        </a>
        {mode === "ERROR" && <ConfigErrorBanner />}
        <header className="site-header">
          <SiteNav />
        </header>
        <main id="main" className="page-wrap py-8 sm:py-10 max-[899px]:pb-24">
          {children}
        </main>
        <footer className="site-footer page-wrap max-[899px]:pb-24 pb-10 pt-6 text-[13px] text-muted flex flex-wrap justify-between gap-x-6 gap-y-1 border-t border-line">
          <span>
            GridWindow FlexPay · {mode === "PAYPAL_SANDBOX" ? "Payments via PayPal Sandbox" : mode === "MOCK" ? "Payments simulated (MOCK, not PayPal)" : "Payments unavailable"}
          </span>
          <span>Tariffs, fees, loads and charging are synthetic assumptions, not measured results or real-world grid benefits.</span>
        </footer>
      </body>
    </html>
  );
}
