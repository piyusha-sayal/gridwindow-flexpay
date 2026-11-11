"use client";

import { useState } from "react";
import { api, ApiError } from "@/components/api";
import type { AiSource } from "@/components/ui";

type Answer = { answer: string; inScope: boolean } & AiSource;

/** Suggested questions; each goes through the same grounded /api/assist/ask endpoint as typed questions. */
const SUGGESTIONS = ["When will I be charged?", "Why is this cheaper than charging now?", "What happens if charging fails?", "Has my payment been collected?"] as const;

/** Read-only Q&A about this reservation. The assistant cannot change, cancel or charge anything. */
export function AskAssistant({ reservationId }: { reservationId: string }) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ask(q: string) {
    if (!q.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setAnswer(await api<Answer>("/api/assist/ask", { method: "POST", json: { reservationId, question: q } }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not get an answer.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card agent-panel p-5 sm:p-6 space-y-4 no-print" aria-labelledby="ask-title">
      <div className="ask-head">
        <span aria-hidden="true" className="icon-tile">
          <span className="ico ico-spark" />
        </span>
        <div className="space-y-1">
        <h2 id="ask-title" className="text-[20px] font-semibold tracking-[-0.01em]">
          Questions about this charge?
        </h2>
        <p className="text-[14px] text-muted">Answers use only this reservation&apos;s recorded facts. The assistant cannot change, cancel, refund or charge anything.</p>
        </div>
      </div>
      <ul className="stagger flex flex-wrap gap-2" aria-label="Suggested questions">
        {SUGGESTIONS.map((s) => (
          <li key={s}>
            <button
              type="button"
              className="suggest-chip rounded-[var(--r-pill)] border border-line-strong px-3.5 py-1.5 text-[14px] disabled:opacity-50"
              disabled={busy}
              onClick={() => {
                setQuestion(s);
                void ask(s);
              }}
            >
              {s}
            </button>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
        className="flex flex-col sm:flex-row gap-2"
      >
        <label htmlFor="ask" className="sr-only">
          Your question
        </label>
        <input id="ask" className="field" maxLength={500} placeholder="Or type your own question" value={question} onChange={(e) => setQuestion(e.target.value)} />
        <button type="submit" className="btn" disabled={busy || !question.trim()}>
          {busy ? "Answering…" : "Ask"}
        </button>
      </form>
      {error && (
        <p role="alert" className="text-[14px] text-red">
          {error}
        </p>
      )}
      {answer && (
        <div className="ai-answer space-y-2 text-[15px]" aria-live="polite">
          <p>{answer.answer}</p>
        </div>
      )}
    </section>
  );
}
