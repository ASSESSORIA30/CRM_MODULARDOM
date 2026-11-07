"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import type { ActionResult } from "@/lib/action-result";

export type ActionMessages = {
  saved: string;
  errors: Record<string, string>;
  /** Etiquetes dels 11 passos (índex 0 = pas 1), per explicar validacions del pipeline */
  stepLabels?: string[];
};

type Action = (prev: ActionResult<unknown> | undefined, formData: FormData) => Promise<ActionResult<unknown>>;

export function ResultMessage({ state, messages }: { state: ActionResult<unknown> | undefined; messages: ActionMessages }) {
  if (!state) return null;
  if (state.ok) {
    return state.message === "silent" ? null : (
      <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.message ?? messages.saved}</p>
    );
  }
  const text = messages.errors[state.error] ?? state.error;
  return (
    <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
      <p>{text}</p>
      {state.missingSteps && messages.stepLabels && (
        <ul className="mt-1 list-disc pl-5">
          {state.missingSteps.map((s) => <li key={s}>{s}. {messages.stepLabels![s - 1]}</li>)}
        </ul>
      )}
      {state.fieldErrors && (
        <ul className="mt-1 list-disc pl-5">
          {Object.entries(state.fieldErrors).map(([k, v]) => <li key={k}>{messages.errors[v] ?? v}</li>)}
        </ul>
      )}
    </div>
  );
}

export function ActionForm({
  action, children, messages, submitLabel, resetOnSuccess = false, className = "space-y-4", submitClassName,
}: {
  action: Action;
  children: ReactNode;
  messages: ActionMessages;
  submitLabel: string;
  resetOnSuccess?: boolean;
  className?: string;
  submitClassName?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      <ResultMessage state={state} messages={messages} />
      <button
        type="submit"
        disabled={pending}
        className={submitClassName ?? "inline-flex items-center justify-center rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-dark disabled:opacity-60"}
      >
        {pending ? "…" : submitLabel}
      </button>
    </form>
  );
}
