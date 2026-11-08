// Vista HTML (pantalla i impressió) de l'informe d'una ronda. Mateixes dades que el PDF.
import { MarkerThumb } from "@/components/avantprojecte/marker-thumb";
import type { ReportTexts } from "@/lib/report/report-pdf";
import { summarizeRound, type RoundReport } from "@/lib/report/round-report";

function Row({ label, refs, none }: { label: string; refs: string[]; none: string }) {
  return (
    <div className="flex flex-wrap gap-x-3 border-b border-navy/5 py-1.5 text-sm last:border-0">
      <span className="w-56 shrink-0 font-medium text-navy">{label} ({refs.length})</span>
      <span className="font-mono text-ink">{refs.length ? refs.join(", ") : <span className="font-sans text-muted">{none}</span>}</span>
    </div>
  );
}

export function RoundReportView({ report: r, T, note }: { report: RoundReport; T: ReportTexts; note: string }) {
  const s = summarizeRound(r.items);
  return (
    <article className="space-y-6" data-testid="round-report">
      <header className="rounded-xl bg-navy p-5 text-white">
        <p className="text-xs font-semibold tracking-[0.2em] text-gold">{T.title.toUpperCase()}</p>
        <h1 className="mt-1 text-xl font-semibold">{r.project.title}</h1>
        <p className="mt-1 text-sm text-white/80">
          <span className="font-mono">{r.project.code}</span> · {T.round} {r.round.number}
          {r.round.isException && <> · ★ {T.exception}</>} · {T.status}: {r.round.status === "oberta" ? T.open : T.closed}
        </p>
        <p className="mt-1 text-xs text-white/70">
          {T.submitted}: {r.round.submittedAt} · {r.round.submittedBy}
          {r.round.closedAt && <> · {T.closed}: {r.round.closedAt}</>} · {T.generated}: {r.generatedAt}
        </p>
      </header>

      <section className="print-avoid rounded-xl border border-navy/10 bg-white p-5">
        <h2 className="mb-2 text-lg font-semibold text-navy">{T.summary}</h2>
        <Row label={T.requested} refs={s.requested} none={T.none} />
        <Row label={T.incorporated} refs={s.incorporated} none={T.none} />
        <Row label={T.partial} refs={s.partial} none={T.none} />
        <Row label={T.notViable} refs={s.notViable} none={T.none} />
        <Row label={T.alternativesAccepted} refs={s.alternativesAccepted} none={T.none} />
        <Row label={T.pending} refs={s.pending} none={T.none} />
        <Row label={T.discarded} refs={s.discarded} none={T.none} />
        <p className="mt-3 text-xs text-muted">{note}</p>
      </section>

      {r.round.originalText && (
        <section className="print-avoid rounded-xl border border-navy/10 bg-white p-5">
          <h2 className="mb-2 text-sm font-semibold text-navy">{T.originalText}</h2>
          <p className="whitespace-pre-wrap text-sm text-ink">{r.round.originalText}</p>
        </section>
      )}

      {r.items.map((it) => (
        <section key={it.ref} id={it.ref} className="space-y-3 rounded-xl border border-navy/10 bg-white p-5">
          <h2 className="flex flex-wrap items-baseline gap-2 text-base font-semibold text-navy">
            <span className="rounded bg-navy px-2 py-0.5 font-mono text-xs text-white">{it.ref}</span>
            {it.title}
            <span className="text-xs font-normal text-muted">· {T.itemStatus[it.status] ?? it.status}{it.room ? ` · ${T.room}: ${it.room}` : ""}</span>
          </h2>
          {it.sourceExcerpt && <p className="text-sm"><b className="text-navy">{T.originalRequest}:</b> «{it.sourceExcerpt}»</p>}
          {it.description && <p className="text-sm"><b className="text-navy">{T.confirmedInterpretation}:</b> {it.description}</p>}

          {it.markers.length > 0 && (
            <div className="flex flex-wrap gap-4">
              {it.markers.map((m) => (
                <figure key={m.label} className="print-avoid space-y-1">
                  {m.url && <MarkerThumb url={m.url} kind={m.documentKind} page={m.page} x={m.x} y={m.y} w={m.w} h={m.h} label={m.label} width={260} />}
                  <figcaption className="max-w-[260px] text-xs text-muted">
                    {m.label}. {m.documentTitle} · {T.version} {m.documentVersion} · p. {m.page}{m.comment ? ` — ${m.comment}` : ""}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}

          {it.photos.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold text-navy">{T.photos}</p>
              <div className="flex flex-wrap gap-3">
                {it.photos.map((p, k) => (
                  <figure key={k} className="print-avoid w-32 text-xs text-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {p.isImage && p.url ? <img src={p.url} alt={p.title} className="mb-1 h-24 w-32 rounded object-cover" /> : <span className="mb-1 flex h-24 w-32 items-center justify-center rounded bg-surface text-2xl">📄</span>}
                    <figcaption>{p.title}{p.description ? ` — ${p.description}` : ""}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          )}

          {(it.assessment || it.alternative) && (
            <div className="rounded-lg border-l-4 border-navy bg-navy/5 p-3 text-sm">
              {it.assessment && <p><b className="text-navy">{T.architect}:</b> {it.assessment}</p>}
              {it.alternative && <p className="mt-1"><b className="text-navy">{T.alternative}:</b> {it.alternative} <span className="text-muted">({T.altStatus[it.alternativeStatus] ?? it.alternativeStatus})</span></p>}
            </div>
          )}
          {it.economic && <p className="text-sm"><b className="text-navy">{T.economic}:</b> {T.economicOptions[it.economic] ?? it.economic}</p>}
          {it.confirmations.length > 0 && (
            <div className="text-sm"><b className="text-navy">{T.clientConfirmations}:</b>
              <ul className="ml-5 list-disc">{it.confirmations.map((c, k) => <li key={k}>{T.confirmationKinds[c.kind] ?? c.kind} — {c.who}, {c.when}</li>)}</ul>
            </div>
          )}
          {it.comments.length > 0 && (
            <div className="text-sm"><b className="text-navy">{T.comments}:</b>
              <ul className="ml-5 list-disc">{it.comments.map((c, k) => <li key={k}><span className="text-muted">{c.author}, {c.when}:</span> {c.body}</li>)}</ul>
            </div>
          )}
          <p className="text-sm">
            <b className="text-navy">{T.finalResolution}:</b>{" "}
            {it.resolution
              ? <>{T.resolutions[it.resolution.resolution] ?? it.resolution.resolution} — {it.resolution.documentTitle} ({T.version} {it.resolution.version}){it.resolution.note ? `. ${it.resolution.note}` : ""}</>
              : <span className="text-muted">{T.none}</span>}
          </p>
        </section>
      ))}

      <section className="print-avoid rounded-xl border border-navy/10 bg-white p-5">
        <h2 className="mb-2 text-sm font-semibold text-navy">{T.references}</h2>
        {r.versions.length === 0 ? <p className="text-sm text-muted">{T.none}</p> : (
          <ul className="ml-5 list-disc text-sm">
            {r.versions.map((v, k) => (
              <li key={k}>{v.title} · {T.version} {v.version}{v.publishedAt ? ` · ${T.published} ${v.publishedAt}` : ""}{v.approvedAt ? ` · ${T.approved} ${v.approvedAt}` : ""}</li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
