/** Shared presentational primitives: one tone vocabulary for every status in the app. */
import type { ReactNode } from "react";

export type Tone = "neutral" | "success" | "warn" | "danger" | "info";

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`badge tone-${tone}`}>{children}</span>;
}

const PAYMENT: Record<string, { tone: Tone; label: string }> = {
  QUOTE_ACCEPTED: { tone: "neutral", label: "Starting checkout" },
  ORDER_CREATED: { tone: "neutral", label: "Awaiting approval" },
  BUYER_APPROVED: { tone: "info", label: "Approved" },
  AUTHORIZED: { tone: "info", label: "Authorized hold · not captured" },
  CAPTURE_PENDING: { tone: "warn", label: "Capture pending · not final" },
  CAPTURED: { tone: "success", label: "Captured · paid" },
  CAPTURE_DECLINED: { tone: "danger", label: "Capture declined · not collected" },
  VOIDED: { tone: "neutral", label: "Voided · not collected" },
  CANCELLED: { tone: "neutral", label: "Cancelled" },
  FAILED: { tone: "danger", label: "Failed" },
  NEEDS_RECONCILIATION: { tone: "warn", label: "Needs reconciliation" },
};

const SERVICE: Record<string, { tone: Tone; label: string }> = {
  PENDING: { tone: "neutral", label: "Not scheduled" },
  SCHEDULED: { tone: "info", label: "Scheduled" },
  DELIVERED: { tone: "success", label: "Delivered" },
  FAILED: { tone: "danger", label: "Charging failed" },
  CANCELLED: { tone: "neutral", label: "Cancelled" },
};

/** `capacityConfirmed=false` marks a provider authorization whose station capacity commit is still unresolved. */
export function PaymentBadge({ state, capacityConfirmed = true }: { state: string; capacityConfirmed?: boolean }) {
  const unconfirmed = state === "AUTHORIZED" && !capacityConfirmed;
  const p = unconfirmed ? { tone: "warn" as const, label: "Authorized at provider · charging capacity not yet confirmed" } : (PAYMENT[state] ?? { tone: "neutral" as const, label: state });
  return (
    <Badge tone={p.tone}>
      <span className="sr-only">Payment: </span>
      {p.label}
    </Badge>
  );
}

export function ServiceBadge({ state }: { state: string }) {
  const p = SERVICE[state] ?? { tone: "neutral" as const, label: state };
  return (
    <Badge tone={p.tone}>
      <span className="sr-only">Charging: </span>
      {p.label}
    </Badge>
  );
}

/** Payment states that need an operator's eye (never shown as financial success). */
export const ATTENTION_STATES = new Set(["NEEDS_RECONCILIATION", "CAPTURE_PENDING", "CAPTURE_DECLINED", "FAILED"]);

export type KpiVariant = "default" | "hero" | "hero-navy" | "attention" | "strip";

const KPI_CLASS: Record<KpiVariant, string> = {
  default: "card kpi kpi-default",
  hero: "card kpi kpi-hero kpi-glow",
  "hero-navy": "card card-navy kpi kpi-hero kpi-navy",
  attention: "card kpi kpi-hero kpi-attention",
  strip: "kpi kpi-strip",
};

export function Kpi({ label, value, hint, variant = "default", children }: { label: string; value: ReactNode; hint?: ReactNode; variant?: KpiVariant; children?: ReactNode }) {
  const navy = variant === "hero-navy";
  return (
    <div className={KPI_CLASS[variant]}>
      <span aria-hidden="true" className="kpi-spark" />
      <span className="meta">{label}</span>
      <span className="kpi-value">{value}</span>
      {children}
      {hint && <span className={`kpi-hint text-[13px] ${navy ? "text-on-navy-body" : "text-muted"}`}>{hint}</span>}
    </div>
  );
}

/**
 * Where an assistant answer came from, as returned by the API. Driver screens no longer print it (owner decision,
 * 2026-11-11); it stays in every API response, and recovery provenance stays on the operator's run detail.
 */
export type AiSource = { source: "MODEL"; model: string } | { source: "DETERMINISTIC_FALLBACK"; reason: string };

export function Alert({ tone, title, children }: { tone: Tone; title?: string; children?: ReactNode }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`alert card tone-${tone}`}>
      <span aria-hidden="true" className="alert-icon" />
      <div className="alert-body">
        {title && <p className="alert-title font-semibold">{title}</p>}
        {children && <div className="text-sm mt-0.5">{children}</div>}
      </div>
    </div>
  );
}
