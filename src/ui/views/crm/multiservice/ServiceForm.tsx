"use client";
/**
 * «Nou contracte» MULTISERVEI: selector de serveis amb targetes i formulari per passos per a cada servei.
 * L'electricitat i el gas obren el formulari d'energia de sempre (CUPS, tarifa d'accés, renovacions): no canvia.
 * La resta de serveis es desen al MATEIX sistema de contractes amb les seves dades pròpies.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2, Plus, Save, Trash2, Wand2 } from "lucide-react";
import {
  ALARM_COMPANIES, FAMILY_LABEL, FIBRA_OPERATIONS, FIBRA_OPERATION_LABEL, FIBRA_OPERATORS, INSURANCE_TYPES, INSURANCE_TYPE_LABEL, LINE_STATUSES, LINE_STATUS_LABEL,
  PERIODICITIES, PERIODICITY_LABEL, SERVICE_CARDS, SERVICE_FAMILY, SOLAR_PHASES, SOLAR_PHASE_LABEL, STATUS_FLOW, contractAlerts, fillFromClient, serviceForFamily,
  serviceTotals, summaryColumns, validateServiceContract, type ContractService, type Issue, type ServiceFamily,
} from "@/core/multiservice";
import { CONTRACT_STATUS_LABEL, type ContractLineRow, type ContractStatus, type CrmContract } from "@/core/crm";
import { useApp } from "@/data/store";
import { Button, Modal, Notice, cn } from "../../../components/ui";
import { crmApi } from "../api";
import type { Ctx } from "../ClientDetail";
import { ContractForm } from "../ContractsTab";
import { FamilyIcon } from "./icons";

/* ------------------------------------------------------------------ selector de serveis */

export function NewContractPicker({ ctx, onClose, onSaved }: { ctx: Ctx; onClose: () => void; onSaved: () => void }) {
  const [family, setFamily] = useState<ServiceFamily | null>(null);
  if (family === "electricitat" || family === "gas") {
    const supply = ctx.d.supplies.find((s) => !s.archived_at && (family === "gas" ? s.energy_type === "gas" : s.energy_type === "luz"));
    return <ContractForm ctx={ctx} contract={null} supplyId={supply?.id} onClose={onClose} onSaved={onSaved} />;
  }
  if (family) return <ServiceContractForm ctx={ctx} service={serviceForFamily(family, ctx.d.client.kind)} contract={null} onClose={onClose} onSaved={onSaved} onBack={() => setFamily(null)} />;
  return (
    <Modal open onClose={onClose} width="max-w-3xl" title="Nou contracte · tria el servei">
      <div className="grid gap-2.5 sm:grid-cols-3">
        {SERVICE_CARDS.map((c) => (
          <button key={c.family} type="button" onClick={() => setFamily(c.family)}
            className="group flex flex-col items-start gap-2 rounded-2xl border border-line bg-surface p-3.5 text-left transition hover:border-accent hover:bg-accent/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            <FamilyIcon family={c.family} size={22} />
            <span className="font-semibold">{FAMILY_LABEL[c.family]}</span>
            <span className="text-[12px] text-muted">{c.hint}</span>
          </button>
        ))}
      </div>
      <p className="mt-3 text-[12px] text-muted">Cada servei és un contracte propi del client: no es barregen mai, encara que siguin del mateix proveïdor.</p>
    </Modal>
  );
}

/* ------------------------------------------------------------------ ajudes de formulari */

type Obj = Record<string, unknown>;
const getAt = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((a, k) => (a == null ? undefined : (a as Obj)[k]), o);
function setAt<T extends Obj>(o: T, path: string, v: unknown): T {
  const [h, ...rest] = path.split(".");
  return { ...o, [h]: rest.length ? setAt(((o[h] as Obj) ?? {}) as Obj, rest.join("."), v) : v } as T;
}
interface FormState { details: Obj; lines: Partial<ContractLineRow>[]; status: ContractStatus; signed_at: string; start_date: string; owner_id: string; collaborator_id: string; notes: string }
const draftKey = (clientId: string, service: ContractService, id?: string | null) => `a30:ms-draft:${clientId}:${service}:${id ?? "nou"}`;
const readDraft = (k: string): FormState | null => { try { const v = window.localStorage.getItem(k); return v ? JSON.parse(v) as FormState : null; } catch { return null; } };
const writeDraft = (k: string, v: FormState | null) => { try { if (v) window.localStorage.setItem(k, JSON.stringify(v)); else window.localStorage.removeItem(k); } catch { /* sense emmagatzematge: no passa res */ } };

interface Step { id: string; label: string; prefixes: string[]; body: ReactNode }

/* ------------------------------------------------------------------ formulari per servei */

export function ServiceContractForm({ ctx, service, contract, renewOf, onClose, onSaved, onBack }: {
  ctx: Ctx; service: ContractService; contract: CrmContract | null; renewOf?: CrmContract; onClose: () => void; onSaved: () => void; onBack?: () => void;
}) {
  const { d, facets } = ctx;
  const fam = SERVICE_FAMILY[service];
  const base = contract ?? renewOf ?? null;
  const key = draftKey(d.client.id, service, contract?.id);
  const initial: FormState = {
    details: (base?.details as Obj | null) ?? {},
    lines: (base?.lines ?? []).filter((l) => !renewOf || l.status !== "baixa").map((l) => (renewOf ? { ...l, id: undefined } : l)),
    status: contract?.status ?? "esborrany",
    signed_at: contract?.signed_at ?? "", start_date: contract?.start_date ?? "",
    owner_id: contract?.owner_id ?? renewOf?.owner_id ?? d.client.owner_id ?? "",
    collaborator_id: contract?.collaborator_id ?? d.client.collaborator_id ?? "",
    notes: contract?.notes ?? "",
  };
  const saved = typeof window !== "undefined" && !contract ? readDraft(key) : null;
  const [f, setF] = useState<FormState>(initial);
  const [recover, setRecover] = useState<FormState | null>(saved);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState<null | "draft" | "final">(null);
  const [err, setErr] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(contract?.id ?? null);
  const [finalStatus, setFinalStatus] = useState<ContractStatus>(contract && contract.status !== "esborrany" ? contract.status : "pendent_documentacio");
  const [shown, setShown] = useState<Set<string>>(new Set());
  const touched = useRef(new Set<string>());

  // autocompletar el titular amb les dades del client sense trepitjar res escrit
  const fillHolder = (force = false) => {
    const c = d.client;
    const holder = (f.details.holder as Obj | undefined) ?? {};
    const src = { name: c.name, tax_id: c.tax_id, phone: c.phone, email: c.email };
    const r = fillFromClient(holder, src, force ? new Set<string>() : touched.current);
    const address = { street: c.address, city: c.city, postal_code: c.postal_code, province: c.province };
    let details = setAt(f.details, "holder", r.form);
    if (["fibra", "fibra_mobil", "alarmes", "plaques_solars"].includes(fam)) {
      const cur = (f.details.install_address as Obj | undefined) ?? {};
      details = setAt(details, "install_address", fillFromClient(cur, address, touched.current).form);
    }
    setF((x) => ({ ...x, details }));
  };
  // només en obrir el formulari
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!contract && !saved) fillHolder(); }, []);
  useEffect(() => { if (!contract) writeDraft(key, f); }, [f, key, contract]);

  const set = (path: string, v: unknown) => { touched.current.add(path.replace(/^holder\./, "").replace(/^install_address\./, "")); setF((x) => ({ ...x, details: setAt(x.details, path, v) })); };
  const val = (path: string) => getAt(f.details, path);
  const statusFor = (draft: boolean) => (draft ? (contract && contract.status !== "esborrany" ? contract.status : "esborrany") : finalStatus);
  const check = (draft: boolean) => validateServiceContract({ service, status: statusFor(draft), details: f.details, lines: f.lines, start_date: f.start_date || null });
  const live = useMemo(() => check(false), [f, finalStatus]); // eslint-disable-line react-hooks/exhaustive-deps
  const issuesFor = (prefixes: string[]) => live.issues.filter((i) => prefixes.some((p) => i.path === p || i.path.startsWith(`${p}.`) || i.path.startsWith(p)));
  const totals = serviceTotals(service, live.details, live.lines);
  const summary = summaryColumns(service, live.details, live.lines, f.start_date || null);

  /* ---------- camps */
  const Err = ({ path }: { path: string }) => {
    const m = shown.has(path) || shown.has("*") ? live.issues.find((i) => i.path === `details.${path}` || i.path === path)?.message : null;
    return m ? <span className="mt-0.5 block text-[11.5px] text-lost">{m}</span> : null;
  };
  const blur = (path: string) => setShown((s) => new Set(s).add(path));
  const T = ({ path, label, ph, span, type = "text" }: { path: string; label: string; ph?: string; span?: boolean; type?: "text" | "date" | "email" | "tel" }) => (
    <label className={cn("block", span && "sm:col-span-2")}><span className="label">{label}</span>
      <input className="input" type={type} value={(val(path) as string | null) ?? ""} placeholder={ph} onBlur={() => blur(path)} onChange={(e) => set(path, e.target.value || null)} />
      <Err path={path} />
    </label>
  );
  const N = ({ path, label, unit }: { path: string; label: string; unit?: string }) => (
    <label className="block"><span className="label">{label}{unit ? ` (${unit})` : ""}</span>
      <input className="input tnum" inputMode="decimal" value={(val(path) as string | number | null) ?? ""} onBlur={() => blur(path)} onChange={(e) => set(path, e.target.value === "" ? null : e.target.value)} />
      <Err path={path} />
    </label>
  );
  const S = ({ path, label, options, labels, allowEmpty }: { path: string; label: string; options: readonly string[]; labels?: Record<string, string>; allowEmpty?: boolean }) => (
    <label className="block"><span className="label">{label}</span>
      <select className="input" value={(val(path) as string | null) ?? ""} onBlur={() => blur(path)} onChange={(e) => set(path, e.target.value || null)}>
        {allowEmpty !== false && <option value="">—</option>}
        {options.map((o) => <option key={o} value={o}>{labels?.[o] ?? o}</option>)}
      </select>
      <Err path={path} />
    </label>
  );
  const C = ({ path, label }: { path: string; label: string }) => (
    <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={!!val(path)} onChange={(e) => set(path, e.target.checked)} /> {label}</label>
  );
  const Provider = ({ path, label, options }: { path: string; label: string; options: readonly string[] }) => {
    const v = (val(path) as string | null) ?? "";
    const other = v !== "" && !options.includes(v);
    return (
      <label className="block"><span className="label">{label} *</span>
        <select className="input" value={other ? "Altres" : v} onBlur={() => blur(path)} onChange={(e) => set(path, e.target.value === "Altres" ? "" : e.target.value || null)}>
          <option value="">Tria…</option>{options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        {(other || v === "") && <input className="input mt-1.5" placeholder="Nom si és un altre" value={other ? v : ""} onChange={(e) => set(path, e.target.value || null)} />}
        <Err path={path} />
      </label>
    );
  };
  const grid = (children: ReactNode) => <div className="grid gap-3 text-[13px] sm:grid-cols-2">{children}</div>;

  /* ---------- blocs reutilitzables */
  const holderStep: Step = {
    id: "titular", label: "Titular", prefixes: ["details.holder"], body: grid(<>
      <div className="flex items-center justify-between gap-2 sm:col-span-2">
        <p className="text-[12px] text-muted">S&apos;omplen amb la fitxa del client només els camps buits. El que hagis escrit no es toca.</p>
        <Button size="sm" variant="ghost" onClick={() => fillHolder()}><Wand2 size={13} /> Omple buits</Button>
      </div>
      <T path="holder.name" label="Nom o raó social" span /><T path="holder.tax_id" label="NIF / CIF" /><T path="holder.phone" label="Telèfon" type="tel" /><T path="holder.email" label="Correu" type="email" span />
    </>),
  };
  const address = (label: string) => <>
    <p className="text-[12px] font-semibold text-muted sm:col-span-2">{label}</p>
    <T path="install_address.street" label="Adreça" span /><T path="install_address.city" label="Població" /><T path="install_address.postal_code" label="Codi postal" /><T path="install_address.province" label="Província" />
  </>;
  const economics = (withPromo: boolean) => grid(<>
    <N path="economics.monthly_eur" label="Quota mensual" unit="€" />
    {withPromo && <><N path="economics.promo_monthly_eur" label="Quota en promoció" unit="€" /><N path="economics.promo_months" label="Mesos de promoció" /></>}
    <N path="economics.activation_eur" label="Cost d'alta" unit="€" /><N path="economics.installation_eur" label="Cost d'instal·lació" unit="€" />
    <N path="economics.permanence_months" label="Permanència" unit="mesos" /><N path="economics.penalty_eur" label="Penalització per baixa anticipada" unit="€" />
    <T path="dates.requested_at" label="Data de sol·licitud" type="date" /><T path="dates.installation_at" label="Data d'instal·lació" type="date" /><T path="dates.activated_at" label="Data d'activació" type="date" />
  </>);
  const linesStep = (pack: boolean): Step => ({
    id: "linies", label: pack ? "Línies i paquet" : "Línies", prefixes: ["lines", "details.package"], body: (
      <div className="space-y-3 text-[13px]">
        {pack && grid(<><N path="package.package_monthly_eur" label="Preu mensual del paquet" unit="€" /><T path="package.name" label="Nom del paquet" /></>)}
        {pack && <p className="text-[12px] text-muted">Les línies marcades «incloses al paquet» no se sumen una altra vegada: el preu que paga el client és el del paquet més les línies extra.</p>}
        {f.lines.map((l, i) => (
          <fieldset key={l.id ?? `n${i}`} className={cn("rounded-xl border border-line p-3", l.status === "baixa" && "opacity-60")}>
            <legend className="px-1 text-[12px] font-semibold">Línia {i + 1}{l.status === "baixa" ? " · baixa" : ""}</legend>
            <div className="grid gap-2.5 sm:grid-cols-3">
              <label className="block"><span className="label">Tipus</span><select className="input" value={l.line_type ?? "nova"} onChange={(e) => setLine(i, { line_type: e.target.value as "nova" })}><option value="nova">Número nou</option><option value="portabilitat">Portabilitat</option></select></label>
              <label className="block"><span className="label">Número{l.line_type === "portabilitat" ? " *" : ""}</span><input className="input tnum" inputMode="tel" value={l.phone_number ?? ""} onChange={(e) => setLine(i, { phone_number: e.target.value || null })} /><LineErr i={i} field="phone_number" /></label>
              {l.line_type === "portabilitat" && <label className="block"><span className="label">Operador donant *</span><input className="input" value={l.donor_operator ?? ""} onChange={(e) => setLine(i, { donor_operator: e.target.value || null })} /><LineErr i={i} field="donor_operator" /></label>}
              <label className="block"><span className="label">Tarifa *</span><input className="input" value={l.tariff ?? ""} onChange={(e) => setLine(i, { tariff: e.target.value || null })} /><LineErr i={i} field="tariff" /></label>
              <label className="block"><span className="label">Dades (GB)</span><input className="input tnum" inputMode="decimal" value={l.data_gb ?? ""} onChange={(e) => setLine(i, { data_gb: (e.target.value || null) as never })} /></label>
              <label className="block"><span className="label">Preu de la línia (€/mes)</span><input className="input tnum" inputMode="decimal" value={l.price_monthly_eur ?? ""} onChange={(e) => setLine(i, { price_monthly_eur: (e.target.value || null) as never })} /><LineErr i={i} field="price_monthly_eur" /></label>
              <label className="block"><span className="label">Titular de la línia</span><input className="input" value={l.holder_name ?? ""} onChange={(e) => setLine(i, { holder_name: e.target.value || null })} /></label>
              <label className="block"><span className="label">Estat de la línia</span><select className="input" value={l.status ?? "pendent"} onChange={(e) => setLine(i, { status: e.target.value })}>{LINE_STATUSES.map((s) => <option key={s} value={s}>{LINE_STATUS_LABEL[s]}</option>)}</select></label>
              {l.status === "activa" && <label className="block"><span className="label">Activada el *</span><input className="input" type="date" value={l.activated_at ?? ""} onChange={(e) => setLine(i, { activated_at: e.target.value || null })} /><LineErr i={i} field="activated_at" /></label>}
              {pack && <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" checked={!!l.included_in_package} onChange={(e) => setLine(i, { included_in_package: e.target.checked })} /> Inclosa al preu del paquet</label>}
            </div>
            <div className="mt-2 flex justify-end">
              {l.id
                ? l.status !== "baixa" && <Button size="sm" variant="ghost" onClick={() => setLine(i, { status: "baixa" })}><Trash2 size={13} /> Dona de baixa</Button>
                : <Button size="sm" variant="ghost" onClick={() => setF((x) => ({ ...x, lines: x.lines.filter((_, j) => j !== i) }))}><Trash2 size={13} /> Treu</Button>}
            </div>
          </fieldset>
        ))}
        <Button size="sm" onClick={() => setF((x) => ({ ...x, lines: [...x.lines, { line_type: "nova", status: "pendent", included_in_package: pack }] }))}><Plus size={13} /> Afegeix una línia</Button>
        <LineErr i={-1} field="" />
      </div>
    ),
  });
  function setLine(i: number, p: Partial<ContractLineRow>) { setShown((s) => new Set(s).add(`lines.${i}`)); setF((x) => ({ ...x, lines: x.lines.map((l, j) => (j === i ? { ...l, ...p } : l)) })); }
  function LineErr({ i, field }: { i: number; field: string }) {
    const path = i < 0 ? "lines" : `lines.${i}.${field}`;
    const m = (i < 0 ? shown.has("*") : shown.has(`lines.${i}`) || shown.has("*")) ? live.issues.find((x) => x.path === path)?.message : null;
    return m ? <span className="mt-0.5 block text-[11.5px] text-lost">{m}</span> : null;
  }

  const internalStep: Step = {
    id: "interns", label: "Dades internes", prefixes: ["start_date", "end_date"], body: grid(<>
      <label className="block"><span className="label">Data de signatura</span><input className="input" type="date" value={f.signed_at} onChange={(e) => setF({ ...f, signed_at: e.target.value })} /></label>
      <label className="block"><span className="label">{fam === "assegurances" ? "Data d'inici" : "Data d'inici del servei"}</span><input className="input" type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></label>
      <label className="block"><span className="label">Comercial responsable</span>
        {d.permissions.isStaff ? <select className="input" value={f.owner_id} onChange={(e) => setF({ ...f, owner_id: e.target.value })}><option value="">—</option>{(facets?.users ?? []).filter((u) => u.role !== "colaborador").map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          : <input className="input" disabled value={facets?.users.find((u) => u.id === f.owner_id)?.name ?? "—"} />}
      </label>
      <label className="block"><span className="label">Col·laborador</span>
        {d.permissions.isStaff ? <select className="input" value={f.collaborator_id} onChange={(e) => setF({ ...f, collaborator_id: e.target.value })}><option value="">—</option>{(facets?.collaborators ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          : <input className="input" disabled value={facets?.collaborators.find((u) => u.id === f.collaborator_id)?.name ?? d.client.collaborator_name ?? "—"} />}
      </label>
      <T path="observations" label="Observacions del servei" span />
      <label className="block sm:col-span-2"><span className="label">Notes internes</span><textarea className="input min-h-[60px]" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
      <p className="text-[12px] text-muted sm:col-span-2">La comissió prevista la calcula el CRM amb les regles aprovades per Direcció quan es desa el contracte. Només la veuen Direcció, l&apos;Administració autoritzada i el comercial responsable; mai el client ni el col·laborador.</p>
    </>),
  };

  /* ---------- passos de cada servei */
  const steps: Step[] = (() => {
    switch (fam) {
      case "fibra": case "fibra_mobil": {
        const fibra: Step = { id: "fibra", label: "Fibra", prefixes: ["details.operator", "details.product", "details.operation", "details.speed_mbps", "details.technology", "details.install_address", "details.fixed_line", "details.operator_ref"], body: grid(<>
          <Provider path="operator" label="Operador" options={FIBRA_OPERATORS} />
          <T path="product" label="Producte o tarifa" ph="Segons el catàleg de l'operador" />
          <S path="operation" label="Tipus d'operació" options={FIBRA_OPERATIONS} labels={FIBRA_OPERATION_LABEL} allowEmpty={false} />
          <N path="speed_mbps" label="Velocitat" unit="Mb" />
          <S path="technology" label="Tecnologia" options={["FTTH", "HFC", "altres"]} />
          <T path="operator_ref" label="Referència de l'operador" />
          {address("Adreça d'instal·lació")}
          <div className="sm:col-span-2"><C path="fixed_line.enabled" label="Inclou línia fixa" /></div>
          {!!val("fixed_line.enabled") && <><T path="fixed_line.number" label="Número de fix" type="tel" /><div className="flex items-end"><C path="fixed_line.portability" label="Portabilitat del fix" /></div>
            {!!val("fixed_line.portability") && <T path="fixed_line.donor_operator" label="Operador donant" />}</>}
        </>) };
        const eco: Step = { id: "condicions", label: "Condicions", prefixes: ["details.economics", "details.dates"], body: economics(true) };
        return fam === "fibra" ? [holderStep, fibra, eco, internalStep] : [holderStep, fibra, linesStep(true), eco, internalStep];
      }
      case "mobil": return [holderStep,
        { id: "operador", label: "Operador", prefixes: ["details.operator", "details.product", "details.operator_ref"], body: grid(<><Provider path="operator" label="Operador" options={FIBRA_OPERATORS} /><T path="product" label="Producte" /><T path="operator_ref" label="Referència de l'operador" /></>) },
        linesStep(false), { id: "condicions", label: "Condicions", prefixes: ["details.economics", "details.dates"], body: economics(true) }, internalStep];
      case "assegurances": return [holderStep, { id: "polissa", label: "Pòlissa", prefixes: ["details."], body: grid(<>
        <T path="insurer" label="Companyia asseguradora *" /><S path="insurance_type" label="Tipus d'assegurança *" options={INSURANCE_TYPES} labels={INSURANCE_TYPE_LABEL} />
        <T path="policy_number" label="Número de pòlissa" /><T path="insured_object" label="Objecte assegurat" ph="Habitatge, vehicle, local…" />
        <N path="premium_eur" label="Prima anual *" unit="€" /><S path="periodicity" label="Periodicitat del pagament" options={PERIODICITIES} labels={PERIODICITY_LABEL} allowEmpty={false} />
        <T path="effect_date" label="Data d'efecte" type="date" /><T path="expiry_date" label="Data de venciment *" type="date" />
        <T path="next_payment_date" label="Proper rebut (no és el venciment)" type="date" /><N path="notice_days" label="Preavís per no renovar" unit="dies" />
        <div className="sm:col-span-2"><C path="auto_renewal" label="Renovació automàtica" /></div>
      </>) }, internalStep];
      case "alarmes": return [holderStep, { id: "installacio", label: "Instal·lació", prefixes: ["details.company", "details.product", "details.install_address", "details.equipment", "details.central_receptora", "details.contract_ref"], body: grid(<>
        <Provider path="company" label="Empresa d'alarmes" options={ALARM_COMPANIES} /><T path="product" label="Producte" />
        <T path="contract_ref" label="Referència del contracte" /><div className="flex items-end"><C path="central_receptora" label="Connectada a central receptora" /></div>
        {address("Adreça de la instal·lació")}
        <div className="space-y-1.5 sm:col-span-2"><span className="label">Equips</span>
          {((val("equipment") as { name: string; qty: number }[] | null) ?? []).map((e, i, arr) => (
            <div key={i} className="flex gap-2"><input className="input" placeholder="Detector, càmera, sirena…" value={e.name} onChange={(ev) => set("equipment", arr.map((x, j) => (j === i ? { ...x, name: ev.target.value } : x)))} />
              <input className="input w-24 tnum" inputMode="numeric" value={e.qty ?? 1} onChange={(ev) => set("equipment", arr.map((x, j) => (j === i ? { ...x, qty: ev.target.value } : x)))} />
              <Button size="sm" variant="ghost" onClick={() => set("equipment", arr.filter((_, j) => j !== i))} aria-label="Treu"><Trash2 size={13} /></Button></div>
          ))}
          <Button size="sm" onClick={() => set("equipment", [...((val("equipment") as unknown[]) ?? []), { name: "", qty: 1 }])}><Plus size={13} /> Afegeix equip</Button>
        </div>
        <T path="incidents" label="Incidències conegudes" span />
      </>) }, { id: "condicions", label: "Condicions", prefixes: ["details.economics", "details.dates"], body: economics(false) }, internalStep];
      case "plaques_solars": return [holderStep,
        { id: "installacio", label: "Instal·lació", prefixes: ["details.installer", "details.power_kwp", "details.panels", "details.inverter", "details.battery", "details.estimated_production_kwh", "details.surplus", "details.install_address"], body: grid(<>
          <T path="installer" label="Instal·lador *" /><N path="power_kwp" label="Potència pic *" unit="kWp" />
          <N path="panels.count" label="Nombre de plaques" /><N path="panels.watt" label="Potència per placa" unit="W" /><T path="panels.model" label="Model de placa" span />
          <T path="inverter.model" label="Inversor" /><N path="inverter.kw" label="Potència de l'inversor" unit="kW" />
          <T path="battery.model" label="Bateria (si n'hi ha)" /><N path="battery.kwh" label="Capacitat" unit="kWh" />
          <N path="estimated_production_kwh" label="Producció anual estimada" unit="kWh" />
          <S path="surplus" label="Excedents" options={["compensacio", "venda", "sense"]} labels={{ compensacio: "Compensació simplificada", venda: "Venda a mercat", sense: "Sense excedents" }} allowEmpty={false} />
          {address("Adreça de la instal·lació")}
        </>) },
        { id: "pressupost", label: "Pressupost", prefixes: ["details.budget_eur", "details.financing", "details.payment_schedule"], body: grid(<>
          <N path="budget_eur" label="Pressupost total" unit="€" />
          <S path="financing.kind" label="Forma de pagament" options={["comptat", "financat", "renting"]} labels={{ comptat: "Al comptat", financat: "Finançat", renting: "Rènting" }} allowEmpty={false} />
          {val("financing.kind") && val("financing.kind") !== "comptat" && <><T path="financing.entity" label="Entitat" /><N path="financing.months" label="Durada" unit="mesos" /><N path="financing.monthly_eur" label="Quota" unit="€/mes" /></>}
          <div className="space-y-1.5 sm:col-span-2"><span className="label">Calendari de pagaments</span>
            {((val("payment_schedule") as { concept: string; due_date: string | null; amount_eur: number | null; paid: boolean }[] | null) ?? []).map((p, i, arr) => (
              <div key={i} className="grid grid-cols-[1fr_9rem_7rem_auto_auto] items-center gap-2">
                <input className="input" placeholder="Concepte (paga i senyal…)" value={p.concept} onChange={(e) => set("payment_schedule", arr.map((x, j) => (j === i ? { ...x, concept: e.target.value } : x)))} />
                <input className="input" type="date" value={p.due_date ?? ""} onChange={(e) => set("payment_schedule", arr.map((x, j) => (j === i ? { ...x, due_date: e.target.value || null } : x)))} />
                <input className="input tnum" inputMode="decimal" placeholder="€" value={p.amount_eur ?? ""} onChange={(e) => set("payment_schedule", arr.map((x, j) => (j === i ? { ...x, amount_eur: e.target.value } : x)))} />
                <label className="flex items-center gap-1 text-[12px]"><input type="checkbox" checked={p.paid} onChange={(e) => set("payment_schedule", arr.map((x, j) => (j === i ? { ...x, paid: e.target.checked } : x)))} /> Pagat</label>
                <Button size="sm" variant="ghost" onClick={() => set("payment_schedule", arr.filter((_, j) => j !== i))} aria-label="Treu"><Trash2 size={13} /></Button>
              </div>
            ))}
            <Button size="sm" onClick={() => set("payment_schedule", [...((val("payment_schedule") as unknown[]) ?? []), { concept: "", due_date: null, amount_eur: null, paid: false }])}><Plus size={13} /> Afegeix pagament</Button>
            <Err path="payment_schedule" />
          </div>
        </>) },
        { id: "obra", label: "Obra i garanties", prefixes: ["details.phase", "details.warranties", "details.maintenance_next_date"], body: grid(<>
          <S path="phase" label="Fase de l'obra" options={SOLAR_PHASES} labels={SOLAR_PHASE_LABEL} allowEmpty={false} />
          <T path="maintenance_next_date" label="Proper manteniment" type="date" />
          <div className="space-y-1.5 sm:col-span-2"><span className="label">Garanties</span>
            {((val("warranties") as { concept: string; years: number | null }[] | null) ?? []).map((w, i, arr) => (
              <div key={i} className="flex gap-2"><input className="input" placeholder="Plaques, inversor, instal·lació…" value={w.concept} onChange={(e) => set("warranties", arr.map((x, j) => (j === i ? { ...x, concept: e.target.value } : x)))} />
                <input className="input w-28 tnum" inputMode="numeric" placeholder="anys" value={w.years ?? ""} onChange={(e) => set("warranties", arr.map((x, j) => (j === i ? { ...x, years: e.target.value } : x)))} />
                <Button size="sm" variant="ghost" onClick={() => set("warranties", arr.filter((_, j) => j !== i))} aria-label="Treu"><Trash2 size={13} /></Button></div>
            ))}
            <Button size="sm" onClick={() => set("warranties", [...((val("warranties") as unknown[]) ?? []), { concept: "", years: null }])}><Plus size={13} /> Afegeix garantia</Button>
          </div>
          <p className="text-[12px] text-muted sm:col-span-2">Unes plaques no es renoven cada any: no es crea cap renovació. Els avisos són de pagaments, manteniment i garanties.</p>
        </>) },
        internalStep];
      default: return [holderStep, { id: "servei", label: "Servei", prefixes: ["details."], body: grid(<>
        <T path="provider" label="Proveïdor *" /><N path="monthly_eur" label="Quota mensual" unit="€" /><T path="description" label="Descripció del servei *" span />
      </>) }, internalStep];
    }
  })();
  const all: Step[] = [...steps, { id: "resum", label: "Resum", prefixes: [], body: null }];
  const isSummary = step === all.length - 1;

  /* ---------- desar */
  const payload = (draft: boolean) => ({
    service, status: statusFor(draft), details: f.details, lines: f.lines,
    retailer: summary.retailer || "Pendent", product: summary.product, signed_at: f.signed_at || null, start_date: f.start_date || null,
    owner_id: f.owner_id || null, collaborator_id: f.collaborator_id || null, notes: f.notes || null,
  });
  const save = async (draft: boolean) => {
    setShown(new Set(["*"]));
    const v = check(draft);
    if (!v.ok) { setErr(v.issues.map((i) => i.message).filter((m, i, a) => a.indexOf(m) === i).slice(0, 6).join(" · ")); return; }
    setBusy(draft ? "draft" : "final"); setErr(null);
    try {
      const action = savedId ? "update" : renewOf ? "renew" : "create";
      const r = await crmApi.action({ entity: "contract", action, clientId: d.client.id, id: savedId ?? renewOf?.id, data: payload(draft) });
      writeDraft(key, null);
      if (draft) { setSavedId(r.id ?? savedId); useApp.getState().toast({ title: "Esborrany desat", body: "El pots reprendre des de la fitxa del client.", tone: "ok" }); }
      else { useApp.getState().toast({ title: contract ? "Contracte actualitzat" : renewOf ? "Renovació registrada" : "Contracte creat", tone: "ok" }); onSaved(); }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };

  const alerts = contractAlerts({ service, status: finalStatus, start_date: f.start_date || null, end_date: summary.end_date, permanence_end: summary.permanence_end, details: live.details, lines: live.lines }, new Date().toISOString().slice(0, 10), 400);
  const flow = STATUS_FLOW[fam].filter((s) => s !== "esborrany" && !["finalitzat", "anullat", "baixa"].includes(s) || contract?.status === s);
  const eur = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("ca-ES", { style: "currency", currency: "EUR" }));
  const stepIssues = isSummary ? [] : issuesFor(all[step].prefixes);
  const title = `${contract ? "Contracte" : renewOf ? "Renovació" : "Nou contracte"} · ${FAMILY_LABEL[fam]}`;

  return (
    <Modal open onClose={onClose} width="max-w-3xl" title={<span className="flex items-center gap-2"><FamilyIcon family={fam} size={18} /> {title}</span>}
      footer={<>
        <Button variant="ghost" disabled={!!busy} onClick={() => (step === 0 ? (onBack ?? onClose)() : setStep(step - 1))}><ArrowLeft size={14} /> {step === 0 ? (onBack ? "Canvia de servei" : "Cancel·la") : "Enrere"}</Button>
        {(!contract || contract.status === "esborrany") && <Button disabled={!!busy} onClick={() => save(true)}>{busy === "draft" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Desar esborrany</Button>}
        {isSummary
          ? <Button variant="primary" disabled={!!busy || !live.ok} onClick={() => save(false)}>{busy === "final" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {contract && contract.status !== "esborrany" ? "Desa els canvis" : "Crear contracte"}</Button>
          : <Button variant="primary" onClick={() => { setShown((s) => new Set([...s, ...all[step].prefixes.map((p) => p.replace(/^details\./, ""))])); setStep(step + 1); }}>Següent <ArrowRight size={14} /></Button>}
      </>}>
      {recover && !contract && (
        <div className="mb-3"><Notice tone="blue">Tens un esborrany sense desar d&apos;aquest servei. <button className="font-semibold underline" onClick={() => { setF(recover); setRecover(null); }}>Recupera&apos;l</button> · <button className="underline" onClick={() => { writeDraft(key, null); setRecover(null); }}>Descarta&apos;l</button></Notice></div>
      )}
      {renewOf && <div className="mb-3"><Notice tone="blue">Es crearà un contracte nou enllaçat amb l&apos;anterior ({renewOf.retailer}). L&apos;anterior es conserva a l&apos;historial.</Notice></div>}
      <ol className="mb-4 flex flex-wrap gap-1.5 text-[12px]">
        {all.map((s, i) => (
          <li key={s.id}><button type="button" onClick={() => setStep(i)} className={cn("rounded-full border px-2.5 py-1", i === step ? "border-accent bg-accent/10 font-semibold" : "border-line text-muted", i !== step && issuesFor(s.prefixes).length > 0 && i < step && "border-lost/50 text-lost")}>{i + 1}. {s.label}</button></li>
        ))}
      </ol>
      {!isSummary ? all[step].body : (
        <div className="space-y-3 text-[13px]">
          <div className="grid gap-x-4 gap-y-1.5 rounded-2xl border border-line p-3.5 sm:grid-cols-2">
            <p><span className="text-muted">Servei:</span> {FAMILY_LABEL[fam]}</p>
            <p><span className="text-muted">Proveïdor:</span> {summary.retailer ?? "—"}</p>
            <p><span className="text-muted">Producte:</span> {summary.product ?? "—"}</p>
            <p><span className="text-muted">Referència:</span> {summary.provider_ref ?? "—"}</p>
            <p><span className="text-muted">Quota mensual:</span> <b>{eur(totals.monthly_eur)}</b>{fam === "fibra_mobil" ? " (paquet + línies extra)" : ""}</p>
            {totals.package_saving_eur != null && <p><span className="text-muted">Per separat:</span> {eur(totals.individual_sum_eur)} · estalvi {eur(totals.package_saving_eur)}</p>}
            {totals.one_off_eur > 0 && <p><span className="text-muted">{fam === "plaques_solars" ? "Pressupost" : "Pagaments únics"}:</span> {eur(totals.one_off_eur)}</p>}
            {totals.active_lines > 0 && <p><span className="text-muted">Línies vives:</span> {totals.active_lines}</p>}
            {summary.permanence_end && <p><span className="text-muted">Fi de permanència:</span> {summary.permanence_end}</p>}
            {summary.end_date && <p><span className="text-muted">Venciment:</span> {summary.end_date}</p>}
          </div>
          {alerts.length > 0 && <div className="space-y-1">{alerts.map((a, i) => <p key={i} className={cn("text-[12px]", a.level === "urgent" ? "text-lost" : "text-muted")}>• {a.message}</p>)}</div>}
          <label className="block max-w-xs"><span className="label">Estat en crear-lo</span>
            <select className="input" value={finalStatus} onChange={(e) => setFinalStatus(e.target.value as ContractStatus)}>{flow.map((s) => <option key={s} value={s}>{CONTRACT_STATUS_LABEL[s]}</option>)}</select>
          </label>
          {live.issues.length > 0
            ? <Notice tone="red"><b>Falta completar:</b><ul className="mt-1 list-disc pl-5">{live.issues.slice(0, 10).map((i: Issue, n) => <li key={n}>{i.message}</li>)}</ul>Ho pots desar com a esborrany i acabar-ho després.</Notice>
            : <Notice tone="green">Tot correcte. Els documents (contracte signat, pòlissa, pressupost…) s&apos;adjunten des de la fitxa del contracte un cop creat.</Notice>}
        </div>
      )}
      {!isSummary && stepIssues.length > 0 && shown.size > 0 && <p className="mt-3 text-[12px] text-amber-700">Aquest pas té {stepIssues.length} {stepIssues.length === 1 ? "dada pendent" : "dades pendents"}.</p>}
      {err && <p className="mt-3 rounded-xl border border-lost/40 bg-lost/[0.05] px-3 py-2 text-[12.5px] text-lost">{err}</p>}
    </Modal>
  );
}
