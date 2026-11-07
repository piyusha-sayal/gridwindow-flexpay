import Link from "next/link";
import { loadSummary } from "./benchmark/summary";
import { HeroScheduler } from "./HeroScheduler";
import { HeroVisual } from "./HeroVisual";

const AUDIENCE = [
  ["FOR DRIVERS", "Save through flexibility.", "Say how much energy you need and when you leave. Pick a cheaper window and pay only after the energy is delivered."],
  ["FOR OPERATORS", "Manage charging demand intelligently.", "Every port, kilowatt and payment on one night's timeline, planned under your site's capacity."],
  ["POWERED BY", "AI assistance, deterministic optimization, and PayPal payment authorization.", ""],
] as const;

type Rule = "none" | "held" | "settled";

const STEPS: readonly { title: string; body: string; state: string; rule: Rule }[] = [
  { title: "Tell us your need", body: "Energy, plug-in time, ready-by time and budget. Or just type it.", state: "NO PAYMENT", rule: "none" },
  { title: "Compare offers", body: "Every window is checked against port and site limits and priced against charging now.", state: "NO PAYMENT", rule: "none" },
  { title: "Approve exact terms", body: "One amount, one window, one merchant. PayPal authorizes it. Nothing is collected yet.", state: "AUTHORIZED · HELD", rule: "held" },
  { title: "Charge in the window", body: "Your car stays plugged in. Power flows only in the scheduled hours.", state: "HELD · NOT COLLECTED", rule: "held" },
  { title: "Pay after delivery", body: "Delivered: captured once. Not delivered: voided. Your FlexReceipt shows the evidence.", state: "CAPTURED OR VOIDED", rule: "settled" },
];

const RULE_CLASS: Record<Rule, string> = {
  none: "border-t border-dashed border-line-strong text-muted",
  held: "border-t-2 border-amber text-warn",
  settled: "border-t-2 border-teal text-teal-ink",
};

const SIMULATED = [
  "Charging, vehicles and building load are a synthetic simulation.",
  "Tariffs, fees and costs are modeled, so savings are modeled, not measured.",
  "Payments use PayPal Sandbox test accounts or a labeled MOCK provider.",
  "An authorization is a hold, not escrow: typically honored 3 days, valid up to 29.",
] as const;

export default async function Home() {
  const s = await loadSummary();
  const unfavorable = s?.pairwise.reduce((a, c) => a + c.optimizedWorse, 0);
  return (
    <div className="space-y-[clamp(56px,8vw,96px)]">
      <section className="space-y-10">
        <div className="grid items-center gap-x-12 gap-y-8 min-[960px]:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <div className="space-y-7">
            <p className="eyebrow">FLEXIBLE EV CHARGING · AUTHORIZED WITH PAYPAL</p>
            <h1 className="font-semibold leading-[1] tracking-[-0.04em] text-[clamp(38px,5vw,64px)]">
              Smarter charging.
              <br />
              Better timing.
              <br />
              <span className="text-teal-ink">More value.</span>
            </h1>
            <p className="max-w-[520px] text-[clamp(17px,1.6vw,19px)] text-text-2">
              GridWindow helps drivers choose flexible charging windows while giving operators greater control over demand, capacity, and modeled costs.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/drive" className="btn btn-primary px-5 py-3">
                Start Charging →
              </Link>
              <Link href="/operator" className="btn px-5 py-3">
                Explore Operator Dashboard
              </Link>
            </div>
          </div>
          <HeroVisual />
        </div>
        <HeroScheduler />
      </section>

      <section aria-label="Who it is for" className="grid gap-8 grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))]">
        {AUDIENCE.map(([label, title, body]) => (
          <div key={label} className="rule-top pt-5 space-y-3">
            <p className="meta">{label}</p>
            <h2 className="text-[clamp(26px,2.4vw,30px)] leading-tight">{title}</h2>
            {body && <p className="text-text-2">{body}</p>}
          </div>
        ))}
      </section>

      <section aria-labelledby="how" className="space-y-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="how" className="text-[clamp(28px,3.4vw,34px)]">
            One night, five steps.
          </h2>
          <p className="meta">PAYMENT STATE UNDER EACH STEP</p>
        </div>
        <ol className="grid gap-6 grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))]">
          {STEPS.map((st, i) => (
            <li key={st.title} className="flex flex-col gap-2">
              <span className="font-mono text-[13px] text-teal-ink">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="text-[18px]">{st.title}</h3>
              <p className="text-[14px] text-text-2 flex-1">{st.body}</p>
              <p className={`meta pt-2 ${RULE_CLASS[st.rule]}`}>{st.state}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="simulated" className="grid gap-6 min-[760px]:grid-cols-[220px_1fr] border-t border-line pt-8">
        <h2 id="simulated" className="meta">
          WHAT&apos;S SIMULATED
        </h2>
        <div className="space-y-4">
          <ul className="space-y-2 list-disc pl-5 text-text-2">
            {SIMULATED.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <Link href="/benchmark" className="inline-block text-teal-ink underline underline-offset-4">
            {s ? `Read the ${s.scenarioCount}-scenario benchmark, including ${unfavorable} unfavorable comparisons →` : "Read the benchmark →"}
          </Link>
        </div>
      </section>
    </div>
  );
}
