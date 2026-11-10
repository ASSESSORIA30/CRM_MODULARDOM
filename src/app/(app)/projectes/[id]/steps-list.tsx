"use client";

import { useActionState } from "react";
import { ResultMessage, type ActionMessages } from "@/components/action-form";
import type { ActionResult } from "@/lib/action-result";
import { setStepAction } from "../actions";

type Step = { step: number; status: string; done_at: string | null; label: string; doneAtText: string; editable: boolean };

function StepRow({ projectId, s, texts, messages }: {
  projectId: string; s: Step; texts: { done: string; pending: string; na: string }; messages: ActionMessages;
}) {
  const [state, action, pending] = useActionState<ActionResult<unknown> | undefined, FormData>(setStepAction, undefined);
  const done = s.status === "fet";
  return (
    <li className="py-2.5">
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${done ? "bg-gold text-navy-dark" : s.status === "no_aplica" ? "bg-slate-200 text-slate-500" : "border border-navy/25 text-navy"}`}>
          {done ? "✓" : s.step}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`text-sm ${s.status === "no_aplica" ? "text-muted line-through" : "text-ink"}`}>{s.label}</p>
          {done && <p className="text-xs text-muted">{s.doneAtText}</p>}
        </div>
        {s.editable && (
          <form action={action} className="flex shrink-0 gap-1">
            <input type="hidden" name="project_id" value={projectId} />
            <input type="hidden" name="step" value={s.step} />
            {done ? (
              <button name="status" value="pendent" disabled={pending} className="rounded border border-navy/20 px-2 py-1 text-xs text-navy hover:bg-surface disabled:opacity-50">{texts.pending}</button>
            ) : (
              <>
                <button name="status" value="fet" disabled={pending} className="rounded bg-navy px-2 py-1 text-xs font-semibold text-white disabled:opacity-50">{texts.done}</button>
                {s.step === 3 && s.status !== "no_aplica" && (
                  <button name="status" value="no_aplica" disabled={pending} className="rounded border border-navy/20 px-2 py-1 text-xs text-navy disabled:opacity-50">{texts.na}</button>
                )}
                {s.status === "no_aplica" && (
                  <button name="status" value="pendent" disabled={pending} className="rounded border border-navy/20 px-2 py-1 text-xs text-navy disabled:opacity-50">{texts.pending}</button>
                )}
              </>
            )}
          </form>
        )}
      </div>
      {state && !state.ok && <div className="ml-9 mt-2"><ResultMessage state={state} messages={messages} /></div>}
    </li>
  );
}

export function StepsList({ projectId, steps, texts, messages }: {
  projectId: string; steps: Step[]; texts: { done: string; pending: string; na: string }; messages: ActionMessages;
}) {
  return (
    <ol className="divide-y divide-navy/5">
      {steps.map((s) => <StepRow key={s.step} projectId={projectId} s={s} texts={texts} messages={messages} />)}
    </ol>
  );
}
