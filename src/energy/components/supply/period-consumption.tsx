"use client";
import { Zap } from "lucide-react";
import type { Supply } from "@/energy/lib/types";
import { electricityPeriodCount, savedAnnualConsumption } from "@/energy/lib/sips-consumption";
import { fmt } from "@/energy/lib/format";
import { Badge, Card, CardBody, CardHeader } from "../ui";

/** La mateixa dada per períodes que alimenta el comparador i les ofertes. */
export function PeriodConsumption({ s }: { s: Supply }) {
  const count = electricityPeriodCount(s.tarifa ?? s.tarifaRaw);
  if (!count) return null;
  const reading = savedAnnualConsumption(s.raw);
  const periods = Array.from({ length: count }, (_, i) => reading?.periods[i] ?? null);
  return (
    <Card>
      <CardHeader icon={<Zap />} title="Consum anual per períodes" subtitle={`Energia activa · P1–P${count} · kWh`}
        right={<Badge tone={reading?.status === "complete" ? "good" : "warning"}>{reading?.status === "complete" ? "Dades validades" : "Dades incompletes"}</Badge>} />
      <CardBody className="space-y-3">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Consum anual per períodes SIPS">
            <thead><tr className="border-b border-border text-left text-xs text-fg-3"><th scope="col" className="py-2">Període</th><th scope="col" className="py-2 text-right">Consum (kWh)</th></tr></thead>
            <tbody>{periods.map((v, i) => <tr key={i} className="border-b border-border/50"><th scope="row" className="py-2 text-left font-medium">P{i + 1}</th><td className="num py-2 text-right">{v == null ? "Dada no disponible" : fmt.n(v, 3)}</td></tr>)}</tbody>
            <tfoot><tr><th scope="row" className="pt-3 text-left">Total dels períodes</th><td className="num pt-3 text-right font-semibold">{reading?.total == null ? "Dada no disponible" : `${fmt.n(reading.total, 3)} kWh`}</td></tr></tfoot>
          </table>
        </div>
        {reading?.from && reading.to && <p className="text-xs text-fg-3">Del {fmt.date(reading.from)} al {fmt.date(reading.to)} · {reading.source}</p>}
        {reading?.warning && <p role="status" className="text-xs text-warning">{reading.warning}</p>}
        {!reading && <p className="text-xs text-fg-3">Actualitza SIPS per recuperar el consum per períodes. El total anual no es reparteix automàticament.</p>}
      </CardBody>
    </Card>
  );
}
