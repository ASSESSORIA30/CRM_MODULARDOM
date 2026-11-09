"use client";
/**
 * Fitxa 360 · resum SIPS d'un subministrament (migració 034): mostra primer les dades desades (sense consultar el SIPS),
 * l'estat de sincronització i el botó «Actualitzar dades SIPS», que fa la mateixa consulta interactiva de sempre.
 */
import { useEffect, useState } from "react";
import { DatabaseZap, Loader2 } from "lucide-react";
import { JOB_STATE_LABEL, normalizeTariff, powerPeriods, type JobState } from "@/core/sips-sync";
import { useSips, useSipsIndex } from "@/ui/useSips";
import { useApp } from "@/data/store";
import { Badge, Button } from "../../components/ui";

type Status = { cups20: string; status: JobState; last_success_at: string | null; next_attempt_at: string; last_error: string | null; multi_client: boolean };
const STALE_DAYS = 45;
const fmtDay = (s: string | null | undefined) => (s ? new Date(s).toLocaleDateString("ca-ES", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");

export function SipsSupplySummary({ cups, energy }: { cups: string; energy: "luz" | "gas" }) {
  const entry = useSips(cups);
  const refresh = useSipsIndex((s) => s.refresh);
  const busy = useSipsIndex((s) => !!s.busy[cups.slice(0, 20)]);
  const [st, setSt] = useState<Status | null>(null);
  const [v, setV] = useState(0);
  useEffect(() => {
    fetch(`/api/sips/sync?r=status&cups=${encodeURIComponent(cups)}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j: { rows?: Status[] } | null) => setSt(j?.rows?.[0] ?? null)).catch(() => setSt(null));
  }, [cups, v]);
  const update = async () => {
    try {
      const e = await refresh(cups);
      useApp.getState().toast({ title: e.status === "found" ? "Dades SIPS actualitzades" : "El SIPS no ha retornat dades", body: e.error ?? undefined, tone: e.status === "found" ? "ok" : "err" });
      setV((x) => x + 1);
    } catch (e) { useApp.getState().toast({ title: "No s'ha pogut consultar el SIPS", body: e instanceof Error ? e.message : String(e), tone: "err" }); }
  };
  const found = entry?.status === "found";
  const { tariff, original } = normalizeTariff(entry?.tariff ?? null, energy);
  const np = powerPeriods(tariff);
  const kw = (entry?.contracted_power_kw ?? []).slice(0, np);
  const stale = found && entry ? Date.now() - Date.parse(entry.consulted_at) > STALE_DAYS * 86_400_000 : false;
  return (
    <div className="mt-2 rounded-lg border border-line px-3 py-2 text-[12px]" data-testid="sips-resum-fitxa">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Dades SIPS</span>
        {st && <Badge tone={st.status === "actualitzat" ? "green" : /error|bloquejat/.test(st.status) ? "amber" : "zinc"}>{JOB_STATE_LABEL[st.status]}</Badge>}
        {st?.multi_client && <Badge tone="amber">CUPS a més d&apos;un client</Badge>}
        <span className="text-muted">Última consulta: {found ? fmtDay(entry!.consulted_at) : "—"}</span>
        <Button size="sm" className="ml-auto" disabled={busy} onClick={() => void update()}>{busy ? <Loader2 size={13} className="animate-spin" /> : <DatabaseZap size={13} />} Actualitzar dades SIPS</Button>
      </div>
      {found ? (
        <div className="mt-1.5 grid gap-x-4 gap-y-1 sm:grid-cols-3">
          <span>Tarifa: <b>{tariff ?? "—"}</b>{original && original !== tariff && <span className="text-muted"> (rebut: {original})</span>}</span>
          <span>Consum anual: <b className="tnum">{entry!.annual_kwh != null ? `${Math.round(entry!.annual_kwh).toLocaleString("ca-ES")} kWh` : "—"}</b>{entry!.annual_consumption?.from && <span className="text-muted"> ({entry!.annual_consumption.from} – {entry!.annual_consumption.to})</span>}</span>
          {np > 0 && <span className="tnum">Potències: {kw.length ? kw.map((x, i) => `P${i + 1} ${x ?? "—"}`).join(" · ") : "—"} kW</span>}
        </div>
      ) : <p className="mt-1 text-muted">{entry?.status === "not_found" ? "El SIPS no retorna dades per a aquest CUPS." : entry?.status === "error" ? `Última consulta amb error: ${entry.error ?? ""}` : "Encara no hi ha dades SIPS desades."}</p>}
      {stale && <p className="mt-1 text-amber-600">Dades SIPS actualitzades per última vegada el {fmtDay(entry!.consulted_at)}.</p>}
      {st?.last_error && st.status !== "actualitzat" && <p className="mt-1 text-muted">{st.last_error}</p>}
    </div>
  );
}
