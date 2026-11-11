"use client";

export type WizardStep = 1 | 2 | 3;

const STEPS = ["Your Needs", "Compare Plans", "Confirm & PayPal", "Charging Simulation", "Receipt"] as const;

interface StepProgressProps {
  step: WizardStep;
  /** Steps the driver can return to (already completed in this session). */
  reachable: (s: WizardStep) => boolean;
  onGo: (s: WizardStep) => void;
}

/** Five-step progress: steps 4–5 live on the reservation page and are shown for orientation only. */
export function StepProgress({ step, reachable, onGo }: StepProgressProps) {
  return (
    <nav aria-label="Charging steps" className="stepper">
      <ol className="stepper-track hidden min-[760px]:grid grid-cols-5 font-mono text-[12px] tracking-[0.06em] uppercase" style={{ "--step": step } as React.CSSProperties}>
        {STEPS.map((name, i) => {
          const n = (i + 1) as WizardStep;
          const done = n < step;
          const current = n === step;
          const label = `${String(n).padStart(2, "0")} ${name}${done ? " ✓" : ""}`;
          return (
            <li key={name} className={`stepper-item ${done ? "is-done" : current ? "is-current" : ""}`}>
              <span aria-hidden="true" className="stepper-node" />
              {done && reachable(n) ? (
                <button type="button" className="stepper-link" onClick={() => onGo(n)}>
                  {label}
                </button>
              ) : (
                <span aria-current={current ? "step" : undefined} className={`stepper-text ${current ? "text-ink" : done ? "text-teal-ink" : "text-muted"}`}>
                  {label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <div className="min-[760px]:hidden py-3 space-y-2">
        <div className="flex items-center justify-between font-mono text-[12px] tracking-[0.06em] uppercase">
          <span aria-current="step">
            Step {step} / 5 · {STEPS[step - 1]}
          </span>
          {step > 1 && (
            <button type="button" className="stepper-back text-teal-ink" onClick={() => onGo((step - 1) as WizardStep)}>
              ‹ Back
            </button>
          )}
        </div>
        <div className="stepper-bar" aria-hidden="true">
          <span className="stepper-fill block h-full" style={{ width: `${(step / 5) * 100}%`, transition: "width var(--t-slow) var(--ease)" }} />
        </div>
      </div>
    </nav>
  );
}
