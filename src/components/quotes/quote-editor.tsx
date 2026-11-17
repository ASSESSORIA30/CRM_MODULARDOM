"use client";

// Editor d'un pressupost: partides per tipus i capítol, estat de cada partida (inclosa / opcional /
// pendent de valoració / exclosa), IVA per partida, descompte per línia, preus de catàleg i totals
// calculats exactament igual que a la base de dades. Serveix per a esborranys i per validar importacions.
import { Fragment, useMemo, useState, useTransition } from "react";
import { saveDraftAction } from "@/app/(app)/pressupostos/actions";
import { convertImportAction } from "@/app/(app)/projectes/[id]/pressupostos/import-actions";
import { formatCents, parseEurosToCents } from "@/lib/money";
import {
  formatRate, LINE_KINDS, LINE_STATUSES, lineAmountCents, parseQuantityMilli, quoteTotals, type CalcLine, type LineKind, type LineStatus,
} from "@/lib/quotes/calc";
import type { EditorLine } from "@/lib/quotes/load";
import type { QuoteTexts } from "@/lib/i18n-pressupostos";

type ConceptType = { code: string; label: string; defaultVatBp: number | null };
export type EditorTarget = { kind: "draft"; versionId: string } | { kind: "import"; importId: string; projectId: string };

function toCalc(l: EditorLine): CalcLine | null {
  const q = parseQuantityMilli(l.quantity);
  let p: number | null = null;
  try { p = parseEurosToCents(l.unitPrice); } catch { /* invàlid */ }
  const d = l.discount.trim() === "" ? 0 : Math.round(Number(l.discount.replace(",", ".")) * 100);
  if (q == null || p == null || !Number.isFinite(d) || d < 0 || d > 10000) return null;
  return { kind: l.kind, status: l.status ?? "inclosa", quantityMilli: q, unitPriceCents: l.kind === "descompte" ? -Math.abs(p) : p, discountBp: d, vatRateBp: l.vatRateBp };
}
const priceCents = (s: string) => { try { return parseEurosToCents(s); } catch { return null; } };

const cell = "w-full rounded border border-navy/15 bg-white px-2 py-1.5 text-sm focus:border-gold focus:outline-none disabled:bg-slate-50";
const STATUS_CLS: Record<LineStatus, string> = { inclosa: "", opcional: "bg-sky-50/60", pendent_valoracio: "bg-amber-50/60", exclosa: "bg-slate-100/70 opacity-70" };

export function QuoteEditor({ target, initial, conceptTypes, vatRates, T, errors, canOverridePrices = true }: {
  target: EditorTarget;
  initial: { locale: "ca" | "es"; intro: string; notes: string; exclusions?: string; paymentTerms?: string; title?: string; lines: EditorLine[] };
  conceptTypes: ConceptType[];
  vatRates: number[];
  T: QuoteTexts;
  errors: Record<string, string>;
  canOverridePrices?: boolean;
}) {
  const [locale, setLocale] = useState(initial.locale);
  const [title, setTitle] = useState(initial.title ?? "");
  const [intro, setIntro] = useState(initial.intro);
  const [notes, setNotes] = useState(initial.notes);
  const [exclusions, setExclusions] = useState(initial.exclusions ?? "");
  const [paymentTerms, setPaymentTerms] = useState(initial.paymentTerms ?? "");
  const [lines, setLines] = useState<EditorLine[]>(initial.lines);
  const [dirty, setDirty] = useState(target.kind === "import");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [lineErrors, setLineErrors] = useState<Record<number, string[]>>({});
  const [pending, start] = useTransition();
  const isImport = target.kind === "import";

  const touch = () => { setDirty(true); setMsg(null); };
  const update = (i: number, patch: Partial<EditorLine>) => { setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l))); touch(); };
  const defaultVat = (code: string) => conceptTypes.find((c) => c.code === code)?.defaultVatBp ?? 1000;
  const add = (kind: LineKind) => {
    const last = [...lines].reverse().find((l) => l.kind === kind);
    const conceptType = kind === "base" ? "construccio" : kind === "descompte" ? (last?.conceptType ?? "construccio") : "extra_constructiu";
    setLines((ls) => [...ls, { chapter: last?.chapter ?? "", kind, status: "inclosa", conceptType, description: "", quantity: "1", unit: "u", unitPrice: "", discount: "", vatRateBp: defaultVat(conceptType) }]);
    touch();
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= lines.length) return;
    setLines((ls) => { const c = [...ls]; [c[i], c[j]] = [c[j], c[i]]; return c; });
    touch();
  };

  const calc = useMemo(() => lines.map(toCalc), [lines]);
  const totals = useMemo(() => quoteTotals(calc.filter((c): c is CalcLine => c != null)), [calc]);
  const toReview = lines.filter((l) => l.needsReview).length;

  function save() {
    start(async () => {
      const payload = lines.map((l) => ({ ...l, status: l.status ?? "inclosa", catalogKey: l.catalogKey ?? null, catalogUnitPriceCents: l.catalogUnitPriceCents ?? null,
        needsReview: !!l.needsReview, sourceRef: l.sourceRef ?? "", constructorVisible: !!l.constructorVisible }));
      const res = target.kind === "draft"
        ? await saveDraftAction({ versionId: target.versionId, locale, intro, notes, exclusions, paymentTerms, lines: payload })
        : await convertImportAction({ importId: target.importId, projectId: target.projectId, title, locale, intro, notes, exclusions, paymentTerms, lines: payload });
      if (res.ok) { setDirty(false); setLineErrors({}); setMsg({ ok: true, text: T.savedOk }); }
      else {
        setLineErrors(res.lineErrors ?? {});
        setMsg({ ok: false, text: res.error === "lineErrors" ? T.lineErrors : (errors[res.error] ?? T.errors[res.error] ?? errors.genericError) });
      }
    });
  }

  const err = (i: number, f: string) =>
    lineErrors[i]?.includes(f) || (f === "quantity" && parseQuantityMilli(lines[i].quantity) == null) ? " border-red-500 bg-red-50" : "";

  return (
    <div className="space-y-5" data-testid="quote-editor">
      <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-navy">{T.docLocale}</span>
          <select value={locale} onChange={(e) => { setLocale(e.target.value as "ca" | "es"); touch(); }} className={cell}>
            <option value="es">Castellano</option><option value="ca">Català</option>
          </select>
        </label>
        {isImport ? (
          <label className="text-sm">
            <span className="mb-1 block font-medium text-navy">{T.quoteTitle}</span>
            <input value={title} onChange={(e) => { setTitle(e.target.value); touch(); }} className={cell} required maxLength={200} />
          </label>
        ) : (
          <label className="text-sm">
            <span className="mb-1 block font-medium text-navy">{T.intro}</span>
            <textarea value={intro} onChange={(e) => { setIntro(e.target.value); touch(); }} rows={2} className={cell} />
          </label>
        )}
      </div>

      {toReview > 0 && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="review-warning">⚠ {T.toReview.replace("{n}", String(toReview))}</p>}

      {LINE_KINDS.map((kind) => {
        const idx = lines.map((l, i) => [l, i] as const).filter(([l]) => l.kind === kind);
        return (
          <section key={kind} className="rounded-xl border border-navy/10 bg-white p-3 sm:p-4" data-testid={`section-${kind}`}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-semibold text-navy">{T.kinds[kind]}</h3>
              <button type="button" onClick={() => add(kind)} className="rounded-md border border-navy/15 px-3 py-1.5 text-sm text-navy hover:border-gold" data-testid={`add-${kind}`}>{T.addLine}</button>
            </div>
            {idx.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1120px] text-sm">
                  <thead className="text-left text-xs text-muted">
                    <tr>
                      <th className="w-28 p-1">{T.lineStatus}</th><th className="w-24 p-1">{T.chapter}</th><th className="w-36 p-1">{T.conceptType}</th><th className="p-1">{T.description}</th>
                      <th className="w-20 p-1">{T.quantity}</th><th className="w-14 p-1">{T.unit}</th><th className="w-28 p-1">{T.unitPrice}</th>
                      <th className="w-14 p-1">{T.discount}</th><th className="w-20 p-1">{T.vatRate}</th><th className="w-28 p-1 text-right">{T.amount}</th><th className="w-24 p-1" />
                    </tr>
                  </thead>
                  <tbody>
                    {idx.map(([l, i]) => {
                      const c = calc[i];
                      const st = l.status ?? "inclosa";
                      const lockedPrice = !!l.catalogKey && !canOverridePrices;
                      const overridden = l.catalogUnitPriceCents != null && priceCents(l.unitPrice) != null && priceCents(l.unitPrice) !== l.catalogUnitPriceCents;
                      return (
                        <tr key={i} className={`align-top ${STATUS_CLS[st]} ${l.needsReview ? "outline outline-2 outline-amber-400" : ""}`} data-testid="quote-line">
                          <td className="p-1">
                            <select aria-label={T.lineStatus} value={st} onChange={(e) => update(i, { status: e.target.value as LineStatus })} className={cell}>
                              {LINE_STATUSES.map((s) => <option key={s} value={s}>{T.lineStatuses[s]}</option>)}
                            </select>
                            {l.needsReview && (
                              <label className="mt-1 flex items-center gap-1 text-xs font-semibold text-amber-800">
                                <input type="checkbox" aria-label={T.reviewed} onChange={(e) => update(i, { needsReview: !e.target.checked })} /> {T.reviewed}
                              </label>
                            )}
                          </td>
                          <td className="p-1"><input aria-label={T.chapter} value={l.chapter} onChange={(e) => update(i, { chapter: e.target.value })} className={cell} /></td>
                          <td className="p-1">
                            <select aria-label={T.conceptType} value={l.conceptType} className={cell}
                              onChange={(e) => update(i, { conceptType: e.target.value, vatRateBp: defaultVat(e.target.value) })}>
                              <option value="">—</option>
                              {conceptTypes.map((ct) => <option key={ct.code} value={ct.code}>{ct.label}</option>)}
                            </select>
                          </td>
                          <td className="p-1">
                            <textarea aria-label={T.description} rows={1} value={l.description} onChange={(e) => update(i, { description: e.target.value })} className={cell + err(i, "description")} />
                            <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted">
                              {l.sourceRef && <span>{T.source}: {l.sourceRef}</span>}
                              <label className="flex items-center gap-1"><input type="checkbox" checked={!!l.constructorVisible} onChange={(e) => update(i, { constructorVisible: e.target.checked })} /> {T.constructorVisible}</label>
                            </div>
                          </td>
                          <td className="p-1"><input aria-label={T.quantity} inputMode="decimal" value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value })} className={cell + err(i, "quantity")} /></td>
                          <td className="p-1"><input aria-label={T.unit} value={l.unit} onChange={(e) => update(i, { unit: e.target.value })} className={cell} /></td>
                          <td className="p-1">
                            <input aria-label={T.unitPrice} inputMode="decimal" value={l.unitPrice} disabled={lockedPrice} onChange={(e) => update(i, { unitPrice: e.target.value })}
                              className={cell + (lineErrors[i]?.includes("unitPrice") ? " border-red-500 bg-red-50" : "") + (overridden ? " border-amber-500" : "")} />
                            {l.catalogUnitPriceCents != null && (
                              <span className={`block text-[11px] ${overridden ? "font-semibold text-amber-700" : "text-muted"}`} data-testid={overridden ? "price-override" : undefined}>
                                {overridden ? "✎ " : ""}{T.catalogPrice}: {formatCents(l.catalogUnitPriceCents)}
                              </span>
                            )}
                          </td>
                          <td className="p-1"><input aria-label={T.discount} inputMode="decimal" value={l.discount} onChange={(e) => update(i, { discount: e.target.value })} className={cell + (lineErrors[i]?.includes("discount") ? " border-red-500 bg-red-50" : "")} /></td>
                          <td className="p-1">
                            <select aria-label={T.vatRate} value={l.vatRateBp} onChange={(e) => update(i, { vatRateBp: Number(e.target.value) })} className={cell}>
                              {vatRates.map((r) => <option key={r} value={r}>{formatRate(r)}</option>)}
                            </select>
                          </td>
                          <td className={`p-1 pt-2.5 text-right font-medium tabular-nums ${st !== "inclosa" ? "text-muted line-through decoration-1" : ""}`} data-testid="line-amount">{c ? formatCents(lineAmountCents(c)) : "—"}</td>
                          <td className="whitespace-nowrap p-1 pt-2 text-right">
                            <button type="button" title={T.moveUp} aria-label={T.moveUp} onClick={() => move(i, -1)} className="px-1 text-muted hover:text-navy">↑</button>
                            <button type="button" title={T.moveDown} aria-label={T.moveDown} onClick={() => move(i, 1)} className="px-1 text-muted hover:text-navy">↓</button>
                            <button type="button" title={T.removeLine} aria-label={T.removeLine} onClick={() => { setLines((ls) => ls.filter((_, j) => j !== i)); touch(); }} className="px-1 text-red-700">✕</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}

      <div className="grid gap-3 lg:grid-cols-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-navy">{T.notes}</span>
          <textarea value={notes} onChange={(e) => { setNotes(e.target.value); touch(); }} rows={3} className={cell} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-navy">{T.exclusions}</span>
          <textarea value={exclusions} onChange={(e) => { setExclusions(e.target.value); touch(); }} rows={3} className={cell} data-testid="exclusions" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-navy">{T.paymentTerms}</span>
          <textarea value={paymentTerms} onChange={(e) => { setPaymentTerms(e.target.value); touch(); }} rows={3} className={cell} />
        </label>
      </div>

      <section className="rounded-xl border border-gold/40 bg-gold-light/40 p-4" data-testid="quote-totals">
        <h3 className="mb-2 font-semibold text-navy">{T.totals}</h3>
        <dl className="grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm tabular-nums">
          <dt>{T.base}</dt><dd className="text-right">{formatCents(totals.baseCents)}</dd>
          <dt>{T.extrasInitial}</dt><dd className="text-right">{formatCents(totals.extrasInitialCents)}</dd>
          {totals.extrasLaterCents !== 0 && <><dt>{T.extrasLater}</dt><dd className="text-right">{formatCents(totals.extrasLaterCents)}</dd></>}
          {totals.discountCents !== 0 && <><dt>{T.discounts}</dt><dd className="text-right">{formatCents(totals.discountCents)}</dd></>}
          <dt className="font-semibold text-navy">{T.taxable}</dt><dd className="text-right font-semibold text-navy" data-testid="total-taxable">{formatCents(totals.taxableCents)}</dd>
          {totals.vatBreakdown.map((r) => (
            <Fragment key={r.rateBp}><dt className="text-muted">{T.vat} {formatRate(r.rateBp)} · {formatCents(r.baseCents)}</dt><dd className="text-right">{formatCents(r.vatCents)}</dd></Fragment>
          ))}
          <dt className="text-base font-semibold text-navy">{T.totalWithVat}</dt><dd className="text-right text-base font-semibold text-navy" data-testid="total-with-vat">{formatCents(totals.totalCents)}</dd>
          {totals.optionalCents > 0 && <><dt className="text-sky-800">{T.optionalNotIncluded}</dt><dd className="text-right text-sky-800" data-testid="total-optional">{formatCents(totals.optionalCents)}</dd></>}
          {totals.pendingValuation > 0 && <><dt className="text-amber-800">{T.lineStatuses.pendent_valoracio}</dt><dd className="text-right text-amber-800">{totals.pendingValuation}</dd></>}
        </dl>
      </section>

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border-t border-navy/10 bg-surface/95 py-3 backdrop-blur">
        <button type="button" onClick={save} disabled={pending || (isImport && (toReview > 0 || !title.trim()))} data-testid="save-draft"
          className="rounded-md bg-navy px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{pending ? T.saving : isImport ? T.convert : T.saveDraft}</button>
        {dirty && !pending && !isImport && <span className="text-sm text-amber-700">● {T.unsaved}</span>}
        {isImport && toReview > 0 && <span className="text-sm text-amber-700">{T.convertBlocked}</span>}
        {msg && <span role="status" className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
