"use client";

export type WizardStep = 1 | 2 | 3;

const STEPS = ["Request", "Offers", "Approve", "Charge", "Receipt"] as const;

interface StepProgressProps {
  step: WizardStep;
  /** Steps the driver can return to (already completed in this session). */
  reachable: (s: WizardStep) => boolean;
  onGo: (s: WizardStep) => void;
}

/** Five-step progress: steps 4–5 live on the reservation page and are shown for orientation only. */
export function StepProgress({ step, reachable, onGo }: StepProgressProps) {
  return (
    <nav aria-label="Charging steps" className="border-b border-line">
      <ol className="hidden min-[760px]:flex flex-wrap gap-x-6 font-mono text-[12px] tracking-[0.06em] uppercase">
        {STEPS.map((name, i) => {
          const n = (i + 1) as WizardStep;
          const done = n < step;
          const current = n === step;
          const label = `${String(n).padStart(2, "0")} ${name}${done ? " ✓" : ""}`;
          return (
            <li key={name}>
              {done && reachable(n) ? (
                <button type="button" className="py-3 text-teal-ink hover:underline underline-offset-4" onClick={() => onGo(n)}>
                  {label}
                </button>
              ) : (
                <span aria-current={current ? "step" : undefined} className={`block py-3 ${current ? "text-ink shadow-[inset_0_-2px_0_var(--teal)]" : done ? "text-teal-ink" : "text-muted"}`}>
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
            <button type="button" className="text-teal-ink py-1" onClick={() => onGo((step - 1) as WizardStep)}>
              ‹ Back
            </button>
          )}
        </div>
        <div className="h-[2px] bg-line-2" aria-hidden="true">
          <span className="block h-full bg-teal" style={{ width: `${(step / 5) * 100}%`, transition: "width var(--t-slow) var(--ease)" }} />
        </div>
      </div>
    </nav>
  );
}
