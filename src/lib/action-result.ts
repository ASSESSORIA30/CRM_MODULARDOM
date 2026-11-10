// Resultats estàndard de les Server Actions i traducció d'errors de PostgreSQL.
import type { PostgrestError } from "@supabase/supabase-js";

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | {
      ok: false;
      error: string;
      code?: string;
      missingSteps?: number[];
      fieldErrors?: Record<string, string>;
      duplicates?: { id: string; display_name: string; email: string | null; phone: string | null; reason: string }[];
    };

export function fromPgError(error: PostgrestError | null | undefined): ActionResult<never> {
  if (!error) return { ok: false, error: "genericError" };
  if (error.hint === "missing_steps") {
    const steps = (error.details ?? "").split(",").map(Number).filter(Boolean);
    return { ok: false, error: "missingSteps", code: "missing_steps", missingSteps: steps };
  }
  if (error.hint === "step_required") return { ok: false, error: "stepRequired" };
  if (error.hint === "invalid_transition") return { ok: false, error: "invalidTransition" };
  if (error.hint === "lost_reason") return { ok: false, error: "lostReasonRequired" };
  if (error.hint === "rounds_exhausted") return { ok: false, error: "roundsExhausted" };
  if (error.hint === "already_submitted") return { ok: false, error: "alreadySubmitted" };
  if (error.hint === "empty_round") return { ok: false, error: "emptyRound" };
  if (error.hint === "reason_required") return { ok: false, error: "reasonRequired" };
  if (error.hint === "invalid_state") return { ok: false, error: "invalidState" };
  const HINTS: Record<string, string> = {
    quote_locked: "quoteLocked", draft_exists: "draftExists", quote_accepted: "quoteAccepted", empty_quote: "emptyQuote",
    invalid_dates: "invalidDates", contract_locked: "contractLocked", total_required: "totalRequired", no_milestones: "noMilestones",
    unconfirmed_milestones: "unconfirmedMilestones", open_discrepancies: "openDiscrepancies", sum_mismatch: "sumMismatch",
    split_sum: "splitSum", invalid_document: "invalidDocument",
  };
  if (error.hint && HINTS[error.hint]) return { ok: false, error: HINTS[error.hint] };
  if (error.code === "42501") return { ok: false, error: "forbidden" };
  if (error.code === "23505") return { ok: false, error: "genericError", code: "duplicate" };
  if (error.code === "P0001" && error.message) return { ok: false, error: error.message, code: "raw" };
  console.error("[db]", error.code, error.message);
  return { ok: false, error: "genericError" };
}
