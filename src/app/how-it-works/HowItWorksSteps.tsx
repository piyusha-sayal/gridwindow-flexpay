"use client";

import { Fragment, useId, useRef, useState, type KeyboardEvent } from "react";

interface Step {
  title: string;
  body: string[];
}

const STEPS: Step[] = [
  {
    title: "Tell us when you need your EV",
    body: [
      "Enter your plug-in time, departure time, and the battery energy you need by departure.",
      "Set a spend cap so you only see offers you are willing to accept.",
    ],
  },
  {
    title: "Compare validated charging options",
    body: [
      "The server prices each option against an immediate-charging baseline and checks the schedule against the port and site limits.",
      "Options that do not meet your departure time or spend cap are not offered.",
    ],
  },
  {
    title: "Approve your incentive and financial terms",
    body: [
      "Review the exact schedule, price, and merchant before you approve.",
      "Approving places an authorization hold on PayPal Sandbox. Nothing is captured yet.",
    ],
  },
  {
    title: "Track charging and payment outcomes",
    body: [
      "Watch the charging simulation and its event trail on your reservation page.",
      "Payment is captured only after delivery is verified. If charging fails, the authorization is voided.",
    ],
  },
];

export function HowItWorksSteps() {
  const [selected, setSelected] = useState(0);
  const baseId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function select(index: number) {
    setSelected(index);
    tabRefs.current[index]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = STEPS.length - 1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") select(index === last ? 0 : index + 1);
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") select(index === 0 ? last : index - 1);
    else if (event.key === "Home") select(0);
    else if (event.key === "End") select(last);
    else return;
    event.preventDefault();
  }

  const step = STEPS[selected]!;

  return (
    <div className="space-y-6">
      <div role="tablist" aria-label="How Smart Charge works" className="hiw-tabs grid gap-3 sm:grid-cols-4" style={{ "--sel": selected } as React.CSSProperties}>
        {STEPS.map((s, i) => {
          const active = i === selected;
          return (
            <Fragment key={s.title}>
              <button
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`${baseId}-tab-${i}`}
                aria-selected={active}
                aria-controls={`${baseId}-panel`}
                tabIndex={active ? 0 : -1}
                onClick={() => setSelected(i)}
                onKeyDown={(e) => onKeyDown(e, i)}
                className={`card hiw-tab w-full h-full p-4 text-left flex gap-3 items-start cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 ${active ? "is-active border-teal" : ""}`}
              >
                <span aria-hidden="true" className={`hiw-num flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${active ? "bg-teal-ink text-surface" : "bg-surface-2 text-text-2"}`}>
                  {i + 1}
                </span>
                <span className="font-semibold leading-snug">
                  <span className="sr-only">Step {i + 1}: </span>
                  {s.title}
                </span>
              </button>
            </Fragment>
          );
        })}
      </div>
      <div role="tabpanel" id={`${baseId}-panel`} aria-labelledby={`${baseId}-tab-${selected}`} tabIndex={0} className="card hiw-panel p-6 focus-visible:outline-2 focus-visible:outline-offset-2">
        <div key={selected} className="hiw-body space-y-3">
        <h2 className="text-[clamp(22px,2.6vw,28px)] font-semibold">{step.title}</h2>
        {step.body.map((line) => (
          <p key={line} className="text-text-2">
            {line}
          </p>
        ))}
        </div>
      </div>
    </div>
  );
}
