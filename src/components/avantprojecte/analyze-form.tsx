"use client";

import { useActionState } from "react";
import { ResultMessage, type ActionMessages } from "@/components/action-form";
import type { ActionResult } from "@/lib/action-result";
import { analyzeDraftAction } from "@/app/(app)/portal/[id]/actions";

export function AnalyzeForm({ projectId, draftId, defaultText, hasItems, texts, messages }: {
  projectId: string; draftId: string; defaultText: string; hasItems: boolean;
  texts: { placeholder: string; analyze: string; warning: string; working: string }; messages: ActionMessages;
}) {
  const [state, action, pending] = useActionState<ActionResult<unknown> | undefined, FormData>(analyzeDraftAction, undefined);
  return (
    <form action={action} className="space-y-3"
      onSubmit={(e) => { if (hasItems && !window.confirm(texts.warning)) e.preventDefault(); }}>
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="draft_id" value={draftId} />
      <textarea name="text" rows={5} defaultValue={defaultText} placeholder={texts.placeholder}
        className="block w-full rounded-lg border border-navy/20 px-3 py-2.5 text-base outline-none focus:border-gold sm:text-sm" />
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className="rounded-md bg-gold px-5 py-2.5 text-sm font-bold tracking-wide text-navy-dark shadow-sm hover:brightness-95 disabled:opacity-60">
          ✨ {pending ? texts.working : texts.analyze}
        </button>
        {hasItems && <span className="text-xs text-muted">{texts.warning}</span>}
      </div>
      <ResultMessage state={state} messages={messages} />
    </form>
  );
}
