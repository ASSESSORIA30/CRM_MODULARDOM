"use client";
/**
 * Fase 2 · Desglossament del preu de l'energia de la factura i excedents fotovoltaics.
 * - El preu total per període es mostra amb el detall desplegable (energia lliure + ATR + …).
 * - Els components es poden corregir a mà: es guarden els valors originals i es recalcula el total.
 * - Els excedents es compten a part del consum de xarxa.
 */
import { useState } from "react";
import { SURPLUS_MODE_LABEL, SURPLUS_MODES, emptySurplus, type Num, type SupplySurplus, type SurplusConfig, type SurplusMode } from "@/comparator/types";
import { Badge, Button, cn } from "../../components/ui";
import { useWizard } from "./state";
import { NumIn } from "./StepValidate";

const emptySupplySurplus = (): SupplySurplus => ({ kwhTotal: null, monthly: null, byPeriod: null, currentCompensationEur: null, currentMode: null, battery: false, batteryBalanceEur: null, estimated: false });

/** Excedents fotovoltaics del subministrament (separats del consum de xarxa). */
export function SurplusSection() {
  const w = useWizard();
  const s = w.supply;
  const sur = s.surplus ?? null;
  const inv = w.invoice?.data;
  const [byPeriod, setByPeriod] = useState(!!sur?.byPeriod);
  if (s.energyType === "gas") return null;
  const set = (patch: Partial<SupplySurplus>) => w.setSupply({ surplus: { ...(sur ?? emptySupplySurplus()), ...patch } });
  const setArr = (arr: Num[] | null, i: number, v: Num, n: number) => (arr ?? Array(n).fill(null)).map((x, j) => (j === i ? v : x));
  // Compensació del CONTRACTE ACTUAL: el preu manual entra al motor igual que el de les ofertes (costos homogenis)
  const curSur = w.current?.surplus ?? null;
  const setCurSur = (p: Partial<SurplusConfig>) => w.setCurrent({ surplus: { ...(curSur ?? emptySurplus("no_informada")), ...p, source: "ajust" } });
  const batteryCfg = (on: boolean) => (on ? curSur?.battery ?? { enabled: true, feeEurMonth: null, accumulation: null, usage: null, expiry: null } : null);
  const setCurrentPrice = (v: Num) => {
    if (v == null) setCurSur({ eurKwh: null, mode: curSur?.mode === "sense" ? "sense" : "no_informada", mechanism: null });
    else setCurSur({ eurKwh: v, mode: sur?.battery ? "bateria" : "fix", mechanism: curSur?.mechanism ?? "compensacio_simplificada", battery: batteryCfg(!!sur?.battery) });
  };
  const setCurrentMode = (m: SurplusMode | null) => {
    set({ currentMode: m });
    if (!w.current) return;
    if (m === "sense") setCurSur({ ...emptySurplus("sense") });
    else if ((!m || m === "no_informada") && curSur?.mode === "sense") setCurSur({ mode: "no_informada", mechanism: null });
    else if (m && m !== "no_informada" && curSur?.eurKwh != null) setCurSur({ mode: m, battery: batteryCfg(m === "bateria" || !!sur?.battery) });
  };

  return (
    <section className="space-y-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[14px] font-semibold">Excedents fotovoltaics</h3>
        {sur ? (
          <Button size="sm" variant="ghost" onClick={() => w.setSupply({ surplus: null })}>Sense autoconsum amb excedents</Button>
        ) : (
          <Button size="sm" onClick={() => w.setSupply({ surplus: emptySupplySurplus() })}>Té excedents</Button>
        )}
      </div>
      {!sur ? (
        <p className="text-[12.5px] text-muted">Si el client té plaques amb excedents, afegeix-los: es comparen a part del consum de xarxa i es calcula la compensació de cada oferta.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <NumIn label="Excedents (kWh)" value={sur.kwhTotal} field={inv?.surplusKwh} src={inv?.surplusKwh?.value != null ? "factura" : "manual"} onChange={(v) => set({ kwhTotal: v })} />
            <NumIn label="Compensació actual (€)" value={sur.currentCompensationEur} field={inv?.surplusCompensationEur} onChange={(v) => set({ currentCompensationEur: v })} />
            <label className="block">
              <span className="label">Modalitat actual</span>
              <select className="input" value={sur.currentMode ?? ""} onChange={(e) => setCurrentMode((e.target.value || null) as SurplusMode | null)}>
                <option value="">Sense indicar</option>
                {SURPLUS_MODES.map((m) => <option key={m} value={m}>{SURPLUS_MODE_LABEL[m]}</option>)}
              </select>
            </label>
            {w.current && <NumIn label="Preu excedents actual (€/kWh)" value={curSur?.mode === "sense" ? 0 : curSur?.eurKwh ?? null} field={inv?.surplusPrice} src={curSur?.source === "ajust" ? "manual" : curSur?.eurKwh != null ? "factura" : null} onChange={setCurrentPrice} />}
            <label className="flex items-end gap-2 pb-2 text-[12.5px]"><input type="checkbox" checked={sur.battery} onChange={(e) => { set({ battery: e.target.checked }); if (w.current && curSur?.eurKwh != null) setCurSur({ mode: e.target.checked ? "bateria" : "fix", battery: batteryCfg(e.target.checked) }); }} /> Bateria virtual</label>
            {sur.battery && <NumIn label="Saldo bateria (€)" value={sur.batteryBalanceEur} field={inv?.batteryBalanceEur} onChange={(v) => set({ batteryBalanceEur: v })} />}
            <label className="flex items-end gap-2 pb-2 text-[12.5px]"><input type="checkbox" checked={sur.estimated} onChange={(e) => set({ estimated: e.target.checked })} /> Valors estimats</label>
          </div>
          <div className="flex flex-wrap gap-2 text-[12px]">
            <button className={cn("rounded-lg px-2 py-1", byPeriod ? "bg-ink/[0.06]" : "underline")} onClick={() => { setByPeriod(!byPeriod); if (byPeriod) set({ byPeriod: null }); }}>
              {byPeriod ? "Treu el repartiment per períodes" : "Afegeix repartiment per períodes"}
            </button>
            <button className={cn("rounded-lg px-2 py-1", sur.monthly ? "bg-ink/[0.06]" : "underline")} onClick={() => set({ monthly: sur.monthly ? null : Array(12).fill(null) })}>
              {sur.monthly ? "Treu el detall mensual" : "Afegeix detall mensual"}
            </button>
          </div>
          {byPeriod && (
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {Array.from({ length: 6 }, (_, i) => <NumIn key={i} label={`Excedents P${i + 1} (kWh)`} value={sur.byPeriod?.[i] ?? null} onChange={(v) => set({ byPeriod: setArr(sur.byPeriod, i, v, 6) })} />)}
            </div>
          )}
          {sur.monthly && (
            <div className="grid gap-2 sm:grid-cols-4 lg:grid-cols-12">
              {Array.from({ length: 12 }, (_, i) => <NumIn key={i} label={`Mes ${i + 1}`} value={sur.monthly?.[i] ?? null} onChange={(v) => set({ monthly: setArr(sur.monthly, i, v, 12) })} />)}
            </div>
          )}
          {sur.kwhTotal == null && !sur.byPeriod?.some((x) => x != null) && !sur.monthly?.some((x) => x != null) && <Badge tone="amber">Falten els kWh excedentaris: la compensació quedarà pendent (no s&apos;inventa cap valor).</Badge>}
          {w.current && curSur?.eurKwh == null && curSur?.mode !== "sense" && sur.currentCompensationEur == null && <p className="text-[11.5px] text-muted">Per comparar costos homogenis, indica el preu d&apos;excedents del contracte actual o l&apos;import compensat a la factura. El preu manual de cada oferta es pot posar al pas de resultats («Ajustos d&apos;aquesta comparativa»).</p>}
        </>
      )}
    </section>
  );
}
