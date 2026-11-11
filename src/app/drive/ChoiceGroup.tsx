"use client";

import { Fragment, useState } from "react";

export interface Choice {
  id: string;
  label: string;
  /** Short facts shown under the label, for example the rated power. */
  meta: string[];
  summary: string;
  benefitTitle: string;
  benefit: string;
  tradeoffTitle: string;
  tradeoff: string;
}

interface ChoiceGroupProps {
  name: string;
  labelledBy: string;
  describedBy?: string;
  value: string;
  choices: readonly Choice[];
  inputId?: (choiceId: string) => string;
  onChange: (choiceId: string) => void;
}

/**
 * Radio cards with a one-line summary and a details panel that covers both sides of the choice.
 * Hover previews a card, the checked card is always explained (keyboard and touch), and every radio
 * is described to screen readers by the same text, so nothing depends on a hover-only tooltip.
 */
export function ChoiceGroup({ name, labelledBy, describedBy, value, choices, inputId, onChange }: ChoiceGroupProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const shown = choices.find((c) => c.id === (hovered ?? value)) ?? choices.find((c) => c.id === value) ?? choices[0];
  const previewing = shown !== undefined && shown.id !== value;
  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-labelledby={labelledBy} aria-describedby={describedBy} className="stagger grid gap-2 grid-cols-[repeat(auto-fit,minmax(min(190px,100%),1fr))]">
        {choices.map((c) => {
          const on = value === c.id;
          return (
            <Fragment key={c.id}>
            <label
              onMouseEnter={() => setHovered(c.id)}
              onMouseLeave={() => setHovered(null)}
              className={`choice-card relative flex min-h-[72px] cursor-pointer flex-col gap-0.5 rounded-[var(--r-input)] border px-4 py-2.5 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-teal-ink ${on ? "choice-card-on border-navy bg-navy text-white" : "border-line-strong bg-surface hover:border-ink"}`}
            >
              <input
                id={inputId?.(c.id)}
                type="radio"
                name={name}
                value={c.id}
                checked={on}
                onChange={() => onChange(c.id)}
                aria-describedby={`${name}-${c.id}-more`}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
              <span className="block text-[16px] font-semibold">{c.label}</span>
              {c.meta.map((m) => (
                <span key={m} className={`block text-[12px] ${on ? "text-on-navy-muted" : "text-muted"}`}>
                  {m}
                </span>
              ))}
              <span className={`block text-[13px] leading-snug ${on ? "text-on-navy-muted" : "text-text-2"}`}>{c.summary}</span>
            </label>
            <span id={`${name}-${c.id}-more`} className="sr-only">
              {c.benefitTitle} {c.benefit} {c.tradeoffTitle} {c.tradeoff}
            </span>
            </Fragment>
          );
        })}
      </div>
      {shown && (
        <div className="choice-details grid gap-x-6 gap-y-2 rounded-[var(--r-card-sm)] border border-line bg-paper px-4 py-3 sm:grid-cols-2" data-testid={`${name}-details`}>
          <div className="space-y-0.5">
            <p className="meta">{shown.label}{previewing ? " (preview, select to choose)" : ""}</p>
            <p className="text-[14px] font-semibold">{shown.benefitTitle}</p>
            <p className="text-[14px] text-text-2">{shown.benefit}</p>
          </div>
          <div className="space-y-0.5 sm:pt-[22px]">
            <p className="text-[14px] font-semibold">{shown.tradeoffTitle}</p>
            <p className="text-[14px] text-text-2">{shown.tradeoff}</p>
          </div>
        </div>
      )}
    </div>
  );
}
