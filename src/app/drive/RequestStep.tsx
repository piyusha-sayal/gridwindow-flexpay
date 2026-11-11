"use client";

import type { ReactNode } from "react";
import type { AiSource } from "@/components/ui";
import type { ParsedRequest } from "@/domain/nlRequest";
import { AxisTicks, FIXED_NIGHT_AXIS, pctOf } from "./NightAxis";
import { GuidedDemo } from "./GuidedDemo";
import { ChoiceGroup } from "./ChoiceGroup";
import { PORT_GUIDE, PREFERENCES, PREFERENCE_GUIDE, type DriverConfig, type FieldErrors, type FormState } from "./driverTypes";
import { AXIS_MINUTES, formatDuration, summarizeRequest } from "./requestSummary";

export type ParseResult = { parsed: ParsedRequest } & AiSource;

interface RequestStepProps {
  config: DriverConfig;
  form: FormState;
  errors: FieldErrors;
  text: string;
  parseResult: ParseResult | null;
  busy: "quote" | "parse" | null;
  onText: (t: string) => void;
  onParse: () => void;
  onUpdate: (patch: Partial<FormState>) => void;
  onSubmit: (e: React.FormEvent) => void;
}

/** Step 1: one editorial form. Validation and submission are owned by DriverFlow (unchanged rules). */
export function RequestStep({ config, form, errors, text, parseResult, busy, onText, onParse, onUpdate, onSubmit }: RequestStepProps) {
  const field = (key: keyof FormState) => ({ "aria-invalid": errors[key] ? true : undefined, "aria-describedby": `${key}-hint${errors[key] ? ` ${key}-err` : ""}` });
  const err = (key: keyof FormState) =>
    errors[key] && (
      <p id={`${key}-err`} className="field-error">
        {errors[key]}
      </p>
    );
  const port = config.station.ports.find((p) => p.id === form.portId);
  const hasErrors = Object.keys(errors).length > 0;

  return (
    <div className="step-enter space-y-8">
      <header className="space-y-3">
        <p className="meta step-kicker">
          {config.station.name} · {config.station.timeZone}
        </p>
        <h1 tabIndex={-1} className="step-title font-semibold leading-[1.02] text-[clamp(36px,5vw,56px)]">What does your car need tonight?</h1>
      </header>

      <GuidedDemo onLoad={onUpdate} />

      <section aria-labelledby="nl-label" className="space-y-2">
        <div className="say-bar flex flex-wrap items-center gap-2 p-2 pl-4">
          <span aria-hidden="true" className="ico ico-spark say-spark" />
          <span id="nl-label" className="font-mono text-[12px] tracking-[0.08em] text-teal-ink">
            SAY IT
          </span>
          <label htmlFor="nl" className="sr-only">
            Charging request in words
          </label>
          <input
            id="nl"
            className="say-input min-w-0 flex-[1_1_220px] bg-transparent py-2 text-[16px] placeholder:text-muted"
            maxLength={300}
            placeholder="Find me 30 kWh before 7 AM and save at least $4."
            value={text}
            onChange={(e) => onText(e.target.value)}
            aria-describedby="nl-help"
          />
          <button type="button" className="btn btn-primary btn-sm" onClick={onParse} disabled={busy !== null || !text.trim()}>
            {busy === "parse" ? "Reading…" : "Fill form"}
          </button>
        </div>
        <p id="nl-help" className="hint">
          Optional. The assistant only fills the form below. It can&apos;t set prices, approve, or take payments.
          {!config.ai.enabled && " AI is not configured, so a deterministic parser is used."}
        </p>
        {parseResult && (
          <div className="ai-note space-y-2 badge-wrap" aria-live="polite">
            <ul className="text-[14px] text-muted list-disc pl-5">
              {(parseResult.parsed.notes.length ? parseResult.parsed.notes : ["Form updated. Review every field before requesting offers."]).map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            {parseResult.parsed.clarifications && (
              <div role="status" className="text-[14px]">
                <p className="font-semibold">Needs your input before requesting offers</p>
                <ul className="list-disc pl-5">
                  {parseResult.parsed.clarifications.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      <form onSubmit={onSubmit} noValidate aria-label="Your charging need" className="request-form">
        <Row label={<label htmlFor="kwh">Energy<span className="sr-only"> into battery (kWh)</span></label>} hintId="targetBatteryKWh-hint" hint="Added to your battery, 0.01-120 kWh.">
          <div className="flex items-baseline gap-2">
            <input
              id="kwh"
              type="number"
              min="0.01"
              max="120"
              step="0.01"
              inputMode="decimal"
              className={`kwh-input w-[5.5ch] min-w-0 bg-transparent border-0 border-b-2 pb-1 text-[56px] font-semibold leading-none tracking-[-0.03em] tabular ${errors.targetBatteryKWh ? "border-red" : "border-ink"}`}
              value={form.targetBatteryKWh}
              onChange={(e) => onUpdate({ targetBatteryKWh: e.target.value })}
              required
              {...field("targetBatteryKWh")}
            />
            <span className="text-[20px] text-muted">kWh</span>
          </div>
          {err("targetBatteryKWh")}
        </Row>

        <Row label={<span>Parking window</span>} hint="Energy is delivered before you leave.">
          <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(min(150px,100%),1fr))]">
            <TimeField id="plugin" label="Plug in" hintId="plugInLocal-hint" hint="When you arrive." error={err("plugInLocal")}>
              <input id="plugin" type="time" step="900" className="field min-h-12" value={form.plugInLocal} onChange={(e) => onUpdate({ plugInLocal: e.target.value })} required {...field("plugInLocal")} />
            </TimeField>
            <TimeField id="depart" label="Ready by (next morning)" hintId="departLocal-hint" hint="Your charging deadline." error={err("departLocal")}>
              <input id="depart" type="time" step="900" className="field min-h-12" value={form.departLocal} onChange={(e) => onUpdate({ departLocal: e.target.value })} required {...field("departLocal")} />
            </TimeField>
            <TimeField id="night" label="Night of" hintId="nightOf-hint" hint="The evening you arrive." error={err("nightOf")}>
              <input id="night" type="date" className="field min-h-12" value={form.nightOf} onChange={(e) => onUpdate({ nightOf: e.target.value })} required {...field("nightOf")} />
            </TimeField>
          </div>
          <ParkedStrip form={form} portMaxPowerW={port?.maxPowerW ?? 0} />
        </Row>

        <Row label={<span id="port-label">Port</span>} hintId="portId-hint" hint="Where you park. Your car occupies it the whole time.">
          <ChoiceGroup
            name="port"
            labelledBy="port-label"
            describedBy="portId-hint"
            value={form.portId}
            inputId={(id) => `port-${id}`}
            onChange={(id) => onUpdate({ portId: id })}
            choices={config.station.ports.map((p) => {
              const guide = PORT_GUIDE[p.id];
              return {
                id: p.id,
                label: `Port ${p.label}`,
                meta: [`Up to ${p.maxPowerW / 1000} kW`, ...(p.tier ? [p.tier] : [])],
                summary: guide?.summary ?? p.tier ?? "",
                benefitTitle: "Why choose this port?",
                benefit: guide?.benefit ?? "Rated power is shown above.",
                tradeoffTitle: "Why might it not suit you?",
                tradeoff: guide?.tradeoff ?? "Check that the rated power can deliver your energy before your deadline.",
              };
            })}
          />
        </Row>

        <Row label={<label htmlFor="cap">Budget<span className="sr-only"> (USD)</span></label>} hintId="spendCap-hint" hint="The most you'll pay. Offers above it aren't shown.">
          <UsdInput id="cap" invalid={!!errors.spendCap} value={form.spendCap} onChange={(v) => onUpdate({ spendCap: v })} required {...field("spendCap")} />
          {err("spendCap")}
        </Row>

        <Row label={<label htmlFor="minsave">Minimum saving<span className="sr-only"> (USD, optional)</span></label>} hintId="minSavings-hint" hint="Optional. Compared with charging now.">
          <UsdInput id="minsave" invalid={!!errors.minSavings} value={form.minSavings} placeholder="any" onChange={(v) => onUpdate({ minSavings: v })} {...field("minSavings")} />
          <label className="check-row mt-2 flex items-start gap-2 text-[14px] text-text-2 cursor-pointer">
            <input id="minsave-required" type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--ink)]" checked={form.minSavingsRequired} onChange={(e) => onUpdate({ minSavingsRequired: e.target.checked })} />
            <span>Require this saving. Offers that save less cannot be approved.</span>
          </label>
          {err("minSavings")}
        </Row>

        <Row label={<span id="pref-label">Preference</span>} hintId="preference-hint" hint="Highlights a matching offer. Every offer meets your deadline.">
          <ChoiceGroup
            name="preference"
            labelledBy="pref-label"
            describedBy="preference-hint"
            value={form.preference}
            onChange={(id) => onUpdate({ preference: id as FormState["preference"] })}
            choices={PREFERENCES.map((p) => ({
              id: p.value,
              label: p.label,
              meta: [],
              summary: PREFERENCE_GUIDE[p.value].summary,
              benefitTitle: "What it does",
              benefit: PREFERENCE_GUIDE[p.value].benefit,
              tradeoffTitle: "Trade-off",
              tradeoff: PREFERENCE_GUIDE[p.value].tradeoff,
            }))}
          />
        </Row>

        <div className="form-actions flex flex-wrap items-center gap-4 pt-6">
          <button type="submit" className="btn btn-primary btn-lg btn-glow" disabled={busy !== null}>
            {busy === "quote" ? (
              "Finding offers…"
            ) : (
              <>
                See offers <span aria-hidden="true" className="btn-arrow">→</span>
              </>
            )}
          </button>
          {busy === "quote" && (
            <p className="meta working" aria-live="polite">
              Checking port, station capacity and tariff windows…
            </p>
          )}
          {hasErrors && (
            <p role="alert" className="text-[14px] text-red">
              Fix the highlighted fields to continue.
            </p>
          )}
        </div>
      </form>
    </div>
  );
}

interface UsdInputProps {
  id: string;
  value: string;
  invalid: boolean;
  placeholder?: string;
  required?: boolean;
  onChange: (value: string) => void;
}

function UsdInput({ id, value, invalid, placeholder, required, onChange, ...aria }: UsdInputProps & { "aria-invalid"?: boolean; "aria-describedby": string }) {
  return (
    <div className={`usd-field flex max-w-[220px] items-center rounded-[var(--r-input)] border ${invalid ? "border-red" : "border-line-strong"}`}>
      <span className="pl-3 text-muted" aria-hidden="true">
        $
      </span>
      <input id={id} inputMode="decimal" className="min-h-12 min-w-0 flex-1 bg-transparent px-2 text-[16px] tabular placeholder:text-faint" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} required={required} {...aria} />
      <span className="pr-3 font-mono text-[12px] text-muted" aria-hidden="true">
        USD
      </span>
    </div>
  );
}

function Row({ label, hint, hintId, children }: { label: ReactNode; hint: string; hintId?: string; children: ReactNode }) {
  return (
    <div className="form-row flex flex-wrap gap-x-8 gap-y-3 py-6">
      <div className="flex-[0_1_220px] min-w-[180px]">
        <div className="text-[17px] font-semibold">{label}</div>
        <p id={hintId} className="mt-1.5 text-[14px] leading-snug text-muted">
          {hint}
        </p>
      </div>
      <div className="flex-[999_1_320px] min-w-0 space-y-3">{children}</div>
    </div>
  );
}

function TimeField({ id, label, hint, hintId, error, children }: { id: string; label: string; hint: string; hintId: string; error: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {children}
      <p id={hintId} className="hint">
        {hint}
      </p>
      {error}
    </div>
  );
}

/** Parked span (hatched) and the full-power charge it needs (solid), on the 18:00 → 10:00 axis. */
function ParkedStrip({ form, portMaxPowerW }: { form: FormState; portMaxPowerW: number }) {
  const s = summarizeRequest(form, portMaxPowerW);
  if (!s) return null;
  const clamp = (m: number) => Math.min(AXIS_MINUTES, Math.max(0, m));
  const pct = (m: number) => pctOf(clamp(m), AXIS_MINUTES);
  const fits = s.chargeMin <= s.parkedMin;
  return (
    <div className="space-y-1.5 pt-1">
      <div className="parked-track relative h-6 rounded-[6px] bg-[var(--chart-track)]" aria-hidden="true">
        <span className="hatch parked-span absolute inset-y-0 rounded-[6px] opacity-60" style={{ left: pct(s.plugInMin), width: `calc(${pct(s.departMin)} - ${pct(s.plugInMin)})` }} />
        <span className="parked-charge absolute inset-y-0 rounded-[6px] bg-teal" style={{ left: pct(s.plugInMin), width: `calc(${pct(Math.min(s.departMin, s.plugInMin + s.chargeMin))} - ${pct(s.plugInMin)})` }} />
      </div>
      <AxisTicks axis={FIXED_NIGHT_AXIS} />
      <p className="flex flex-wrap gap-x-5 gap-y-1 meta">
        <span className="text-ink">
          ≈ {formatDuration(s.chargeMin)} of charging at {s.portKw} kW
        </span>
        <span className={fits ? "" : "text-red"}>{fits ? `${formatDuration(s.parkedMin - s.chargeMin)} of flexibility` : "Not enough time parked"}</span>
      </p>
    </div>
  );
}
