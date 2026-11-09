import { formatLocalTime } from "@/domain/time";
import { formatKWh } from "@/domain/units";
import type { RecoveryReceipt } from "@/server/services/recoveryReceipt";
import { ATTRIBUTION_LABEL, DISTURBANCE_LABEL, FORECAST_NOTE, formatShortfallWh, RUN_STATUS_LABEL } from "./recoveryCopy";
import { Badge } from "./ui";

/** Actual synthetic delivery against the target. Shows the shortfall in plain words; a forecast never appears here. */
export function EnergyOutcome({ energy }: { energy: RecoveryReceipt["energy"] }) {
  if (energy.actualBatteryMilliWh === null || energy.shortfallBatteryMilliWh === null) {
    return <p className="meta">Actual delivery: not simulated yet (SYNTHETIC).</p>;
  }
  if (energy.shortfallBatteryMilliWh === 0) {
    return <p>Target met by the synthetic delivery · delivered {formatKWh(Math.round(energy.actualBatteryMilliWh / 1000))} (SYNTHETIC ledger).</p>;
  }
  return (
    <p>
      <strong className="text-red">Short of the target by {formatShortfallWh(energy.shortfallBatteryMilliWh)}</strong> · delivered{" "}
      {formatKWh(Math.round(energy.actualBatteryMilliWh / 1000))} (SYNTHETIC ledger).
    </p>
  );
}

const CONSENT_LABEL: Record<"AUTO_WITHIN_PRE_APPROVED_BOUNDS" | "DRIVER_APPROVED", string> = {
  AUTO_WITHIN_PRE_APPROVED_BOUNDS: "Applied automatically within pre-approved bounds",
  DRIVER_APPROVED: "Approved by you",
};

/**
 * Receipt body for autonomous recovery. Disturbances are SYNTHETIC simulated inputs and are labelled as such;
 * they are kept apart from PayPal Sandbox payment evidence, which is listed in the payment section.
 */
export function RecoveryDetails({ recovery, timeZone }: { recovery: RecoveryReceipt; timeZone: string }) {
  return (
    <div className="space-y-5 text-[14px]">
      <p className="text-muted">{recovery.evidenceStatement}</p>
      <p>
        AI used: <strong>{recovery.aiUsed ? "yes (text only, checked against backend numbers)" : "no"}</strong>
      </p>

      <div className="space-y-2">
        <h3 className="font-semibold">Original commitment</h3>
        <p>
          Parked {formatLocalTime(recovery.originalSchedule.plugInMs, timeZone)} to departure {formatLocalTime(recovery.originalSchedule.departMs, timeZone)} ·{" "}
          {formatKWh(recovery.originalSchedule.targetBatteryWh)} target · {recovery.originalSchedule.chargingSlots} charging slots · peak{" "}
          {(recovery.originalSchedule.peakPowerW / 1000).toFixed(1)} kW
        </p>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold">Energy against the agreed target</h3>
        <p>
          Target {formatKWh(recovery.energy.targetBatteryWh)} to battery · planned (forecast) {formatKWh(recovery.energy.forecastBatteryWh)}
          <span className="block meta">{FORECAST_NOTE}</span>
        </p>
        <EnergyOutcome energy={recovery.energy} />
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold">Disturbances</h3>
        <ul className="space-y-1">
          {recovery.disturbances.map((d) => (
            <li key={d.eventId} className="flex flex-wrap items-center gap-2">
              <span>
                {DISTURBANCE_LABEL[d.type]} from {formatLocalTime(d.effectiveAtMs, timeZone)}
              </span>
              <Badge tone="neutral">SYNTHETIC</Badge>
              <span className="meta">{ATTRIBUTION_LABEL[d.attribution]}</span>
              {d.runStatus && <span className="meta">{RUN_STATUS_LABEL[d.runStatus]}</span>}
            </li>
          ))}
        </ul>
      </div>

      {recovery.runs.map((run) => (
        <div key={run.runId} className="space-y-2">
          <h3 className="font-semibold">Recovery run · {RUN_STATUS_LABEL[run.status]}</h3>
          {run.reason && <p>{run.reason}</p>}
          <p className="meta">
            Consent: {run.consent ? (run.consent.method === "DRIVER_APPROVED" ? `${CONSENT_LABEL.DRIVER_APPROVED} (version ${run.consent.version})` : CONSENT_LABEL.AUTO_WITHIN_PRE_APPROVED_BOUNDS) : "no schedule version was written"}
          </p>
          {run.candidates.length > 0 && (
            <ul className="space-y-1">
              {run.candidates.map((c, i) => (
                <li key={`${c.preference}-${i}`}>
                  {c.preference}: {c.chosen ? "chosen" : c.status === "REJECTED" ? "rejected" : "considered"}
                  {c.reason ? ` · ${c.reason}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      <div className="space-y-2">
        <h3 className="font-semibold">Schedule versions</h3>
        <ul className="space-y-2">
          {recovery.versions.map((v) => (
            <li key={v.version} className="tabular">
              v{v.version} · {v.source.toLowerCase()} · {v.reason}
              <span className="block meta">
                {v.effectiveFromMs === null ? "effective from: not recorded" : `effective from ${formatLocalTime(v.effectiveFromMs, timeZone)}`} · planned{" "}
                forecast {formatKWh(v.plannedBatteryWh)} ·{" "}
                {v.deliveredBatteryMilliWh === null ? "actual: not simulated" : `actual ${formatKWh(Math.round(v.deliveredBatteryMilliWh / 1000))} (SYNTHETIC ledger)`}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
