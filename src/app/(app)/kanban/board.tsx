"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { ResultMessage, type ActionMessages } from "@/components/action-form";
import type { ActionResult } from "@/lib/action-result";
import { moveStage } from "../projectes/actions";

export type KanbanCard = {
  id: string;
  code: string;
  status: string;
  clientName: string;
  location: string | null;
  surface: string | null;
  budget: string | null;
  responsible: string | null;
  responsibleId: string | null;
  lastActivity: string | null;
  nextAction: string | null;
  followUp: string | null;
  followUpLate: boolean;
  priority: string;
  priorityLabel: string;
  priorityClass: string;
};

type Column = { stage: string; label: string; side?: boolean };

export type BoardTexts = {
  noCards: string; moveTo: string; lostReason: string; cancel: string; move: string; search: string;
  responsible: string; all: string; lastActivity: string; nextAction: string; followUp: string; dragHint: string;
};

export function Board({ columns, initialCards, texts, messages, people }: {
  columns: Column[]; initialCards: KanbanCard[]; texts: BoardTexts; messages: ActionMessages; people: { id: string; name: string }[];
}) {
  const [cards, setCards] = useState(initialCards);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult<unknown> | undefined>();
  const [pendingLost, setPendingLost] = useState<{ id: string; from: string } | null>(null);
  const [reason, setReason] = useState("");
  const [q, setQ] = useState("");
  const [resp, setResp] = useState("");
  const [isPending, startTransition] = useTransition();

  const visible = useMemo(() => cards.filter((c) =>
    (!resp || c.responsibleId === resp) &&
    (!q || `${c.clientName} ${c.code} ${c.location ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [cards, q, resp]);

  function doMove(id: string, to: string, why?: string) {
    const card = cards.find((c) => c.id === id);
    if (!card || card.status === to) return;
    if (to === "perdut" && !why) {
      setPendingLost({ id, from: card.status });
      setReason("");
      return;
    }
    const from = card.status;
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, status: to } : c))); // optimista
    setResult(undefined);
    startTransition(async () => {
      const res = await moveStage(id, to, why);
      if (!res.ok) {
        setCards((cs) => cs.map((c) => (c.id === id ? { ...c, status: from } : c))); // revertir
        setResult({ ...res, error: res.error });
      }
    });
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${texts.search}…`}
          className="w-56 rounded-md border border-navy/20 bg-white px-3 py-2 text-sm outline-none focus:border-gold" />
        <select value={resp} onChange={(e) => setResp(e.target.value)} aria-label={texts.responsible}
          className="rounded-md border border-navy/20 bg-white px-3 py-2 text-sm outline-none focus:border-gold">
          <option value="">{texts.responsible}: {texts.all}</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <span className="text-xs text-muted">{texts.dragHint}</span>
        {isPending && <span className="text-xs text-muted">…</span>}
      </div>

      {result && !result.ok && (
        <div className="mb-4 max-w-2xl"><ResultMessage state={result} messages={messages} /></div>
      )}

      <div className="flex gap-3 overflow-x-auto pb-4">
        {columns.map((col) => {
          const colCards = visible.filter((c) => c.status === col.stage);
          return (
            <section
              key={col.stage}
              data-stage={col.stage}
              onDragOver={(e) => { e.preventDefault(); setOver(col.stage); }}
              onDragLeave={() => setOver((o) => (o === col.stage ? null : o))}
              onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData("text/plain") || dragId; if (id) doMove(id, col.stage); setDragId(null); }}
              className={`flex shrink-0 flex-col rounded-xl ${col.side ? "w-56 bg-slate-100" : "w-72 bg-navy/[0.04]"} ${over === col.stage ? "ring-2 ring-gold" : ""}`}
            >
              <header className={`flex items-center justify-between rounded-t-xl px-3 py-2.5 ${col.side ? "bg-slate-200 text-slate-700" : "bg-navy text-white"}`}>
                <h2 className="text-sm font-semibold">{col.label}</h2>
                <span className={`rounded-full px-2 text-xs font-bold ${col.side ? "bg-white text-slate-700" : "bg-gold text-navy-dark"}`}>{colCards.length}</span>
              </header>
              <div className="flex min-h-24 flex-1 flex-col gap-2 p-2">
                {colCards.length === 0 && <p className="p-3 text-center text-xs text-muted">{texts.noCards}</p>}
                {colCards.map((c) => (
                  <article
                    key={c.id}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData("text/plain", c.id); e.dataTransfer.effectAllowed = "move"; setDragId(c.id); }}
                    onDragEnd={() => setDragId(null)}
                    className={`cursor-grab rounded-lg border border-navy/10 bg-white p-3 shadow-sm transition hover:border-gold active:cursor-grabbing ${dragId === c.id ? "opacity-50" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/projectes/${c.id}`} className="font-semibold leading-tight text-navy hover:text-gold">{c.clientName}</Link>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${c.priorityClass}`}>{c.priorityLabel}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">{[c.location, c.surface].filter(Boolean).join(" · ") || c.code}</p>
                    {c.budget && <p className="mt-1 text-sm font-semibold tabular-nums text-navy">{c.budget}</p>}
                    <dl className="mt-2 space-y-0.5 text-xs text-muted">
                      {c.responsible && <div>👤 {c.responsible}</div>}
                      {c.nextAction && <div><span className="sr-only">{texts.nextAction}: </span>➜ {c.nextAction}</div>}
                      {c.followUp && <div className={c.followUpLate ? "font-semibold text-red-700" : ""}>📅 {texts.followUp}: {c.followUp}</div>}
                      {c.lastActivity && <div>{texts.lastActivity}: {c.lastActivity}</div>}
                    </dl>
                    {/* Alternativa accessible i per a mòbil al drag-and-drop */}
                    <select
                      aria-label={texts.moveTo}
                      value=""
                      onChange={(e) => e.target.value && doMove(c.id, e.target.value)}
                      className="mt-2 w-full rounded border border-navy/10 bg-surface px-2 py-1 text-xs text-navy"
                    >
                      <option value="">{texts.moveTo}…</option>
                      {columns.filter((o) => o.stage !== c.status).map((o) => <option key={o.stage} value={o.stage}>{o.label}</option>)}
                    </select>
                  </article>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {pendingLost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-dark/50 p-4" role="dialog" aria-modal="true">
          <form
            className="w-full max-w-md rounded-xl border-t-4 border-gold bg-white p-6 shadow-xl"
            onSubmit={(e) => { e.preventDefault(); if (!reason.trim()) return; const id = pendingLost.id; setPendingLost(null); doMove(id, "perdut", reason.trim()); }}
          >
            <label className="block">
              <span className="mb-2 block font-semibold text-navy">{texts.lostReason}</span>
              <textarea autoFocus required rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
                className="block w-full rounded-md border border-navy/20 px-3 py-2 text-sm outline-none focus:border-gold" />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setPendingLost(null)} className="rounded-md border border-navy/20 px-3 py-2 text-sm text-navy">{texts.cancel}</button>
              <button className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white">{texts.move}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
