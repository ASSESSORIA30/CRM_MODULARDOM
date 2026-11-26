// Catàleg central de tarifes (font única CRM + web), historial amb canvis i publicació a la web.
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Field, PageHeader, btnGold, btnPrimary, btnSecondary, inputCls } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import type { TariffParams } from "@/lib/configurator/engine";
import { tariffDiff } from "@/lib/configurator/tariff";
import { getPath, ROOF_FIELDS, SCALAR_FIELDS } from "@/lib/configurator/tariff-form";
import { formatDate, formatDateTime, madridDateKey } from "@/lib/dates";
import { qt } from "@/lib/i18n-pressupostos";
import { qx } from "@/lib/i18n-pressupostos-v2";
import { actionMessages } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";
import {
  approveTariffAction, deleteTariffDraftAction, newTariffDraftAction, publishTariffWebAction, saveCompanySettingsAction, saveTariffDraftAction,
} from "./actions";

const LABELS: Record<string, string> = {
  construccio_m2: "Construcció €/m²", fonamentacio_m2: "Fonamentació €/m²", arquitecte_m2: "Arquitecte €/m²", arquitecte_fix: "Arquitecte import fix €",
  escomeses: "Escomeses i sanejament €", metres_minims: "Superfície mínima m²", iva_obra_pct: "IVA obra i extres %", iva_arquitecte_pct: "IVA arquitecte %",
  distribucio_descompte_pct: "Descompte distribució %", "intern.habitacio": "Intern · habitació €", "intern.bany": "Intern · bany €",
  "intern.safareig": "Intern · safareig €", "intern.suite_bany": "Intern · suite amb bany €", "intern.suite_bany_vestidor": "Intern · suite + vestidor €",
  "garatge.primer_vehicle": "Garatge · 1r vehicle €", "garatge.vehicle_addicional": "Garatge · vehicle addicional €", "garatge.max_vehicles": "Garatge · màxim vehicles",
  "cuina.basica": "Cuina bàsica €", "cuina.illa": "Cuina amb illa €",
};
const ROOF_LABELS: Record<(typeof ROOF_FIELDS)[number], string> = {
  "coberta.inclinada.preu_m2": "Una aigua · €/m² de coberta", "coberta.inclinada.pendent_pct": "Una aigua · pendent %",
  "coberta.dues_aigues.preu_m2": "Dues aigües · €/m² de coberta", "coberta.dues_aigues.pendent_pct": "Dues aigües · pendent %",
  "coberta.volada_m": "Voladís per costat (m)", "coberta.proporcio": "Proporció de la planta (llargada ÷ amplada)",
};
const fmt = (n: number) => String(n).replace(".", ",");

export default async function TarifesPage() {
  const profile = await requireRole("direccio");
  const L = profile.locale;
  const X = qx(L);
  const T = qt(L);
  const base = actionMessages(L);
  const messages = { ...base, errors: { ...base.errors, ...T.errors } };
  const supabase = await createClient();
  const [{ data: versions }, { data: inForce }, { data: company }] = await Promise.all([
    supabase.from("tariff_versions").select("id, number, status, params, effective_from, notes, based_on, approved_at, published_web_at, created_at").order("number", { ascending: false }),
    supabase.rpc("tariff_in_force"),
    supabase.from("company_settings").select("*").maybeSingle(),
  ]);
  const all = versions ?? [];
  const draft = all.find((v) => v.status === "esborrany");
  const byId = new Map(all.map((v) => [v.id, v]));
  const webPublished = all.filter((v) => v.published_web_at).sort((a, b) => b.published_web_at!.localeCompare(a.published_web_at!))[0];
  const today = madridDateKey();
  const crmUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://<el-teu-crm>.vercel.app";

  return (
    <div className="max-w-6xl space-y-5">
      <PageHeader title={X.tariffs} subtitle={X.tariffHelp} />

      <Card title={X.tariffs}>
        <ul className="divide-y divide-navy/5" data-testid="tariff-list">
          {all.map((v) => {
            const prev = v.based_on ? byId.get(v.based_on) : all.find((x) => x.number === v.number - 1);
            const diff = prev ? tariffDiff(prev.params, v.params) : [];
            return (
              <li key={v.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-navy">{X.tariff} {v.number}</span>
                  <span className="flex flex-wrap items-center gap-2 text-sm text-muted">
                    <Badge className={v.status === "aprovada" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}>{X.tariffStatuses[v.status]}</Badge>
                    {v.effective_from && <span>{X.effectiveFrom} {formatDate(v.effective_from, L)}</span>}
                    {v.id === inForce && <Badge className="bg-gold-light text-navy">★ {X.tariffInForce}</Badge>}
                    {v.id === webPublished?.id && <Badge className="bg-sky-100 text-sky-800">🌐 {X.publishedWeb} {formatDateTime(v.published_web_at!, L)}</Badge>}
                  </span>
                </div>
                {v.notes && <p className="text-sm text-muted">{v.notes}</p>}
                {diff.length > 0 && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-navy">{X.changes} ({diff.length})</summary>
                    <table className="mt-1 w-full text-xs"><thead className="text-left text-muted"><tr><th className="p-1" /><th className="p-1">{X.before}</th><th className="p-1">{X.after}</th></tr></thead>
                      <tbody>{diff.map((d) => <tr key={d.path} className="border-t border-navy/5"><td className="p-1 font-mono">{d.path}</td><td className="p-1">{JSON.stringify(d.before)}</td><td className="p-1 font-semibold">{JSON.stringify(d.after)}</td></tr>)}</tbody></table>
                  </details>
                )}
                {v.status === "aprovada" && v.effective_from && v.effective_from <= today && v.id !== webPublished?.id && (
                  <ActionForm action={publishTariffWebAction} messages={messages} submitLabel={`🌐 ${X.publishWeb}`} submitClassName={btnSecondary}>
                    <input type="hidden" name="id" value={v.id} />
                    <p className="text-xs text-muted">{X.publishWebHelp}</p>
                  </ActionForm>
                )}
              </li>
            );
          })}
        </ul>
        {!draft && (
          <ActionForm action={newTariffDraftAction} messages={messages} submitLabel={X.newDraft} submitClassName={btnPrimary} className="mt-3"><span /></ActionForm>
        )}
      </Card>

      {draft && (
        <Card title={`${X.editDraft} · ${X.tariff} ${draft.number}`}>
          <ActionForm action={saveTariffDraftAction} messages={messages} submitLabel={X.saveDraft} className="space-y-4" submitClassName={btnPrimary}>
            <input type="hidden" name="id" value={draft.id} />
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {SCALAR_FIELDS.map((k) => (
                <Field key={k} label={LABELS[k] ?? k}><input name={k} required inputMode="decimal" defaultValue={fmt(getPath(draft.params as TariffParams, k))} className={inputCls} /></Field>
              ))}
              <Field label="Opcions habitacions"><input name="opcions.habitacions" defaultValue={(draft.params as TariffParams).opcions.habitacions.join(", ")} className={inputCls} /></Field>
              <Field label="Opcions banys"><input name="opcions.banys" defaultValue={(draft.params as TariffParams).opcions.banys.join(", ")} className={inputCls} /></Field>
            </div>
            <fieldset className="rounded-lg border border-navy/10 p-3">
              <legend className="px-1 text-sm font-semibold text-navy">Cobertes inclinades (suplement per m² de coberta)</legend>
              <p className="mb-2 text-xs text-muted">
                La coberta plana és l&apos;estàndard, sense suplement. Cal omplir els sis camps o deixar-los tots en blanc: sense aquest bloc,
                el configurador mostra les cobertes inclinades com a «pendent de valorar». El pendent, el voladís i la proporció només
                s&apos;usen per estimar la superfície quan encara no hi ha plànols (planta = m² construïts ÷ plantes).
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                {ROOF_FIELDS.map((k) => {
                  const v = getPath(draft.params as TariffParams, k) as number | undefined;
                  return <Field key={k} label={ROOF_LABELS[k]}><input name={k} inputMode="decimal" defaultValue={v == null ? "" : fmt(v)} className={inputCls} /></Field>;
                })}
              </div>
            </fieldset>
            {(["installacions_m2", "extres"] as const).map((g) => (
              <fieldset key={g} className="rounded-lg border border-navy/10 p-3">
                <legend className="px-1 text-sm font-semibold text-navy">{g === "extres" ? "Extres (€)" : "Instal·lacions (€/m²)"}</legend>
                {[...Object.entries((draft.params as TariffParams)[g] as Record<string, { nom: { ca: string; es: string }; preu?: number; preu_m2?: number }>), ["", { nom: { ca: "", es: "" } } as { nom: { ca: string; es: string }; preu?: number; preu_m2?: number }] as const].map(([k, v], i) => (
                  <div key={i} className="grid grid-cols-[1fr_1.5fr_1.5fr_1fr_auto] items-center gap-2 py-1">
                    <input name={`${g}.key`} defaultValue={k} placeholder="clau" pattern="[a-zA-Z][a-zA-Z0-9_]*" className={inputCls} aria-label="clau" />
                    <input name={`${g}.nom_ca`} defaultValue={v.nom.ca} placeholder="Nom (ca)" className={inputCls} aria-label="Nom (ca)" />
                    <input name={`${g}.nom_es`} defaultValue={v.nom.es} placeholder="Nombre (es)" className={inputCls} aria-label="Nombre (es)" />
                    <input name={`${g}.preu`} defaultValue={k ? fmt((g === "extres" ? v.preu : v.preu_m2) ?? 0) : ""} inputMode="decimal" className={inputCls} aria-label="preu" />
                    {k ? <label className="text-xs"><input type="checkbox" name={`${g}.remove`} value={k} /> ✕</label> : <span className="text-xs text-muted">+</span>}
                  </div>
                ))}
              </fieldset>
            ))}
            <Field label="Notes"><input name="notes" defaultValue={draft.notes ?? ""} maxLength={1000} className={inputCls} /></Field>
          </ActionForm>
          <div className="mt-4 grid gap-3 border-t border-navy/10 pt-4 sm:grid-cols-2">
            <ActionForm action={approveTariffAction} messages={messages} submitLabel={X.approve} className="space-y-2" submitClassName={btnGold}>
              <input type="hidden" name="id" value={draft.id} />
              <Field label={X.effectiveFrom}><input type="date" name="effectiveFrom" required defaultValue={today} className={inputCls} /></Field>
              <input type="hidden" name="notes" value={draft.notes ?? ""} />
              <p className="text-xs text-muted">{X.approveHelp}</p>
            </ActionForm>
            <ActionForm action={deleteTariffDraftAction} messages={messages} submitLabel={X.deleteDraft} submitClassName={btnSecondary}>
              <input type="hidden" name="id" value={draft.id} />
            </ActionForm>
          </div>
        </Card>
      )}

      <Card title={X.webIntegration}>
        <p className="text-sm text-muted">{X.webIntegrationHelp}</p>
        <pre className="mt-2 overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{`<script src="${crmUrl}/configurador/motor.js"></script>
<script src="${crmUrl}/api/configurador/tarifa.js"></script>`}</pre>
      </Card>

      <Card title={X.companySettings}>
        <ActionForm action={saveCompanySettingsAction} messages={messages} submitLabel={T.confirm} className="grid gap-3 sm:grid-cols-3" submitClassName={btnPrimary}>
          <Field label={X.taxId}><input name="tax_id" defaultValue={company?.tax_id ?? ""} className={inputCls} /></Field>
          <Field label={X.address} className="sm:col-span-2"><input name="address" defaultValue={company?.address ?? ""} className={inputCls} /></Field>
          <Field label={X.phone}><input name="phone" defaultValue={company?.phone ?? ""} className={inputCls} /></Field>
          <Field label={X.email}><input name="email" defaultValue={company?.email ?? ""} className={inputCls} /></Field>
          <Field label={X.website}><input name="website" defaultValue={company?.website ?? ""} className={inputCls} /></Field>
          <Field label={X.iban}><input name="iban" defaultValue={company?.iban ?? ""} className={inputCls} /></Field>
          <Field label={X.validityMonths}><input type="number" min={0} max={24} name="quote_validity_months" defaultValue={company?.quote_validity_months ?? 1} className={inputCls} /></Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" name="client_quote_decisions" defaultChecked={!!company?.client_quote_decisions} /> {X.clientDecisions}</label>
        </ActionForm>
      </Card>
    </div>
  );
}
