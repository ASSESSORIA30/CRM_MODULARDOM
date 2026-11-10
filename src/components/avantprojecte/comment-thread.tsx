"use client";

import { useActionState, useEffect, useRef } from "react";
import { ResultMessage, type ActionMessages } from "@/components/action-form";
import type { ActionResult } from "@/lib/action-result";
import { addCommentAction, resolveCommentAction } from "@/app/(app)/projectes/[id]/avantprojecte/actions";

export type ThreadComment = {
  id: string; parentId: string | null; body: string; author: string; role: string; visibility: "compartit" | "intern";
  when: string; resolved: boolean;
};
export type ThreadTexts = {
  write: string; send: string; reply: string; internal: string; shared: string; resolve: string; reopen: string;
  resolved: string; mention: string; empty: string;
};

function CommentForm({ projectId, target, parentId, canInternal, participants, texts, messages, forceInternal }: {
  projectId: string; target: { document_id?: string; item_id?: string; annotation_id?: string }; parentId?: string;
  canInternal: boolean; participants: { id: string; name: string; isClient: boolean }[]; texts: ThreadTexts; messages: ActionMessages;
  forceInternal?: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult<unknown> | undefined, FormData>(addCommentAction, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="space-y-2">
      <input type="hidden" name="project_id" value={projectId} />
      {target.document_id && <input type="hidden" name="document_id" value={target.document_id} />}
      {target.item_id && <input type="hidden" name="item_id" value={target.item_id} />}
      {target.annotation_id && <input type="hidden" name="annotation_id" value={target.annotation_id} />}
      {parentId && <input type="hidden" name="parent_id" value={parentId} />}
      <textarea name="body" required rows={2} placeholder={parentId ? texts.reply : texts.write}
        className="block w-full rounded-md border border-navy/20 px-3 py-2 text-sm outline-none focus:border-gold" />
      <div className="flex flex-wrap items-center gap-2">
        {canInternal && !forceInternal && (
          <select name="visibility" defaultValue="compartit" className="rounded-md border border-navy/20 bg-white px-2 py-1.5 text-xs">
            <option value="compartit">👁 {texts.shared}</option>
            <option value="intern">🔒 {texts.internal}</option>
          </select>
        )}
        {forceInternal && <input type="hidden" name="visibility" value="intern" />}
        {participants.length > 0 && (
          <select name="mentions" multiple className="h-8 max-w-48 rounded-md border border-navy/20 bg-white px-1 text-xs" aria-label={texts.mention} title={texts.mention}>
            {participants.map((p) => <option key={p.id} value={p.id}>@{p.name}</option>)}
          </select>
        )}
        <button disabled={pending} className="ml-auto rounded-md bg-navy px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{texts.send}</button>
      </div>
      <ResultMessage state={state} messages={messages} />
    </form>
  );
}

export function CommentThread({ projectId, target, comments, canInternal, canResolve, participants, texts, messages }: {
  projectId: string; target: { document_id?: string; item_id?: string; annotation_id?: string }; comments: ThreadComment[];
  canInternal: boolean; canResolve: boolean; participants: { id: string; name: string; isClient: boolean }[];
  texts: ThreadTexts; messages: ActionMessages;
}) {
  const roots = comments.filter((c) => !c.parentId);
  const replies = (id: string) => comments.filter((c) => c.parentId === id);
  const Bubble = ({ c }: { c: ThreadComment }) => (
    <div className={`rounded-lg p-2.5 text-sm ${c.visibility === "intern" ? "border border-dashed border-slate-400 bg-slate-50" : c.role === "client" ? "bg-gold-light/40" : "bg-surface"}`}>
      <p className="mb-0.5 flex flex-wrap items-center gap-1 text-xs text-muted">
        <strong className="text-navy">{c.author}</strong>
        {c.visibility === "intern" && <span className="rounded bg-slate-200 px-1 text-[10px] font-semibold uppercase text-slate-700">🔒 {texts.internal}</span>}
        <span>· {c.when}</span>
        {c.resolved && <span className="text-emerald-700">· ✓ {texts.resolved}</span>}
      </p>
      <p className="whitespace-pre-line text-ink">{c.body}</p>
    </div>
  );
  return (
    <div className="space-y-3">
      {roots.length === 0 && <p className="text-xs text-muted">{texts.empty}</p>}
      {roots.map((c) => (
        <div key={c.id} className="space-y-1.5">
          <Bubble c={c} />
          <div className="ml-5 space-y-1.5 border-l-2 border-navy/10 pl-3">
            {replies(c.id).map((r) => <Bubble key={r.id} c={r} />)}
            <details>
              <summary className="cursor-pointer text-xs text-navy underline">{texts.reply}</summary>
              <div className="mt-2">
                <CommentForm projectId={projectId} target={target} parentId={c.id} canInternal={canInternal && c.visibility === "compartit"}
                  forceInternal={c.visibility === "intern"} participants={participants.filter((p) => c.visibility === "compartit" || !p.isClient)}
                  texts={texts} messages={messages} />
              </div>
            </details>
            {canResolve && (
              <form action={resolveCommentAction}>
                <input type="hidden" name="id" value={c.id} /><input type="hidden" name="project_id" value={projectId} />
                {c.resolved && <input type="hidden" name="reopen" value="1" />}
                <button className="text-xs text-muted underline">{c.resolved ? texts.reopen : texts.resolve}</button>
              </form>
            )}
          </div>
        </div>
      ))}
      <CommentForm projectId={projectId} target={target} canInternal={canInternal} participants={participants} texts={texts} messages={messages} />
    </div>
  );
}
