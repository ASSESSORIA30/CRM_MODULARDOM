"use client";
/** Regles apreses del lector de factures: Direcció i la cap d'administració aproven o revoquen les proposades. */
import { useEffect, useState } from "react";
import { GraduationCap } from "lucide-react";
import { ENERGY_CONCEPT_LABEL, type EnergyConcept } from "@/comparator/energy-breakdown";
import { Button, Notice, cn } from "../../components/ui";

type Rule = { id: string; retailer: string | null; pattern: string; concept: EnergyConcept; status: "proposada" | "aprovada"; example_label: string | null; previous_concept: EnergyConcept | null; created_by_name: string | null; approved_by_name: string | null };

export function InvoiceRulesCard() {
  const [data, setData] = useState<{ rules: Rule[]; canApprove: boolean; migration: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => fetch("/api/invoices/rules", { cache: "no-store" }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`); setData(j); }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  useEffect(() => { void load(); }, []);
  const decide = async (id: string, action: "approve" | "revoke") => {
    const r = await fetch("/api/invoices/rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) setError((j as { error?: string }).error ?? `Error ${r.status}`); else { setError(null); void load(); }
  };
  if (!data && !error) return null;
  const pending = data?.rules.filter((r) => r.status === "proposada").length ?? 0;
  return (
    <details className="rounded-2xl border border-line bg-surface p-3 text-[12.5px]" open={pending > 0}>
      <summary className="flex cursor-pointer items-center gap-2 font-semibold"><GraduationCap size={15} /> Regles apreses del lector de factures {pending > 0 && <span className="rounded bg-amber-500/15 px-1.5 text-[11px] text-amber-700 dark:text-amber-300">{pending} per aprovar</span>}</summary>
      {error && <Notice>{error}</Notice>}
      {data && !data.migration && <Notice tone="blue">Falta aplicar la migració 037 a Supabase per desar regles.</Notice>}
      {data && data.migration && (data.rules.length === 0 ? <p className="mt-2 text-muted">Encara no hi ha cap regla. Es creen des de «Veure càlcul» d&apos;una comparativa, amb «Ensenyar aquesta correcció a la IA».</p> : (
        <table className="mt-2 w-full">
          <thead className="text-left text-[11px] text-muted"><tr><th className="py-1">Línia de factura</th><th>Es llegeix com</th><th>Comercialitzadora</th><th>Estat</th><th /></tr></thead>
          <tbody>
            {data.rules.map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="py-1.5">«{r.example_label ?? r.pattern}»</td>
                <td>{ENERGY_CONCEPT_LABEL[r.concept]}{r.previous_concept ? <span className="text-muted"> (abans: {ENERGY_CONCEPT_LABEL[r.previous_concept]})</span> : null}</td>
                <td>{r.retailer ?? "Totes"}</td>
                <td><span className={cn("rounded px-1.5 py-0.5 text-[10.5px] font-semibold", r.status === "aprovada" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300")}>{r.status}</span><span className="ml-1 text-[11px] text-muted">{r.created_by_name}</span></td>
                <td className="text-right">{data.canApprove && <span className="inline-flex gap-1">{r.status === "proposada" && <Button size="sm" variant="success" onClick={() => void decide(r.id, "approve")}>Aprova</Button>}<Button size="sm" variant="ghost" onClick={() => void decide(r.id, "revoke")}>{r.status === "proposada" ? "Rebutja" : "Revoca"}</Button></span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </details>
  );
}
