"use client";

import type { ReactNode } from "react";
import { AiSourceBadge, type AiSource } from "@/components/ui";
import type { ParsedRequest } from "@/domain/nlRequest";
import { AxisTicks, FIXED_NIGHT_AXIS, pctOf } from "./NightAxis";
import { PREFERENCES, type DriverConfig, type FieldErrors, type FormState } from "./driverTypes";
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
    <div className="space-y-8">
      <header className="space-y-3">
        <p className="meta">
          {config.station.name} · {config.station.timeZone}
        </p>
        <h1 tabIndex={-1} className="font-semibold tracking-[-0.03em] leading-[1.05] text-[clamp(34px,4.6vw,48px)]">What does your car need tonight?</h1>
      </header>

      <section aria-labelledby="nl-label" className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--r-card-sm)] border border-line bg-surface p-2 pl-4 focus-within:border-ink">
          <span id="nl-label" className="font-mono text-[12px] tracking-[0.08em] text-teal-ink">
            SAY IT
          </span>
          <label htmlFor="nl" className="sr-only">
            Charging request in words
          </label>
          <input
            id="nl"
            className="min-w-0 flex-[1_1_220px] bg-transparent py-2 text-[16px] outline-none placeholder:text-faint"
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
          <div className="space-y-1 badge-wrap" aria-live="polite">
            <AiSourceBadge src={parseResult} />
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

      <form onSubmit={onSubmit} noValidate aria-label="Your charging need">
        <Row label={<label htmlFor="kwh">Energy<span className="sr-only"> into battery (kWh)</span></label>} hintId="targetBatteryKWh-hint" hint="Added to your battery, 0.01–120 kWh.">
          <div className="flex items-baseline gap-2">
            <input
              id="kwh"
              type="number"
              min="0.01"
              max="120"
              step="0.01"
              inputMode="decimal"
              className={`w-[5.5ch] min-w-0 bg-transparent border-0 border-b-2 pb-1 text-[56px] font-semibold leading-none tracking-[-0.03em] tabular ${errors.targetBatteryKWh ? "border-red" : "border-ink"}`}
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

        <Row label={<span id="port-label">Port</span>} hintId="portId-hint" hint="Where you're parked. Your car occupies it the whole time.">
          <div role="radiogroup" aria-labelledby="port-label" aria-describedby="portId-hint" className="flex flex-wrap gap-2">
            {config.station.ports.map((p) => {
              const on = form.portId === p.id;
              return (
                <label
                  key={p.id}
                  className={`relative flex-[1_1_90px] min-h-[60px] cursor-pointer rounded-[var(--r-input)] border px-4 py-2.5 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-teal-ink ${on ? "border-ink bg-ink text-white" : "border-line-strong bg-surface hover:border-ink"}`}
                >
                  <input id={`port-${p.id}`} type="radio" name="port" value={p.id} checked={on} onChange={() => onUpdate({ portId: p.id })} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
                  <span className="block text-[16px] font-semibold">Port {p.label}</span>
                  <span className={`block font-mono text-[11px] tracking-[0.06em] uppercase ${on ? "text-on-navy-muted" : "text-muted"}`}>Up to {p.maxPowerW / 1000} kW</span>
                </label>
              );
            })}
          </div>
        </Row>

        <Row label={<label htmlFor="cap">Budget<span className="sr-only"> (USD)</span></label>} hintId="spendCap-hint" hint="The most you'll pay. Offers above it aren't shown.">
          <UsdInput id="cap" invalid={!!errors.spendCap} value={form.spendCap} onChange={(v) => onUpdate({ spendCap: v })} required {...field("spendCap")} />
          {err("spendCap")}
        </Row>

        <Row label={<label htmlFor="minsave">Minimum saving<span className="sr-only"> (USD, optional)</span></label>} hintId="minSavings-hint" hint="Optional. Versus charging now. A preference unless you require it; a required saving blocks approving any offer that saves less.">
          <UsdInput id="minsave" invalid={!!errors.minSavings} value={form.minSavings} placeholder="any" onChange={(v) => onUpdate({ minSavings: v })} {...field("minSavings")} />
          <label className="mt-2 flex items-start gap-2 text-[14px] text-text-2 cursor-pointer">
            <input id="minsave-required" type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--ink)]" checked={form.minSavingsRequired} onChange={(e) => onUpdate({ minSavingsRequired: e.target.checked })} />
            <span>Require this saving: don&apos;t let me approve an offer that saves less</span>
          </label>
          {err("minSavings")}
        </Row>

        <Row label={<span id="pref-label">Preference</span>} hintId="preference-hint" hint="Highlights a matching offer. Every offer meets your deadline.">
          <div className="seg" role="radiogroup" aria-labelledby="pref-label" aria-describedby="preference-hint">
            {PREFERENCES.map((p) => (
              <label key={p.value}>
                <input type="radio" name="preference" value={p.value} checked={form.preference === p.value} onChange={() => onUpdate({ preference: p.value })} />
                {p.label}
              </label>
            ))}
          </div>
        </Row>

        <div className="flex flex-wrap items-center gap-4 border-t border-line pt-6">
          <button type="submit" className="btn btn-primary btn-lg" disabled={busy !== null}>
            {busy === "quote" ? (
              "Finding offers…"
            ) : (
              <>
                See offers <span aria-hidden="true">→</span>
              </>
            )}
          </button>
          {busy === "quote" && (
            <p className="meta" aria-live="polite">
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
    <div className={`flex max-w-[220px] items-center rounded-[var(--r-input)] border bg-surface focus-within:border-ink ${invalid ? "border-red" : "border-line-strong"}`}>
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
    <div className="flex flex-wrap gap-x-8 gap-y-3 border-t border-line py-6">
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
      <div className="relative h-5 rounded-[3px] bg-[var(--chart-track)]" aria-hidden="true">
        <span className="hatch absolute inset-y-0 rounded-[3px] opacity-60" style={{ left: pct(s.plugInMin), width: `calc(${pct(s.departMin)} - ${pct(s.plugInMin)})` }} />
        <span className="absolute inset-y-0 rounded-[3px] bg-teal" style={{ left: pct(s.plugInMin), width: `calc(${pct(Math.min(s.departMin, s.plugInMin + s.chargeMin))} - ${pct(s.plugInMin)})` }} />
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
