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

export function PaymentBadge({ state }: { state: string }) {
  const p = PAYMENT[state] ?? { tone: "neutral" as const, label: state };
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
  default: "card kpi",
  hero: "card kpi kpi-hero",
  "hero-navy": "card card-navy kpi kpi-hero",
  attention: "card kpi kpi-hero kpi-attention",
  strip: "kpi px-0 py-3",
};

export function Kpi({ label, value, hint, variant = "default", children }: { label: string; value: ReactNode; hint?: ReactNode; variant?: KpiVariant; children?: ReactNode }) {
  const navy = variant === "hero-navy";
  return (
    <div className={KPI_CLASS[variant]}>
      <span className="meta">{label}</span>
      <span className="kpi-value">{value}</span>
      {children}
      {hint && <span className={`text-[13px] ${navy ? "text-on-navy-body" : "text-muted"}`}>{hint}</span>}
    </div>
  );
}

export type AiSource = { source: "MODEL"; model: string } | { source: "DETERMINISTIC_FALLBACK"; reason: string };

const FALLBACK_COPY: Record<string, string> = {
  NOT_CONFIGURED: "AI not configured on this server",
  UNAVAILABLE: "AI service unavailable",
  TIMEOUT: "AI service timed out",
  REFUSED: "AI declined the request",
  INVALID_OUTPUT: "AI output was malformed or incomplete",
  SCHEMA_MISMATCH: "AI output failed validation",
  UNGROUNDED_OUTPUT: "AI used numbers not from the backend",
  AUTH_FAILED: "AI service rejected the server's credentials",
  QUOTA_EXHAUSTED: "AI service quota reached",
  REQUEST_REJECTED: "AI service rejected the request",
};

/** Always tells the user whether text came from the model or the deterministic fallback. */
export function AiSourceBadge({ src }: { src: AiSource }) {
  return src.source === "MODEL" ? (
    <Badge tone="info">AI · {src.model} · numbers verified against backend</Badge>
  ) : (
    <Badge tone="neutral">Deterministic fallback (no AI) · {FALLBACK_COPY[src.reason] ?? src.reason}</Badge>
  );
}

export function Alert({ tone, title, children }: { tone: Tone; title?: string; children?: ReactNode }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`card p-4 tone-${tone}`}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className="text-sm mt-0.5">{children}</div>}
    </div>
  );
}
