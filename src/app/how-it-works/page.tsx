import Link from "next/link";
import { HowItWorksSteps } from "./HowItWorksSteps";

export const metadata = { title: "How It Works · GridWindow FlexPay" };

const FAQ: { question: string; answer: string[] }[] = [
  {
    question: "What does Smart Charge do?",
    answer: [
      "Smart Charge (the /drive page) lets you choose when your EV charges overnight. It prices flexible schedules against charging immediately, and only offers schedules that still meet your departure time and energy target.",
    ],
  },
  {
    question: "What is Gentle Charging?",
    answer: [
      "Gentle Charging is a real lower-power schedule that charges at half of the port's rated power, rounded down to the site's power step.",
      "It is only offered when it still reaches your energy target before you leave. It does not claim better battery health or extra savings.",
    ],
  },
  {
    question: "Why can lower power be useful?",
    answer: [
      "A lower-power schedule draws less power at any moment, which means less instantaneous demand on the site's shared grid connection.",
      "Offers with the same price can still differ in peak power, so the peak power of each option is shown.",
    ],
  },
  {
    question: "Does lower power automatically save money?",
    answer: ["No. Modeled savings come from when energy is drawn under the synthetic time-of-use tariff, not from the power level alone. A Gentle Charging offer may be priced the same as another offer."],
  },
  {
    question: "How are modeled savings calculated?",
    answer: [
      "The app models the energy cost of the flexible schedule and of charging immediately, using a synthetic time-of-use tariff with a congestion surcharge. The driver receives 50% of the modeled energy saving, and an offer is shown only if the discount is at least 25 cents and the operator's modeled contribution improves.",
      "These are modeled numbers from labeled assumptions. They are not measured tariffs, real utility rates, or a cash payout.",
    ],
  },
  {
    question: "How does PayPal Sandbox authorization work?",
    answer: [
      "Approving places an authorization, which is a hold on the payment method for the agreed amount. It is not a capture and it is not escrow, so no money moves when you approve.",
      "PayPal documents a three-day honor period and an authorization lifetime of up to 29 days. The app captures only after simulated delivery is verified, and it does not capture after the authorization expires.",
    ],
  },
  {
    question: "What happens after the charging simulation?",
    answer: [
      "The simulation runs on the server and records a delivery result with an event trail. If delivery is verified, the app requests capture. If not, it requests a void.",
      "Capture and void are only recorded as final when the payment provider confirms them.",
    ],
  },
  {
    question: "What happens when charging fails?",
    answer: [
      "The app voids the authorization, so no payment is collected. If the provider cannot confirm the void, the reservation goes to reconciliation and no charge is attempted.",
    ],
  },
  {
    question: "Do I need to log in?",
    answer: [
      "No. Your browser keeps a session cookie so you can see your own reservations on the Rewards & Payments page. The operator console is separate and protected by a passphrase.",
    ],
  },
  {
    question: "Is a real EV or charger connected?",
    answer: ["No. Charging is a synthetic simulation on the server. No vehicle, charger, or grid meter is connected."],
  },
];

export default function HowItWorksPage() {
  return (
    <div className="space-y-12">
      <header className="space-y-3 max-w-[820px]">
        <p className="eyebrow">Four steps</p>
        <h1 className="font-semibold tracking-[-0.03em] leading-[1.05] text-[clamp(32px,4.6vw,52px)]">How It Works</h1>
        <p className="text-[17px] text-text-2">
          Smart Charge moves flexible overnight charging to cheaper hours and asks you to approve every term first. Everything here is a simulation.
        </p>
      </header>

      <section aria-labelledby="steps" className="space-y-4">
        <h2 id="steps" className="sr-only">Walkthrough</h2>
        <HowItWorksSteps />
      </section>

      <section aria-labelledby="faq" className="space-y-4 max-w-[820px]">
        <h2 id="faq" className="text-[22px] font-semibold tracking-[-0.01em]">Frequently asked questions</h2>
        <div className="space-y-3">
          {FAQ.map((item) => (
            <details key={item.question} className="card p-4 group">
              <summary className="cursor-pointer font-semibold">{item.question}</summary>
              <div className="mt-3 space-y-2 text-text-2">
                {item.answer.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            </details>
          ))}
        </div>
      </section>

      <p className="text-[15px] text-text-2">
        Ready to try it? <Link href="/drive" className="font-semibold underline underline-offset-2">Start Smart Charge</Link>
      </p>
    </div>
  );
}
