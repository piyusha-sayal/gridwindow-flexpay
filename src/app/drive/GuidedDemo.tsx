"use client";

import { useState } from "react";
import type { FormState } from "./driverTypes";

interface Scenario {
  id: "A" | "B" | "C";
  title: string;
  summary: string;
  patch: Partial<FormState>;
  next: string;
}

const SCENARIOS: readonly Scenario[] = [
  {
    id: "A",
    title: "Successful Smart Flex",
    summary: "Port C, 30 kWh, 19:00 to 07:00.",
    patch: { portId: "port_c", targetBatteryKWh: "30", plugInLocal: "19:00", departLocal: "07:00", spendCap: "20.00", preference: "lowest_cost", minSavings: "", minSavingsRequired: false },
    next: "Press See offers, compare Charge now with Smart Flex, review the terms, approve, then run the synthetic night. In MOCK mode the approval page is labeled as not PayPal.",
  },
  {
    id: "B",
    title: "Infeasible charging",
    summary: "Port A (3.6 kW), 40 kWh, 20:00 to 02:00.",
    patch: { portId: "port_a", targetBatteryKWh: "40", plugInLocal: "20:00", departLocal: "02:00", spendCap: "20.00", preference: "lowest_cost", minSavings: "", minSavingsRequired: false },
    next: "Press See offers to see why no plan fits. Then lower the energy, leave later or pick a faster port and ask again. Nothing is authorized for an infeasible request.",
  },
  {
    id: "C",
    title: "Disturbance and recovery",
    summary: "Port B (7.2 kW), 30 kWh, 19:00 to 07:00.",
    patch: { portId: "port_b", targetBatteryKWh: "30", plugInLocal: "19:00", departLocal: "07:00", spendCap: "20.00", preference: "lowest_cost", minSavings: "", minSavingsRequired: false },
    next: "Approve the offer and run the synthetic night. Then, in the Operator Console (passphrase protected), record a SYNTHETIC charger power reduction on this session in the Recovery engine. The seven Scenario C steps show the real run, validation, schedule, consent, payment and FlexReceipt state.",
  },
];

/** Loads a sample request into the form. It never submits, approves or authorizes anything. */
export function GuidedDemo({ onLoad }: { onLoad: (patch: Partial<FormState>) => void }) {
  const [active, setActive] = useState<Scenario | null>(null);
  return (
    <details className="rounded-[var(--r-card-sm)] border border-line bg-surface px-4 py-3">
      <summary className="cursor-pointer text-[14px] font-medium">
        Guided demo scenarios <span className="badge tone-neutral ml-2">Demo mode</span>
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-[13px] text-muted">Each button only fills in the form below with a sample request. Nothing is submitted or authorized until you do it yourself.</p>
        <ul className="grid gap-2 grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))]">
          {SCENARIOS.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="btn w-full flex-col items-start gap-0.5 text-left"
                aria-pressed={active?.id === s.id}
                onClick={() => {
                  setActive(s);
                  onLoad(s.patch);
                }}
              >
                <span className="font-semibold">
                  Scenario {s.id}: {s.title}
                </span>
                <span className="text-[12px] text-muted font-normal">{s.summary}</span>
              </button>
            </li>
          ))}
        </ul>
        {active && (
          <p role="status" className="text-[13px] text-text-2">
            <strong>Loaded scenario {active.id}.</strong> {active.next}
          </p>
        )}
      </div>
    </details>
  );
}
