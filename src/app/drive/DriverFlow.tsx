"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, ERROR_COPY } from "@/components/api";
import { Alert } from "@/components/ui";
import type { QuoteSet } from "@/domain/quotes";
import { formatUsd, usdToCents } from "@/domain/units";
import { MobileOfferBar, RequestCard, SelectedCard } from "./DriverAside";
import { pad2, PREFERENCES, validateForm, type DealResult, type DealState, type DriverConfig, type FieldErrors, type FormState } from "./driverTypes";
import { OffersStep } from "./OffersStep";
import { RequestStep, type ParseResult } from "./RequestStep";
import { StepProgress, type WizardStep } from "./StepProgress";
import { TermsApproval } from "./TermsApproval";

function useCountdown(expiresAtMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAtMs) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [expiresAtMs]);
  return expiresAtMs ? Math.max(0, Math.floor((expiresAtMs - now) / 1000)) : 0;
}

type Busy = "quote" | "accept" | "parse" | null;

const FIELD_ORDER: (keyof FormState)[] = ["targetBatteryKWh", "plugInLocal", "departLocal", "nightOf", "portId", "spendCap", "minSavings"];
const fieldId = (key: keyof FormState, form: FormState) =>
  ({ targetBatteryKWh: "kwh", plugInLocal: "plugin", departLocal: "depart", nightOf: "night", portId: `port-${form.portId}`, spendCap: "cap", minSavings: "minsave", minSavingsRequired: "minsave-required", preference: "port" })[key];

const minSavingsCents = (form: FormState) => {
  const v = (form.minSavings ?? "").replace(/^\$/, "").trim();
  return v ? usdToCents(v) : null;
};

/** Session-only draft so reloads and back/forward keep the request. Cleared once checkout starts. */
const DRAFT_KEY = "gridwindow.driver.draft.v1";
interface Draft {
  form: FormState;
  text: string;
  quote: QuoteSet | null;
  selected: string | null;
  step: WizardStep;
}

function readDraft(): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    const d = raw ? (JSON.parse(raw) as Partial<Draft>) : null;
    return d && d.form && typeof d.form.portId === "string" ? { form: { ...d.form, minSavings: d.form.minSavings ?? "", minSavingsRequired: d.form.minSavingsRequired ?? false }, text: d.text ?? "", quote: d.quote ?? null, selected: d.selected ?? null, step: d.step ?? 1 } : null;
  } catch {
    return null;
  }
}

function writeDraft(d: Draft | null) {
  try {
    if (d) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Storage unavailable (private mode or quota): the flow still works without a saved draft.
  }
}

function resumesNavigation(): boolean {
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  return nav?.type === "reload" || nav?.type === "back_forward";
}

const IMPACT_PREFERENCE = { lowest_cost: "lowest_price", early_finish: "finish_early", gentle: "gentle" } as const;

export function DriverFlow({ initialError }: { initialError: string | null }) {
  const [config, setConfig] = useState<DriverConfig | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [text, setText] = useState("");
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [quote, setQuote] = useState<QuoteSet | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [deal, setDeal] = useState<DealState>({ status: "idle" });
  const dealRun = useRef(0);
  const [consent, setConsent] = useState(false);
  const [step, setStep] = useState<WizardStep>(1);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(initialError ? (ERROR_COPY[initialError] ?? ERROR_COPY.INTERNAL!) : null);
  const secondsLeft = useCountdown(quote?.expiresAtMs ?? null);
  const headingRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<DriverConfig>("/api/config")
      .then((c) => {
        setConfig(c);
        const draft = readDraft();
        const validPort = draft && c.station.ports.some((p) => p.id === draft.form.portId);
        if (draft && validPort) {
          setForm(draft.form);
          setText(draft.text);
          // Reload or back/forward resumes the step; a fresh visit or a checkout error starts at the request, values kept.
          if (!initialError && resumesNavigation() && draft.quote && draft.step > 1) {
            setQuote(draft.quote);
            setSelected(draft.selected);
            setStep(draft.step === 3 && !draft.selected ? 2 : draft.step);
          }
        } else {
          setForm({ portId: c.station.ports[0]?.id ?? "", nightOf: c.defaultNightOf, plugInLocal: c.defaultPlugInLocal, departLocal: c.defaultDepartLocal, targetBatteryKWh: "30", spendCap: "20.00", minSavings: "", minSavingsRequired: false, preference: "lowest_cost" });
        }
      })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : "Could not load station configuration."));
  }, [initialError]);

  useEffect(() => {
    if (form && busy !== "accept") writeDraft({ form, text, quote, selected, step });
  }, [form, text, quote, selected, step, busy]);

  // Browser back/forward moves between wizard steps; a step without its data falls back to the request.
  useEffect(() => {
    if (!config) return;
    if (!history.state?.gwStep) history.replaceState({ ...history.state, gwStep: step }, "");
    const onPop = (e: PopStateEvent) => {
      const s = (e.state?.gwStep ?? 1) as WizardStep;
      setStep(s > 1 && !quote ? 1 : s);
      setConsent(false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [config, quote, step]);

  const goStep = useCallback((s: WizardStep) => {
    history.pushState({ ...history.state, gwStep: s }, "");
    setStep(s);
    setConsent(false);
    window.scrollTo({ top: 0 });
    requestAnimationFrame(() => headingRef.current?.querySelector("h1")?.focus());
  }, []);

  const offer = useMemo(() => quote?.offers.find((o) => o.offerId === selected) ?? null, [quote, selected]);
  const recommendedKind = PREFERENCES.find((p) => p.value === form?.preference)?.kind ?? "flex_lowest_cost";

  if (!config || !form) {
    return error ? <Alert tone="danger" title="Station unavailable">{error}</Alert> : <p aria-live="polite" className="text-muted">Loading station…</p>;
  }
  const tz = config.station.timeZone;
  const expired = secondsLeft === 0;

  const update = (patch: Partial<FormState>) => {
    setForm({ ...form, ...patch });
    setErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !(k in patch))));
  };

  async function parseText() {
    setBusy("parse");
    setError(null);
    try {
      const res = await api<ParseResult>("/api/quotes/parse", { method: "POST", json: { text } });
      const p = res.parsed;
      const port = p.portLabel ? config!.station.ports.find((x) => x.label === p.portLabel) : undefined;
      update({
        ...(p.targetBatteryKWh !== undefined ? { targetBatteryKWh: String(p.targetBatteryKWh) } : {}),
        ...(p.plugInLocal ? { plugInLocal: `${pad2(p.plugInLocal.hour)}:${pad2(p.plugInLocal.minute)}` } : {}),
        ...(p.departLocal ? { departLocal: `${pad2(p.departLocal.hour)}:${pad2(p.departLocal.minute)}` } : {}),
        ...(p.spendCapCents !== undefined ? { spendCap: formatUsd(p.spendCapCents).slice(1) } : {}),
        // A parsed amount is never a confirmed requirement: the driver must tick "require" themselves.
        ...(p.minSavingsCents !== undefined ? { minSavings: formatUsd(p.minSavingsCents).slice(1), minSavingsRequired: false } : {}),
        ...(p.nightOf ? { nightOf: p.nightOf } : {}),
        ...(port ? { portId: port.id } : {}),
        ...(p.preference ? { preference: p.preference } : {}),
      });
      setParseResult(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not read that request.");
    } finally {
      setBusy(null);
    }
  }

  /**
   * Read-only: the agent ranks the stored offers and only pre-selects one; the driver still reviews and approves.
   * When nothing meets the goals nothing stays selected, and a reply for an older quote is ignored.
   */
  async function runDealAgent(q: QuoteSet, f: FormState) {
    const run = ++dealRun.current;
    setDeal({ status: "loading" });
    try {
      const data = await api<DealResult>("/api/agent/deals", { method: "POST", json: { quoteSetId: q.quoteSetId, minSavingsCents: q.requiredMinSavingsCents ?? minSavingsCents(f), preference: f.preference } });
      if (run !== dealRun.current) return;
      setDeal({ status: "done", data });
      setSelected(data.evaluation.recommendedOfferId);
      setConsent(false);
    } catch (err) {
      if (run !== dealRun.current) return;
      setDeal({ status: "error", message: err instanceof ApiError ? err.message : "The Flex Deal Agent could not check these offers." });
      if (minSavingsCents(f) !== null) setSelected(null);
    }
  }

  async function requestQuote(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    const found = validateForm(form!);
    setErrors(found);
    const firstInvalid = FIELD_ORDER.find((k) => found[k]);
    if (firstInvalid) {
      if (step !== 1) goStep(1);
      // Accessible error feedback: move focus to the first invalid field (its error is in aria-describedby).
      requestAnimationFrame(() => document.getElementById(fieldId(firstInvalid, form!))?.focus());
      return;
    }
    setBusy("quote");
    setConsent(false);
    try {
      const { quote: q } = await api<{ quote: QuoteSet }>("/api/quotes", {
        method: "POST",
        json: {
          portId: form!.portId,
          nightOf: form!.nightOf,
          plugInLocal: form!.plugInLocal,
          departLocal: form!.departLocal,
          targetBatteryKWh: Number(form!.targetBatteryKWh),
          spendCapCents: usdToCents(form!.spendCap.replace(/^\$/, "").trim()),
          ...(form!.minSavingsRequired && minSavingsCents(form!) !== null ? { requiredMinSavingsCents: minSavingsCents(form!) } : {}),
        },
      });
      setQuote(q);
      // With a minimum saving set, nothing is preselected until the server has checked it.
      setSelected(minSavingsCents(form!) === null ? ((q.offers.find((o) => o.kind === recommendedKind) ?? q.offers[0])?.offerId ?? null) : null);
      if (step !== 2) goStep(2);
      void runDealAgent(q, form!);
    } catch (err) {
      const fieldErr: FieldErrors | null =
        err instanceof ApiError && err.code === "INVALID_WINDOW" ? { departLocal: err.message } : err instanceof ApiError && err.code === "PLUG_IN_PASSED" ? { plugInLocal: err.message } : err instanceof ApiError && err.code === "DEPARTURE_PASSED" ? { nightOf: err.message } : null;
      if (fieldErr) {
        setErrors(fieldErr);
        if (step !== 1) goStep(1);
      } else setError(err instanceof ApiError ? err.message : "Could not get offers.");
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    if (!quote || !offer || !consent) return;
    setBusy("accept");
    setError(null);
    try {
      const res = await api<{ approveUrl: string }>("/api/offers/accept", {
        method: "POST",
        json: { quoteSetId: quote.quoteSetId, offerId: offer.offerId, termsHash: offer.termsHash, consent: true },
      });
      writeDraft(null);
      window.location.assign(res.approveUrl);
    } catch (err) {
      setError(err instanceof ApiError ? (ERROR_COPY[err.code] ?? err.message) : "Could not start checkout.");
      setBusy(null);
    }
  }

  // Advisory only: a saving the driver did not confirm as required is shown, never enforced.
  const preferredMin = quote && (quote.requiredMinSavingsCents ?? null) === null && form ? minSavingsCents(form) : null;
  const reachable = (s: WizardStep) => s === 1 || (s === 2 && !!quote) || (s === 3 && !!offer);

  return (
    <div className="space-y-8">
      <StepProgress step={step} reachable={reachable} onGo={goStep} />
      {error && <Alert tone="danger">{error}</Alert>}
      <div className={`flex flex-wrap items-start gap-x-10 gap-y-8 ${step === 2 && offer ? "pb-40 min-[760px]:pb-0" : ""}`}>
        <div ref={headingRef} className="min-w-0 flex-[999_1_560px] [&_h1]:outline-none">
          {step === 1 && (
            <RequestStep
              config={config}
              form={form}
              errors={errors}
              text={text}
              parseResult={parseResult}
              busy={busy === "quote" || busy === "parse" ? busy : null}
              onText={setText}
              onParse={parseText}
              onUpdate={update}
              onSubmit={requestQuote}
            />
          )}
          {step === 2 && quote && (
            <OffersStep
              quote={quote}
              tz={tz}
              selected={selected}
              offer={offer}
              recommendedKind={recommendedKind}
              deal={deal}
              preferredMinSavingsCents={preferredMin}
              onRunDeal={() => void runDealAgent(quote, form)}
              secondsLeft={secondsLeft}
              refreshing={busy === "quote"}
              onSelect={(id) => {
                setSelected(id);
                setConsent(false);
              }}
              onRefresh={() => void requestQuote()}
              onEdit={() => goStep(1)}
              impactHref={`/impact-lab?${new URLSearchParams({ portId: form.portId, kWh: form.targetBatteryKWh, plugInLocal: form.plugInLocal, readyByLocal: form.departLocal, nightOf: form.nightOf, preference: IMPACT_PREFERENCE[form.preference] }).toString()}`}
            />
          )}
          {step === 3 && quote && offer && (
            <TermsApproval config={config} quote={quote} offer={offer} preferredMinSavingsCents={preferredMin} secondsLeft={secondsLeft} consent={consent} busy={busy === "accept"} onConsent={setConsent} onApprove={approve} onBack={() => goStep(2)} />
          )}
        </div>
        <aside className={`min-w-0 flex-[1_1_280px] space-y-4 min-[760px]:sticky min-[760px]:top-24 ${step === 2 ? "hidden min-[760px]:block" : ""}`} aria-label="Request summary">
          <RequestCard config={config} form={form} onEdit={step > 1 ? () => goStep(1) : undefined} />
          {step === 2 && offer && <SelectedCard offer={offer} tz={tz} expired={expired} onReview={() => goStep(3)} />}
        </aside>
      </div>
      {step === 2 && offer && <MobileOfferBar offer={offer} expired={expired} onReview={() => goStep(3)} />}
    </div>
  );
}
