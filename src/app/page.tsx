import Link from "next/link";
import { formatUsd } from "@/domain/units";
import { loadSummary } from "./impact-lab/summary";
import { HeroScheduler } from "./HeroScheduler";
import { HERO_DEFAULT_READY_SLOT, HERO_PORT_W, heroSchedule, heroTimeLabel } from "./heroSchedule";
import { HeroVisual } from "./HeroVisual";

const TRUST = [
  ["Deadline-aware planning", "Every offer is checked against your departure time and the port's power limit before you see it."],
  ["Driver approval", "You review the exact amount, window and terms before anything is authorized."],
  ["PayPal Sandbox", "Authorization, capture and void run through PayPal Sandbox test accounts, never real money."],
] as const;

const PREVIEW_STEPS = [
  ["Tell us when you need your EV", "Energy, port, plug-in time and departure deadline."],
  ["Compare validated charging options", "Charge now against flexible windows, each checked for feasibility."],
  ["Approve your incentive and terms", "One amount, one window, one merchant. PayPal authorizes a hold."],
  ["Track charging and payment", "Capture after verified simulated delivery, void if it fails."],
] as const;

const WHY = [
  ["Demand piles up", "Many cars plug in at the same time in the evening, when energy is most expensive and a site's power limit is tightest."],
  ["Many drivers can wait", "If the car is ready by morning, the hours in between often do not matter to the driver."],
  ["Sites have hard limits", "An operator has to fit every session under one power cap, so shifting some charging later can free capacity."],
] as const;

const SIMULATED = [
  "Charging, vehicles and building load are a synthetic simulation. No car is charged.",
  "Tariffs, fees and costs are modeled, so savings are modeled, not measured.",
  "Payments use PayPal Sandbox test accounts or a labeled MOCK provider.",
  "An authorization is a hold, not escrow: typically honored 3 days, valid up to 29.",
] as const;

/** Illustrative status card on the hero image. Values come from the same pricing rule as the interactive scheduler below. */
function HeroStatus() {
  const r = heroSchedule(HERO_DEFAULT_READY_SLOT);
  if (r.kind !== "OFFER") return null;
  return (
    <aside className="hero-status" aria-label="Illustrative example">
      <p className="hero-status-tag">ILLUSTRATIVE EXAMPLE</p>
      <dl className="grid grid-cols-3 gap-3 text-[13px]">
        <div>
          <dt className="text-[#9db4c7]">Ready by</dt>
          <dd className="font-mono tabular text-white">{heroTimeLabel(HERO_DEFAULT_READY_SLOT)}</dd>
        </div>
        <div>
          <dt className="text-[#9db4c7]">Charging window</dt>
          <dd className="font-mono tabular text-white">
            {heroTimeLabel(r.startSlot)} to {heroTimeLabel(r.endSlot)}
          </dd>
        </div>
        <div>
          <dt className="text-[#9db4c7]">Modeled saving</dt>
          <dd className="font-mono tabular text-white">{formatUsd(r.discountCents)}</dd>
        </div>
      </dl>
      <p className="mt-2 text-[11px] text-[#9db4c7]">Synthetic tariff, one {HERO_PORT_W / 1000} kW port, 30 kWh. Not a quote.</p>
    </aside>
  );
}

export default async function Home() {
  const s = await loadSummary();
  const unfavorable = s?.pairwise.reduce((a, c) => a + c.optimizedWorse, 0);
  return (
    <div className="space-y-[clamp(56px,8vw,96px)]">
      <section className="space-y-8">
        <div className="grid items-center gap-x-12 gap-y-8 min-[960px]:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <div className="space-y-7">
            <p className="eyebrow">FLEXIBLE EV CHARGING · AUTHORIZED WITH PAYPAL</p>
            <h1 className="font-semibold leading-[1.02] tracking-[-0.04em] text-[clamp(36px,4.6vw,60px)]">
              Your car ready on time. <span className="text-teal-ink">Your flexibility rewarded.</span>
            </h1>
            <p className="max-w-[520px] text-[clamp(17px,1.6vw,19px)] text-text-2">
              Plan around your departure deadline, compare charging options, and get a modeled discount when your timing is flexible. You review and approve the exact terms before anything is authorized.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/drive" className="btn btn-primary px-5 py-3">
                Plan My Charge
              </Link>
              <Link href="/how-it-works" className="btn px-5 py-3">
                How It Works
              </Link>
            </div>
          </div>
          <div className="hero-media">
            <HeroVisual />
            <HeroStatus />
          </div>
        </div>
        <ul className="grid gap-4 min-[760px]:grid-cols-3" aria-label="Why you can trust the plan">
          {TRUST.map(([title, body]) => (
            <li key={title} className="rule-top pt-4 space-y-1.5">
              <p className="font-semibold">{title}</p>
              <p className="text-[14px] text-text-2">{body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="how" className="space-y-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="how" className="text-[clamp(28px,3.4vw,34px)]">
            How it works
          </h2>
          <Link href="/how-it-works" className="text-teal-ink underline underline-offset-4 text-[14px]">
            See the full walkthrough and FAQ
          </Link>
        </div>
        <ol className="grid gap-6 grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))]">
          {PREVIEW_STEPS.map(([title, body], i) => (
            <li key={title} className="flex flex-col gap-2">
              <span className="font-mono text-[13px] text-teal-ink">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="text-[18px]">{title}</h3>
              <p className="text-[14px] text-text-2">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="why" className="space-y-6">
        <h2 id="why" className="text-[clamp(28px,3.4vw,34px)]">
          Why flexible charging matters
        </h2>
        <div className="grid gap-8 grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))]">
          {WHY.map(([title, body]) => (
            <div key={title} className="rule-top pt-5 space-y-2">
              <h3 className="text-[20px]">{title}</h3>
              <p className="text-text-2">{body}</p>
            </div>
          ))}
        </div>
        <p className="meta">MODELED ON SYNTHETIC ASSUMPTIONS, NOT MEASURED GRID DATA</p>
      </section>

      <section aria-labelledby="compare" className="space-y-6">
        <div className="space-y-2">
          <h2 id="compare" className="text-[clamp(28px,3.4vw,34px)]">
            Charge now or Smart Flex
          </h2>
          <p className="max-w-[640px] text-text-2">Move the ready-by marker to see how a later departure deadline changes the modeled price. This preview never creates a commitment.</p>
        </div>
        <HeroScheduler />
      </section>

      <section aria-labelledby="paypal" className="space-y-8">
        <div className="space-y-2">
          <h2 id="paypal" className="text-[clamp(28px,3.4vw,34px)]">
            Payment that follows the energy
          </h2>
          <p className="max-w-[640px] text-text-2">PayPal authorizes the exact approved amount first. Nothing is collected until simulated delivery is verified.</p>
        </div>
        <ol className="grid gap-6 grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))]">
          <li className="border-t border-dashed border-line-strong pt-3 space-y-1.5">
            <p className="meta text-muted">BEFORE APPROVAL</p>
            <p className="text-[14px] text-text-2">No payment. You compare options and read the terms.</p>
          </li>
          <li className="border-t-2 border-amber pt-3 space-y-1.5">
            <p className="meta text-warn">AUTHORIZED · HELD</p>
            <p className="text-[14px] text-text-2">PayPal Sandbox holds the amount. It is not captured and not escrow.</p>
          </li>
          <li className="border-t-2 border-teal pt-3 space-y-1.5">
            <p className="meta text-teal-ink">CAPTURED OR VOIDED</p>
            <p className="text-[14px] text-text-2">Delivered: captured once. Not delivered: voided, nothing collected. Your FlexReceipt shows the evidence.</p>
          </li>
        </ol>
        <div className="grid gap-6 min-[760px]:grid-cols-[220px_1fr] border-t border-line pt-8">
          <h3 className="meta">WHAT&apos;S SIMULATED</h3>
          <div className="space-y-4">
            <ul className="space-y-2 list-disc pl-5 text-text-2">
              {SIMULATED.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            <Link href="/impact-lab" className="inline-block text-teal-ink underline underline-offset-4">
              {s ? `Open the Impact Lab, including ${s.scenarioCount} synthetic scenarios and ${unfavorable} unfavorable comparisons` : "Open the Impact Lab"}
            </Link>
          </div>
        </div>
      </section>

      <section aria-labelledby="cta" className="card card-navy px-6 py-10 text-center space-y-5">
        <h2 id="cta" className="text-[clamp(26px,3.2vw,36px)]">
          Ready to plan tonight&apos;s charge?
        </h2>
        <p className="mx-auto max-w-[520px] opacity-90">It takes about a minute. You approve every term before anything is authorized.</p>
        <Link href="/drive" className="btn btn-primary px-6 py-3">
          Plan My Charge
        </Link>
      </section>
    </div>
  );
}
