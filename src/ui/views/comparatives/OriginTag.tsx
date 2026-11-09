"use client";
/**
 * Etiqueta discreta de procedència d'un camp (SIPS · Factura · Corba horària · Manual · CRM). En passar el cursor o
 * prémer-la, mostra la font, la data (només si està acreditada), el valor original si s'ha modificat i si la dada és
 * real, calculada o manual. Un camp buit no en mostra cap.
 */
import { useState } from "react";
import * as TooltipP from "@radix-ui/react-tooltip";
import { NATURE_LABEL, ORIGIN_LABEL, ORIGIN_NATURE, type FieldOrigin, type Origin } from "@/comparator/provenance";
import { cn } from "../../components/ui";

const TONE: Record<Origin, string> = {
  sips: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  factura: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  corba: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  manual: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  crm: "bg-ink/[0.06] text-muted",
};
const when = (at: string | null) => {
  if (!at) return null;
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString("ca-ES", { dateStyle: "short", ...(at.length > 10 ? { timeStyle: "short" } : {}) } as Intl.DateTimeFormatOptions);
};
const val = (v: number | string | null) => (v == null ? "—" : typeof v === "number" ? v.toLocaleString("ca-ES", { maximumFractionDigits: 3 }) : v);

export function OriginTag({ info, unit }: { info: FieldOrigin | null; unit?: string }) {
  const [open, setOpen] = useState(false);
  if (!info) return null;
  const date = when(info.at);
  const o = info.original;
  return (
    <TooltipP.Provider delayDuration={150}>
      <TooltipP.Root open={open} onOpenChange={setOpen}>
        <TooltipP.Trigger asChild>
          <button type="button" data-testid="origen-dada" data-origin={info.origin} onClick={(e) => { e.preventDefault(); setOpen((x) => !x); }}
            className={cn("rounded px-1 text-[9.5px] font-semibold uppercase leading-[14px] tracking-wide outline-none focus-visible:ring-1 focus-visible:ring-brand", TONE[info.origin])}>
            {ORIGIN_LABEL[info.origin]}
          </button>
        </TooltipP.Trigger>
        <TooltipP.Portal>
          <TooltipP.Content side="top" sideOffset={6} className="z-50 max-w-[280px] space-y-0.5 rounded-lg border border-line bg-surface px-3 py-2 text-[11.5px] leading-snug text-ink shadow-xl">
            <p><b>Font:</b> {info.source ?? ORIGIN_LABEL[info.origin]}</p>
            {date && <p><b>{info.origin === "manual" ? "Modificada" : info.origin === "factura" ? "Extreta" : "Consultada"}:</b> {date}</p>}
            <p className="text-muted">{NATURE_LABEL[ORIGIN_NATURE[info.origin]]}</p>
            {o && <p className="border-t border-line pt-1"><b>Valor original:</b> {val(o.value)}{unit ? ` ${unit}` : ""} · {ORIGIN_LABEL[o.origin]}{o.source && o.source !== ORIGIN_LABEL[o.origin] ? ` (${o.source})` : ""}{when(o.at) ? ` · ${when(o.at)}` : ""}</p>}
          </TooltipP.Content>
        </TooltipP.Portal>
      </TooltipP.Root>
    </TooltipP.Provider>
  );
}
