"use client";

import { useActionState, useState } from "react";
import { ResultMessage, type ActionMessages } from "@/components/action-form";
import type { ActionResult } from "@/lib/action-result";
import { moveStageAction } from "../actions";

export function StageForm({ projectId, current, stages, texts, messages }: {
  projectId: string;
  current: string;
  stages: { value: string; label: string }[];
  texts: { move: string; lostReason: string; changeStage: string };
  messages: ActionMessages;
}) {
  const [state, action, pending] = useActionState<ActionResult<unknown> | undefined, FormData>(moveStageAction, undefined);
  const [to, setTo] = useState(current);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="project_id" value={projectId} />
      <label className="block">
        <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-navy/80">{texts.changeStage}</span>
        <select name="to" value={to} onChange={(e) => setTo(e.target.value)}
          className="block w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm outline-none focus:border-gold">
          {stages.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </label>
      {to === "perdut" && (
        <textarea name="reason" required rows={2} placeholder={texts.lostReason}
          className="block w-full rounded-md border border-navy/20 px-3 py-2 text-sm outline-none focus:border-gold" />
      )}
      <ResultMessage state={state} messages={messages} />
      <button disabled={pending || to === current} className="w-full rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {pending ? "…" : texts.move}
      </button>
    </form>
  );
}
