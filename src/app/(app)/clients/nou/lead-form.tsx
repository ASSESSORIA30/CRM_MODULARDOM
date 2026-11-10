"use client";

import { useActionState, useRef } from "react";
import { ResultMessage, type ActionMessages } from "@/components/action-form";
import type { ActionResult } from "@/lib/action-result";
import { createLeadAction } from "../actions";

type Option = { value: string; label: string };
export type LeadFormTexts = Record<
  "clientName" | "email" | "phone" | "language" | "leadSource" | "municipality" | "surface" | "estimatedBudget"
  | "responsible" | "priority" | "nextAction" | "followUpDate" | "notes" | "create" | "possibleDuplicates"
  | "duplicatesHelp" | "useThisClient" | "createAnyway" | "optional",
  string
> & { dupReason: Record<string, string> };

const input = "block w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/30";

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-navy/80">{label}</span>
      {children}
    </label>
  );
}

export function LeadForm({ d, messages, sources, priorities, people, me }: {
  d: LeadFormTexts; messages: ActionMessages; sources: Option[]; priorities: Option[]; people: Option[]; me: string;
}) {
  const [state, action, pending] = useActionState<ActionResult<unknown> | undefined, FormData>(createLeadAction, undefined);
  const clientIdRef = useRef<HTMLInputElement>(null);
  const forceRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const dups = state && !state.ok ? state.duplicates : undefined;

  const resubmit = (clientId: string | null) => {
    if (clientIdRef.current) clientIdRef.current.value = clientId ?? "";
    if (forceRef.current) forceRef.current.value = clientId ? "" : "1";
    formRef.current?.requestSubmit();
  };

  return (
    <form ref={formRef} action={action} className="space-y-6">
      <input ref={clientIdRef} type="hidden" name="client_id" defaultValue="" />
      <input ref={forceRef} type="hidden" name="force" defaultValue="" />

      <fieldset className="grid gap-4 rounded-xl border border-navy/10 bg-white p-5 shadow-sm sm:grid-cols-2">
        <F label={d.clientName}><input name="display_name" required className={input} autoFocus /></F>
        <F label={d.email}><input name="email" type="email" className={input} /></F>
        <F label={d.phone}><input name="phone" type="tel" className={input} /></F>
        <F label={d.language}>
          <select name="locale" className={input} defaultValue="ca"><option value="ca">Català</option><option value="es">Castellano</option></select>
        </F>
        <F label={d.leadSource}>
          <select name="lead_source" className={input} defaultValue=""><option value="">—</option>{sources.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        </F>
      </fieldset>

      <fieldset className="grid gap-4 rounded-xl border border-navy/10 bg-white p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-3">
        <F label={d.municipality}><input name="municipality" className={input} /></F>
        <F label={d.surface}><input name="surface_m2" inputMode="decimal" className={input} placeholder="180" /></F>
        <F label={d.estimatedBudget}><input name="estimated" inputMode="decimal" className={input} placeholder="350.000" /></F>
        <F label={d.responsible}>
          <select name="responsible_id" className={input} defaultValue={me}>{people.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        </F>
        <F label={d.priority}>
          <select name="priority" className={input} defaultValue="normal">{priorities.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        </F>
        <F label={d.followUpDate}><input name="follow_up_date" type="date" className={input} /></F>
        <F label={d.nextAction}><input name="next_action" className={input} /></F>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-navy/80">{d.notes}</span>
          <textarea name="notes" rows={3} className={input} />
        </label>
      </fieldset>

      {dups && dups.length > 0 ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-5">
          <h2 className="font-semibold text-amber-900">{d.possibleDuplicates}</h2>
          <p className="mb-3 text-sm text-amber-900">{d.duplicatesHelp}</p>
          <ul className="space-y-2">
            {dups.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white p-3 text-sm">
                <span>
                  <strong className="text-navy">{c.display_name}</strong>{" "}
                  <span className="text-muted">{[c.email, c.phone].filter(Boolean).join(" · ")}</span>{" "}
                  <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-900">{d.dupReason[c.reason] ?? c.reason}</span>
                </span>
                <button type="button" disabled={pending} onClick={() => resubmit(c.id)}
                  className="rounded-md bg-navy px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">{d.useThisClient}</button>
              </li>
            ))}
          </ul>
          <button type="button" disabled={pending} onClick={() => resubmit(null)}
            className="mt-3 rounded-md border border-amber-400 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 disabled:opacity-60">{d.createAnyway}</button>
        </div>
      ) : (
        <ResultMessage state={state} messages={messages} />
      )}

      <button type="submit" disabled={pending}
        className="rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-white hover:bg-navy-dark disabled:opacity-60">
        {pending ? "…" : d.create}
      </button>
    </form>
  );
}
