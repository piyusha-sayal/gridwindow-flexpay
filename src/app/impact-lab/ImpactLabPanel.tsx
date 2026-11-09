"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { PREFERENCES, TARIFFS, impactScenarioSchema, type ImpactScenarioInput, type PortOption, type PreferenceId, type TariffId } from "./scenario";
import { ImpactResults } from "./ImpactResults";
import type { ImpactComparison } from "@/server/services/impactService";

interface ImpactLabPanelProps {
  ports: readonly PortOption[];
  timeZone: string;
  initialScenario: ImpactScenarioInput;
  initialComparison: ImpactComparison | null;
  initialError: string | null;
}

/** Form state keeps the kWh field as typed text until it is validated. */
type FormState = Omit<ImpactScenarioInput, "kWh"> & { kWh: string };

function messageOf(body: unknown, fallback: string): string {
  if (typeof body === "object" && body !== null && "error" in body) {
    const error: unknown = body.error;
    if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") return error.message;
  }
  return fallback;
}

async function requestComparison(input: ImpactScenarioInput): Promise<ImpactComparison> {
  const res = await fetch("/api/impact/compare", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new Error(messageOf(body, "The comparison could not be run. Try again."));
  if (typeof body !== "object" || body === null || !("comparison" in body)) throw new Error("The comparison response was incomplete.");
  return body.comparison as ImpactComparison;
}

export function ImpactLabPanel({ ports, timeZone, initialScenario, initialComparison, initialError }: ImpactLabPanelProps) {
  const [form, setForm] = useState<FormState>({ ...initialScenario, kWh: String(initialScenario.kWh) });
  const [comparison, setComparison] = useState<ImpactComparison | null>(initialComparison);
  const [error, setError] = useState<string | null>(initialError);
  const [pending, setPending] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = impactScenarioSchema.safeParse({ ...form, kWh: Number(form.kWh) });
    if (!parsed.success) {
      setError(`Check the form: ${parsed.error.issues.map((i) => i.path.join(".") || "input").join(", ")} ${parsed.error.issues.length > 1 ? "are" : "is"} not valid.`);
      return;
    }
    setPending(true);
    setError(null);
    try {
      setComparison(await requestComparison(parsed.data));
    } catch (err: unknown) {
      setComparison(null);
      setError(err instanceof Error ? err.message : "The comparison could not be run. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-6" aria-labelledby="compare-title">
      <div className="space-y-2 max-w-[820px]">
        <h2 id="compare-title" className="text-[22px] font-semibold tracking-[-0.01em]">
          Compare Charge Now and Smart Flex
        </h2>
        <p className="text-[15px] text-text-2">
          Change the inputs and compare. This runs the same quote engine as Smart Charge, but nothing is saved, reserved or priced for payment.
        </p>
        <Link href="/drive" className="inline-block text-teal-ink underline underline-offset-4">
          Back to Smart Charge
        </Link>
      </div>

      <form onSubmit={onSubmit} className="card p-5 sm:p-6 grid gap-5 grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))]" aria-describedby="form-help">
        <p id="form-help" className="sr-only">
          Times are local to the station. Plug-in and ready-by times in the early morning belong to the next day.
        </p>
        <div className="space-y-1.5">
          <label htmlFor="kwh" className="block text-[14px] font-semibold">
            Charging energy (kWh)
          </label>
          <input id="kwh" name="kWh" type="number" inputMode="decimal" min="0.01" max="120" step="0.01" className="field w-full" value={form.kWh} onChange={(e) => set("kWh", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="port" className="block text-[14px] font-semibold">
            Port
          </label>
          <select id="port" name="portId" className="field w-full" value={form.portId} onChange={(e) => set("portId", e.target.value)}>
            {ports.map((p) => (
              <option key={p.id} value={p.id}>
                {`Port ${p.label}, ${(p.maxPowerW / 1000).toFixed(1)} kW, ${p.tier}`}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="night" className="block text-[14px] font-semibold">
            Night of (date you plug in)
          </label>
          <input id="night" name="nightOf" type="date" className="field w-full" value={form.nightOf} onChange={(e) => set("nightOf", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="plugin" className="block text-[14px] font-semibold">
            Plug-in time
          </label>
          <input id="plugin" name="plugInLocal" type="time" step={900} className="field w-full" value={form.plugInLocal} onChange={(e) => set("plugInLocal", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="readyby" className="block text-[14px] font-semibold">
            Ready-by time
          </label>
          <input id="readyby" name="readyByLocal" type="time" step={900} className="field w-full" value={form.readyByLocal} onChange={(e) => set("readyByLocal", e.target.value)} />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-[14px] font-semibold">Charging preference</legend>
          {PREFERENCES.map((p) => (
            <label key={p.id} className="flex gap-2 text-[14px]">
              <input type="radio" name="preference" value={p.id} checked={form.preference === p.id} onChange={() => set("preference", p.id as PreferenceId)} className="mt-1" />
              <span>
                <span className="font-semibold">{p.label}</span>
                <span className="block text-muted">{p.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-[14px] font-semibold">Tariff assumption (synthetic)</legend>
          {TARIFFS.map((t) => (
            <label key={t.id} className="flex gap-2 text-[14px]">
              <input type="radio" name="tariff" value={t.id} checked={form.tariff === t.id} onChange={() => set("tariff", t.id as TariffId)} className="mt-1" />
              <span>{t.label}</span>
            </label>
          ))}
        </fieldset>
        <div className="flex items-end">
          <button type="submit" className="btn btn-primary" disabled={pending} aria-disabled={pending}>
            {pending ? "Comparing..." : "Compare"}
          </button>
        </div>
      </form>

      <div aria-live="polite" className="space-y-3">
        {error && (
          <p role="alert" className="card p-4 text-[14px] text-[var(--red)]">
            {error}
          </p>
        )}
        {pending && <p className="text-[14px] text-muted">Running the comparison...</p>}
      </div>

      {comparison && !pending && <ImpactResults comparison={comparison} ports={ports} timeZone={timeZone} />}
    </section>
  );
}
