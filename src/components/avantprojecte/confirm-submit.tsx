"use client";

// Confirmació final de la ronda. La clau d'idempotència es genera una sola vegada
// per pantalla: un doble clic o un reintent envien la mateixa clau i el servidor
// retorna la mateixa ronda (mai se'n consumeixen dues).
import { useState, useTransition } from "react";
import { ResultMessage, type ActionMessages } from "@/components/action-form";
import type { ActionResult } from "@/lib/action-result";
import { submitRoundAction } from "@/app/(app)/portal/[id]/actions";

export function ConfirmSubmit({ projectId, draftId, texts, messages, disabled }: {
  projectId: string; draftId: string; texts: { check: string; send: string; sending: string }; messages: ActionMessages; disabled?: boolean;
}) {
  const [key] = useState(() => crypto.randomUUID());
  const [checked, setChecked] = useState(false);
  const [result, setResult] = useState<ActionResult<unknown> | undefined>();
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3 rounded-xl border-2 border-gold bg-gold-light/30 p-4">
      <label className="flex items-start gap-3 text-sm font-medium text-navy">
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-0.5 h-5 w-5 accent-navy" data-testid="confirm-check" />
        {texts.check}
      </label>
      <button type="button" data-testid="confirm-send" disabled={!checked || pending || disabled}
        onClick={() => start(async () => { const r = await submitRoundAction(projectId, draftId, key); if (r && !r.ok) setResult(r); })}
        className="w-full rounded-md bg-navy px-5 py-3 text-base font-semibold text-white disabled:opacity-50 sm:w-auto">
        {pending ? texts.sending : texts.send}
      </button>
      <ResultMessage state={result} messages={messages} />
    </div>
  );
}
