"use client";

// Configurador del CRM: mateixos passos, opcions i motor de càlcul que www.modulardom.com/presupuesto.
import { useMemo, useState, useTransition } from "react";
import { createFromConfiguratorAction } from "@/app/(app)/projectes/[id]/pressupostos/configurator-actions";
import { calculate, KITCHEN_LABEL, SUITE_LABEL, validateInput, type ConfigInput, type TariffParams } from "@/lib/configurator/engine";
import type { QuoteV2Texts } from "@/lib/i18n-pressupostos-v2";
import { formatCents } from "@/lib/money";

const chip = (on: boolean) => `rounded-lg border-2 px-3 py-2 text-sm font-medium transition ${on ? "border-gold bg-gold-light text-navy" : "border-navy/10 bg-white text-ink hover:border-navy/30"}`;

export function ConfiguratorForm({ projectId, tariff, tariffId, tariffLabel, X, errors, showInternal, defaultTitle }: {
  projectId: string; tariff: TariffParams; tariffId: string; tariffLabel: string; X: QuoteV2Texts; errors: Record<string, string>;
  showInternal: boolean; defaultTitle: string;
}) {
  const [c, setC] = useState<ConfigInput>({ metres: 150, habitacions: 3, banys: 2, suite: "bano", cuina: "basica", vehicles: 0, safareig: false, installacions: [], extres: [] });
  const [metresText, setMetresText] = useState("150");
  const [locale, setLocale] = useState<"ca" | "es">("es");
  const [title, setTitle] = useState(defaultTitle);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (patch: Partial<ConfigInput>) => { setC((x) => ({ ...x, ...patch })); setErr(null); };
  const toggle = (k: "installacions" | "extres", v: string) => set({ [k]: c[k].includes(v) ? c[k].filter((x) => x !== v) : [...c[k], v] });
  const issues = useMemo(() => validateInput(tariff, c), [tariff, c]);
  const r = useMemo(() => (issues.length ? null : calculate(tariff, c)), [tariff, c, issues]);

  function generate() {
    start(async () => {
      const res = await createFromConfiguratorAction({ projectId, title, locale, tariffId, input: c });
      if (res && !res.ok) setErr(errors[res.error] ?? errors.genericError);
    });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_380px]" data-testid="configurator">
      <div className="space-y-5">
        <section className="rounded-xl border border-navy/10 bg-white p-4">
          <label className="block text-sm font-semibold text-navy" htmlFor="cfg-m2">1 · {X.surface}</label>
          <input id="cfg-m2" inputMode="numeric" value={metresText} data-testid="cfg-metres"
            onChange={(e) => { setMetresText(e.target.value); const n = Number(e.target.value); set({ metres: Number.isInteger(n) ? n : NaN }); }}
            className="mt-2 w-40 rounded-md border border-navy/20 px-3 py-2 text-lg tabular-nums" />
          {issues.some((i) => i.field === "metres") && <p className="mt-1 text-sm text-red-700">{X.minSurface.replace("{n}", String(tariff.metres_minims))}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            {[100, 120, 150, 180, 200, 250, 300].map((m) => <button key={m} type="button" className={chip(c.metres === m)} onClick={() => { setMetresText(String(m)); set({ metres: m }); }}>{m} m²</button>)}
          </div>
          <p className="mt-2 text-xs text-muted">{X.constructiveSystem}</p>
        </section>
        <section className="grid gap-4 rounded-xl border border-navy/10 bg-white p-4 sm:grid-cols-2">
          <div>
            <p className="text-sm font-semibold text-navy">2 · {X.bedrooms}</p>
            <div className="mt-2 flex flex-wrap gap-2">{tariff.opcions.habitacions.map((n) => <button key={n} type="button" data-testid={`cfg-room-${n}`} className={chip(c.habitacions === n)} onClick={() => set({ habitacions: n })}>{n}</button>)}</div>
          </div>
          <div>
            <p className="text-sm font-semibold text-navy">3 · {X.bathrooms}</p>
            <div className="mt-2 flex flex-wrap gap-2">{tariff.opcions.banys.map((n) => <button key={n} type="button" data-testid={`cfg-bath-${n}`} className={chip(c.banys === n)} onClick={() => set({ banys: n })}>{n}</button>)}</div>
          </div>
          <div>
            <p className="text-sm font-semibold text-navy">4 · {X.suite}</p>
            <div className="mt-2 flex flex-wrap gap-2">{(["sin", "bano", "bano_vestidor"] as const).map((s) => <button key={s} type="button" data-testid={`cfg-suite-${s}`} className={chip(c.suite === s)} onClick={() => set({ suite: s })}>{SUITE_LABEL[s][locale]}</button>)}</div>
          </div>
          <div>
            <p className="text-sm font-semibold text-navy">5 · {X.kitchen}</p>
            <div className="mt-2 flex flex-wrap gap-2">{(["basica", "isla"] as const).map((k) => <button key={k} type="button" data-testid={`cfg-kitchen-${k}`} className={chip(c.cuina === k)} onClick={() => set({ cuina: k })}>{KITCHEN_LABEL[k][locale]}</button>)}</div>
          </div>
          <div className="sm:col-span-2">
            <p className="text-sm font-semibold text-navy">6 · {X.garage}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {Array.from({ length: tariff.garatge.max_vehicles + 1 }, (_, n) => <button key={n} type="button" data-testid={`cfg-garage-${n}`} className={chip(c.vehicles === n)} onClick={() => set({ vehicles: n })}>{n === 0 ? X.noGarage : n}</button>)}
            </div>
          </div>
        </section>
        <section className="rounded-xl border border-navy/10 bg-white p-4">
          <p className="text-sm font-semibold text-navy">7 · {X.installations}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {Object.entries(tariff.installacions_m2).map(([k, v]) => <button key={k} type="button" data-testid={`cfg-inst-${k}`} className={chip(c.installacions.includes(k))} onClick={() => toggle("installacions", k)}>{v.nom[locale]}</button>)}
          </div>
          <p className="mt-4 text-sm font-semibold text-navy">{X.fixedExtras}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" data-testid="cfg-laundry" className={chip(c.safareig)} onClick={() => set({ safareig: !c.safareig })}>{X.laundry}</button>
            {Object.entries(tariff.extres).map(([k, v]) => <button key={k} type="button" data-testid={`cfg-extra-${k}`} className={chip(c.extres.includes(k))} onClick={() => toggle("extres", k)}>{v.nom[locale]}</button>)}
          </div>
        </section>
      </div>

      <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
        <section className="rounded-xl bg-navy p-4 text-white" data-testid="cfg-summary">
          <p className="text-xs font-semibold tracking-widest text-gold">{X.summary.toUpperCase()}</p>
          <p className="text-[11px] text-white/60">{tariffLabel}</p>
          {r ? (
            <>
              <ul className="mt-3 space-y-1 text-sm">
                {r.lines.map((l) => (
                  <li key={l.key} className="flex justify-between gap-3">
                    <span>{l.label[locale]}{l.discountPct ? <span className="block text-[11px] text-gold">−{l.discountPct} % {X.discount}: <s>{formatCents(l.originalCents!)}</s></span> : null}</span>
                    <span className="tabular-nums" data-testid={`cfg-line-${l.key}`}>{formatCents(l.amountCents)}</span>
                  </li>
                ))}
              </ul>
              <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 border-t border-white/20 pt-2 text-sm tabular-nums">
                <dt className="text-white/70">{X.baseObra}</dt><dd className="text-right">{formatCents(r.baseObraCents)}</dd>
                <dt className="text-white/70">{X.baseArq}</dt><dd className="text-right">{formatCents(r.baseArqCents)}</dd>
                <dt className="text-white/70">{X.vatObra} ({tariff.iva_obra_pct} %)</dt><dd className="text-right">{formatCents(r.ivaObraCents)}</dd>
                <dt className="text-white/70">{X.vatArq} ({tariff.iva_arquitecte_pct} %)</dt><dd className="text-right">{formatCents(r.ivaArqCents)}</dd>
                <dt className="font-semibold text-gold">{X.total}</dt><dd className="text-right text-lg font-semibold text-gold" data-testid="cfg-total">{formatCents(r.totalCents)}</dd>
              </dl>
              {showInternal && (
                <p className="mt-2 text-[11px] text-white/60">{X.internal}: {X.rooms} {formatCents(r.internal.habitacions)} · {X.baths} {formatCents(r.internal.banys)} · Suite {formatCents(r.internal.suite)} · {X.laundry} {formatCents(r.internal.safareig)}</p>
              )}
            </>
          ) : <p className="mt-3 text-sm text-white/70">—</p>}
        </section>
        <section className="space-y-2 rounded-xl border border-navy/10 bg-white p-4">
          <label className="block text-sm"><span className="mb-1 block font-medium text-navy">Títol / Título</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className="w-full rounded-md border border-navy/20 px-3 py-2 text-sm" /></label>
          <label className="block text-sm"><span className="mb-1 block font-medium text-navy">Idioma</span>
            <select value={locale} onChange={(e) => setLocale(e.target.value as "ca" | "es")} className="w-full rounded-md border border-navy/20 px-3 py-2 text-sm">
              <option value="es">Castellano</option><option value="ca">Català</option>
            </select></label>
          <button type="button" onClick={generate} disabled={pending || !r || !title.trim()} data-testid="cfg-generate"
            className="w-full rounded-md bg-gold px-4 py-2.5 text-sm font-semibold text-navy disabled:opacity-50">{X.generate}</button>
          {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
        </section>
      </aside>
    </div>
  );
}
