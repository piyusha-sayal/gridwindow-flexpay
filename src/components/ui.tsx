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

/**
 * Provenance stays one click away instead of a banner: the text says whether a model wrote this or the
 * deterministic fallback did, so a fallback answer is never presented as an AI answer.
 */
/**
 * What the provenance details say. A model answer names the model; a fallback is always labelled deterministic and never as
 * a model. When the fallback was used because a configured provider failed (not because none is configured), the summary
 * says so too, so an operator can see a provider failure without opening the details.
 */
export function aiSourceText(src: AiSource): { summary: string; detail: string } {
  if (src.source === "MODEL") return { summary: "How this was generated", detail: `AI · ${src.model} · numbers verified against backend` };
  const failed = src.reason !== "NOT_CONFIGURED";
  return {
    summary: failed ? "How this was generated · fallback used" : "How this was generated",
    detail: `Deterministic fallback (no AI) · ${FALLBACK_COPY[src.reason] ?? src.reason}`,
  };
}

export function AiSourceBadge({ src }: { src: AiSource }) {
  const t = aiSourceText(src);
  return (
    <details className="disclosure ai-source text-[12px] text-muted">
      <summary className="cursor-pointer">
        <span aria-hidden="true" className="ico ico-spark" />
        {t.summary}
      </summary>
      <p className="ai-source-note mt-2">{t.detail}</p>
    </details>
  );
}

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
